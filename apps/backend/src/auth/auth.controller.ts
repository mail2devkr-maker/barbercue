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
  type AuthMethodsDto,
  adminLoginSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  logoutRequestSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshRequestSchema,
  resetPasswordSchema,
  staffLoginSchema,
  type AdminLoginInput,
  type AuthenticatedUser,
  type ForgotPasswordInput,
  type GoogleLoginInput,
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

// Production runs web and backend on separate registrable domains, making every browser->API
// call cross-site; see setRefreshCookie for why that forces SameSite=None + Secure together.
const CROSS_SITE_COOKIES = process.env.NODE_ENV === 'production';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      // "site" (for SameSite purposes) ignores port, so `lax` works across localhost:3000/3001 in
      // dev — both are the same site (`localhost`). In production web and backend are separate
      // registrable domains: Railway gives each service its own `*.up.railway.app` host, and
      // `up.railway.app` is itself on the Public Suffix List, so the two hosts are cross-site.
      // A `lax` cookie is never sent on a cross-site XHR, which silently breaks /auth/refresh
      // (the session dies on the next reload). `none` is therefore required in production, and
      // is only legal alongside `secure` — hence both flags derive from the same condition
      // rather than being set independently. This is the deployment-time config the previous
      // comment here anticipated, not an architecture change.
      sameSite: CROSS_SITE_COOKIES ? 'none' : 'lax',
      secure: CROSS_SITE_COOKIES,
      // Path is deliberately "/", not "/api/v1/auth": cookies are scoped by (domain, path), never
      // by port, so this same cookie jar is shared between the backend (localhost:3000) and
      // apps/web's proxy.ts (localhost:3001) in dev. proxy.ts's coarse "is there a session at
      // all" gate on /account/* and /dashboard/* reads this cookie on requests to the WEB app
      // (e.g. GET localhost:3001/account/bookings) — a path that never starts with
      // "/api/v1/auth", so a narrower path silently hid the cookie from that check and made
      // proxy.ts redirect every fresh/hard navigation to those routes to /login even when fully
      // authenticated (found while verifying Phase 3B's /account/bookings page). Only
      // /auth/refresh and /auth/logout ever read this cookie server-side regardless of path.
      path: '/',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(response: Response): void {
    // Attributes must mirror setRefreshCookie's: a browser only removes a cookie when the
    // clearing Set-Cookie matches the stored one, so logout would silently leave a
    // SameSite=None/Secure cookie in place if these were omitted.
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      sameSite: CROSS_SITE_COOKIES ? 'none' : 'lax',
      secure: CROSS_SITE_COOKIES,
      path: '/',
    });
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
    this.setRefreshCookie(res, result.tokens.refreshToken);
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
