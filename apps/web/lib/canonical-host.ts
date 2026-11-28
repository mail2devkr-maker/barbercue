export function canonicalHostRedirectUrl(requestUrl: string, hostHeader: string | null): URL | null {
  let hostname: string;
  try {
    const requestHost = hostHeader?.split(",", 1)[0]?.trim() || new URL(requestUrl).host;
    hostname = new URL(`https://${requestHost}`).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (hostname !== "www.fastque.com") return null;

  const redirect = new URL(requestUrl);
  redirect.protocol = "https:";
  redirect.hostname = "fastque.com";
  redirect.port = "";
  return redirect;
}
