import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AUTH_PATHS,
  REFRESH_TOKEN_COOKIE_NAME,
  adminLoginSchema,
  forgotPasswordSchema,
  logoutRequestSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshRequestSchema,
  resetPasswordSchema,
  staffLoginSchema,
  type AdminLoginInput,
  type AuthenticatedUser,
  type ForgotPasswordInput,
  type LogoutRequestInput,
  type OtpRequestInput,
  type OtpVerifyInput,
  type RefreshRequestInput,
  type ResetPasswordInput,
  type StaffLoginInput,
} from '@barbercue/shared';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches TokenService

// Auth endpoints are deliberately rate-limited tighter than the app-wide default (see
// AppModule's ThrottlerModule config) — brute-force/OTP-spam surface, not ordinary traffic.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      // "site" (for SameSite purposes) ignores port, so this works across localhost:3000/3001 in
      // dev. In production, if web and backend ever live on different registrable domains,
      // this needs `sameSite: 'none', secure: true` instead — a deployment-time config, not an
      // architecture change.
      secure: process.env.NODE_ENV === 'production',
      path: '/api/v1/auth',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/api/v1/auth' });
  }

  /** Refresh token can arrive via body (mobile) or httpOnly cookie (web) — body takes precedence. */
  private extractRefreshToken(
    request: Request,
    bodyToken?: string,
  ): string | undefined {
    return (
      bodyToken ||
      (request.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as string | undefined)
    );
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post(AUTH_PATHS.otpRequest)
  @UsePipes(new ZodValidationPipe(otpRequestSchema))
  otpRequest(@Body() body: OtpRequestInput) {
    return this.authService.requestCustomerOtp(body.phone);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post(AUTH_PATHS.otpVerify)
  @UsePipes(new ZodValidationPipe(otpVerifySchema))
  async otpVerify(
    @Body() body: OtpVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyCustomerOtp(
      body.phone,
      body.code,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post(AUTH_PATHS.staffLogin)
  @UsePipes(new ZodValidationPipe(staffLoginSchema))
  async staffLogin(
    @Body() body: StaffLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.staffLogin(
      body.email,
      body.password,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post(AUTH_PATHS.adminLogin)
  @UsePipes(new ZodValidationPipe(adminLoginSchema))
  async adminLogin(
    @Body() body: AdminLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.adminLogin(
      body.email,
      body.password,
      body.totpCode,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Public()
  @Post(AUTH_PATHS.refresh)
  @UsePipes(new ZodValidationPipe(refreshRequestSchema))
  async refresh(
    @Body() body: RefreshRequestInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = this.extractRefreshToken(req, body.refreshToken);
    if (!rawToken) {
      return this.authService.refresh(''); // deliberately invalid → AuthService throws REFRESH_TOKEN_INVALID
    }
    const tokens = await this.authService.refresh(
      rawToken,
      req.headers['user-agent'],
    );
    this.setRefreshCookie(res, tokens.refreshToken);
    return tokens;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post(AUTH_PATHS.logout)
  @UsePipes(new ZodValidationPipe(logoutRequestSchema))
  async logout(
    @Body() body: LogoutRequestInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = this.extractRefreshToken(req, body.refreshToken);
    if (rawToken) await this.authService.logout(rawToken);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post(AUTH_PATHS.logoutAll)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.id);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  @Get(AUTH_PATHS.sessions)
  sessions(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const currentRawToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;
    return this.authService.listSessions(user.id, currentRawToken);
  }

  @Delete(`${AUTH_PATHS.sessions}/:id`)
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.authService.revokeSession(user.id, id);
    return { success: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post(AUTH_PATHS.forgotPassword)
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  forgotPassword(@Body() body: ForgotPasswordInput) {
    return this.authService.forgotPassword(body.email);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post(AUTH_PATHS.resetPassword)
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  async resetPassword(@Body() body: ResetPasswordInput) {
    await this.authService.resetPassword(body.token, body.newPassword);
    return { success: true };
  }

  @Get(AUTH_PATHS.me)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id, user.roles);
  }
}
