/**
 * Validates a `?next=` value before it is used as a post-login redirect target.
 *
 * `next` arrives from the query string, so it is attacker-controlled: a link like
 * `/login?next=https://evil.example/login` would otherwise bounce a user who just authenticated
 * straight onto a look-alike page. Only same-app absolute paths are allowed through; anything
 * else returns null and the caller falls back to its own default landing route.
 *
 * Rejected, specifically:
 *  - absolute URLs with a scheme            https://evil.test, javascript:alert(1)
 *  - protocol-relative URLs                 //evil.test  (browsers treat these as external)
 *  - backslash variants                     /\evil.test, \\evil.test  (some parsers normalise
 *                                           these to protocol-relative)
 *  - anything not starting with a single "/"
 *
 * Kept deliberately allow-list-shaped: the only accepted form is one leading slash followed by a
 * path, so a new bypass would have to look like a legitimate internal route.
 */
/** Control characters (NUL..US and DEL) can confuse URL parsing or split a header. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;

  // Control characters (including encoded newlines) can split headers or confuse URL parsing.
  if (hasControlChar(next)) return null;

  // Must be a rooted path, and the second character must not turn it into an authority.
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;

  // A scheme can only appear before the first "/", so a rooted path cannot legitimately contain
  // one — but normalise-then-check anyway rather than trusting the prefix test alone.
  try {
    const url = new URL(next, "https://barbercue.invalid");
    if (url.origin !== "https://barbercue.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Builds the `?next=` suffix for a login redirect, so a guard can send an unauthenticated visitor
 * to sign in and return them to where they were actually going.
 */
export function withNextParam(loginPath: string, next: string): string {
  const safe = safeNextPath(next);
  if (!safe || safe === "/") return loginPath;
  const separator = loginPath.includes("?") ? "&" : "?";
  return `${loginPath}${separator}next=${encodeURIComponent(safe)}`;
}
