/**
 * Self-hosted model endpoints may only live on loopback, RFC1918, link-local, *.local or Railway
 * private networking (*.railway.internal). A public URL (a paid cloud API, a tunnel to someone's
 * home PC) is rejected, so a self-hosted provider can never be silently pointed off-platform.
 * Credentials in the URL are rejected too.
 */
export function isPrivateModelUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return false;
  const h = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    h === 'localhost' ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h.endsWith('.local') ||
    h.endsWith('.railway.internal')
  );
}
