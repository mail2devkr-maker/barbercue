/**
 * Reads the single-use invitation token from the URL fragment (#t=...) and removes it from the address bar and the
 * session history at once. Returns "" when there is no well-formed token. A fragment is never sent to any server, so the
 * token cannot appear in access logs, proxies, analytics or a Referer header.
 */
export function readInvitationToken(): string {
  if (typeof window === "undefined") return "";
  const match = /^#t=([a-f0-9]{64})$/.exec(window.location.hash);
  if (window.location.hash) {
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // Nothing more can be done; the token is still only in this tab's memory.
    }
  }
  return match ? match[1] : "";
}
