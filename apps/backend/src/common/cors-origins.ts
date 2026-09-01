/**
 * Explicit-allowlist CORS origins, replacing the previous `origin: true` (reflect-any-origin)
 * configuration — dangerous specifically because this API pairs it with `credentials: true` for
 * the httpOnly refresh-token cookie, meaning ANY website could previously have made
 * credentialed, cookie-bearing requests against this API from a victim's browser. Native mobile
 * clients are never subject to browser CORS at all, so this only affects browser-origin callers.
 *
 * CORS_ALLOWED_ORIGINS (comma-separated) is the source of truth when set. Production without it
 * set falls back to the two known-legitimate production web origins (fastque.com and the
 * Railway-generated domain) rather than the previous open-to-the-internet behavior — but setting
 * the env var explicitly is the intended, documented path (see .env.example).
 */
export function resolveCorsOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = env.CORS_ALLOWED_ORIGINS?.trim();
  if (configured) {
    return configured
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  if (env.NODE_ENV === 'production') {
    return [
      'https://fastque.com',
      'https://barbercueweb-production.up.railway.app',
    ];
  }

  // Development/test default — every local web dev port this repo's own scripts use, plus
  // WEB_BASE_URL in case a worktree overrides it to something else local.
  const devOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
  ]);
  const webBaseUrl = env.WEB_BASE_URL?.trim();
  if (webBaseUrl) devOrigins.add(webBaseUrl);
  return [...devOrigins];
}
