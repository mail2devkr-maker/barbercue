// Cross-cutting constants shared by the backend (route/controller definitions) and clients
// (URL construction) — kept here so the literal never has to be duplicated or drift between them.

// Matches the backend's HealthController's @Controller() path. Clients build the full URL as
// `${API_BASE_URL}/${HEALTH_PATH}`, where API_BASE_URL already includes the /api/v1 prefix.
export const HEALTH_PATH = 'health';

// Sub-paths under AuthController's `@Controller('auth')` prefix — used directly as `@Post(...)`
// decorator arguments on the backend, and as `${API_BASE_URL}/auth/${AUTH_PATHS.otpRequest}` on
// clients. Kept here so the literal path strings never drift between the two.
export const AUTH_PATHS = {
  otpRequest: 'otp/request',
  otpVerify: 'otp/verify',
  staffLogin: 'staff/login',
  adminLogin: 'admin/login',
  refresh: 'refresh',
  logout: 'logout',
  logoutAll: 'logout-all',
  sessions: 'sessions',
  forgotPassword: 'forgot-password',
  resetPassword: 'reset-password',
  me: 'me',
} as const;

// Name of the httpOnly cookie the backend sets/reads for web refresh-token delivery. Shared so
// the web app's fetch wrapper knows to send credentials, without needing to know the token value.
export const REFRESH_TOKEN_COOKIE_NAME = 'barbercue_refresh_token';
