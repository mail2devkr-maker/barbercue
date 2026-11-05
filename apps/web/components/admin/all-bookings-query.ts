/** All Bookings (admin) helpers: query string and IST display. Pure and unit-tested. */
export interface AdminBookingsFilters {
  shop: string;
  status: string;
  from: string;
  to: string;
}

export function adminBookingsQuery(
  f: AdminBookingsFilters,
  cursor?: string,
): string {
  const p = new URLSearchParams();
  if (f.shop.trim()) p.set("shop", f.shop.trim());
  if (f.status) p.set("status", f.status);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) p.set("from", f.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) p.set("to", f.to);
  if (cursor) p.set("cursor", cursor);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function istDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
