import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  Role,
  type AuthMethodsDto,
  adminGoogleLoginSchema,
  adminLoginSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  logoutRequestSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshRequestSchema,
  resetPasswordSchema,
  initialPasswordSchema,
  deleteAccountSchema,
  setLanguageSchema,
  staffLoginSchema,
  type AdminGoogleLoginInput,
  type AdminLoginInput,
  type AuthenticatedUser,
  type ForgotPasswordInput,
  type GoogleLoginInput,
  type InitialPasswordInput,
  type DeleteAccountInput,
  type LogoutRequestInput,
  type OtpRequestInput,
  type OtpVerifyInput,
  type RefreshRequestInput,
  type ResetPasswordInput,
  type SetLanguageInput,
  type StaffLoginInput,
} from '@barbercue/shared';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { setRefreshCookie, clearRefreshCookie } from '../common/refresh-cookie';

// Auth endpoints are deliberately rate-limited tighter than the app-wide default (see
// AppModule's ThrottlerModule config) — brute-force/OTP-spam surface, not ordinary traffic.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  /**
   * Which sign-in methods this deployment can actually complete. Public and unauthenticated by
   * design — it is the first thing a login screen needs, and it returns only booleans, never the
   * presence-checked values themselves.
   *
   * Phone OTP is reported available when a real SMS provider is configured, or outside production
   * where ConsoleOtpSender logs the code instead of sending it (the same NODE_ENV condition
   * AuthModule's OTP_SENDER factory uses to pick the sender — kept in step with it deliberately).
   */
  @Public()
  @Get(AUTH_PATHS.methods)
  authMethods(): AuthMethodsDto {
    return {
      google: Boolean(
        process.env.GOOGLE_WEB_CLIENT_ID ??
        process.env.GOOGLE_ANDROID_CLIENT_ID,
      ),
      phoneOtp:
        process.env.NODE_ENV !== 'production' ||
        Boolean(process.env.OTP_PROVIDER_API_KEY),
    };
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
    setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post(AUTH_PATHS.google)
  @UsePipes(new ZodValidationPipe(googleLoginSchema))
  async googleLogin(
    @Body() body: GoogleLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.googleLogin(
      body.idToken,
      req.headers['user-agent'],
    );
    setRefreshCookie(res, result.tokens.refreshToken);
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
    setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  // Same request/response shape as customer POST auth/google — deliberately a distinct route
  // and a distinct AuthService method (staffGoogleLogin), not this handler branching on a role
  // param, so the "never create a user, never elevate a customer account" guarantee lives in
  // exactly one code path and can't be bypassed by passing the wrong flag.
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post(AUTH_PATHS.staffGoogle)
  @UsePipes(new ZodValidationPipe(googleLoginSchema))
  async staffGoogleLogin(
    @Body() body: GoogleLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.staffGoogleLogin(
      body.idToken,
      req.headers['user-agent'],
    );
    setRefreshCookie(res, result.tokens.refreshToken);
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
    setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post(AUTH_PATHS.adminGoogle)
  @UsePipes(new ZodValidationPipe(adminGoogleLoginSchema))
  async adminGoogleLogin(
    @Body() body: AdminGoogleLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.adminGoogleLogin(
      body.idToken,
      body.totpCode,
      req.headers['user-agent'],
    );
    setRefreshCookie(res, result.tokens.refreshToken);
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
    setRefreshCookie(res, tokens.refreshToken);
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
    clearRefreshCookie(res);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post(AUTH_PATHS.logoutAll)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.id);
    clearRefreshCookie(res);
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
    return this.authService.forgotPassword(body.email, body.audience);
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

  @Post(AUTH_PATHS.initialPassword)
  @UsePipes(new ZodValidationPipe(initialPasswordSchema))
  setInitialPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InitialPasswordInput,
  ) {
    return this.authService.setInitialPassword(
      user.id,
      user.audience,
      body.password,
    );
  }

  /** Customer-only deletion. No target user id is accepted: the JWT subject is authoritative. */
  @Delete(AUTH_PATHS.accountDeletion)
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CUSTOMER)
  @UsePipes(new ZodValidationPipe(deleteAccountSchema))
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _body: DeleteAccountInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.deleteCustomerAccount(user.id, user.audience);
    clearRefreshCookie(res);
    return { success: true };
  }

  @Get(AUTH_PATHS.me)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id, user.roles, user.audience);
  }

  @Patch(AUTH_PATHS.language)
  setLanguage(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setLanguageSchema)) body: SetLanguageInput,
  ) {
    return this.authService.setLanguage(
      user.id,
      user.roles,
      user.audience,
      body.language,
    );
  }
}
