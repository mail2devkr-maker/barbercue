import type { IconName } from "./icons";

// The ONE definition of the owner/staff dashboard's navigation. The sidebar, the icon rail, the
// mobile bottom bar and the global search all read this list, so a menu entry can never exist in one
// place and be missing (or dead) in another. Every `path` MUST be a real page - a test walks the app
// directory and fails if one is not (see owner-nav.test.jsx) - and an item whose feature FastQue does
// not have (inventory, payroll, ...) is deliberately not listed at all rather than shown disabled.

export type NavGroupId = "HOME" | "OPERATIONS" | "TEAM" | "BUSINESS" | "SHOP" | "OTHER";
export type NavAudience = "owner" | "staff" | "both";
export type NavBadge = "waiting" | "inService" | "unread";

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  group: NavGroupId;
  audience: NavAudience;
  /** Path under /dashboard/salons/:salonId ("" = the overview). Absent for site-level links. */
  path?: string;
  /** Query string that selects a view within the page (kept separate so "active" can ignore it). */
  query?: string;
  /** A site-level route outside the salon (Help). */
  href?: string;
  /** Open `href` in a new tab so the dashboard (and its session) stays exactly where it was. */
  newTab?: boolean;
  badge?: NavBadge;
  /** Short description used by global search ("Open Analytics..."). */
  keywords?: string[];
}

export const NAV_GROUPS: ReadonlyArray<{ id: NavGroupId; label: string; icon: IconName }> = [
  { id: "HOME", label: "Home", icon: "home" },
  { id: "OPERATIONS", label: "Operations", icon: "queue" },
  { id: "TEAM", label: "Team", icon: "team" },
  { id: "BUSINESS", label: "Business", icon: "chart" },
  { id: "SHOP", label: "Shop", icon: "store" },
  { id: "OTHER", label: "More", icon: "help" },
];

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: "overview", label: "Dashboard", icon: "home", group: "HOME", audience: "both", path: "", keywords: ["overview", "home", "my day"] },

  { id: "queue", label: "Live Queue", icon: "queue", group: "OPERATIONS", audience: "both", path: "queue", query: "view=waiting", badge: "waiting", keywords: ["waiting", "tokens"] },
  { id: "in-service", label: "In Service", icon: "scissors", group: "OPERATIONS", audience: "both", path: "queue", query: "view=in-service", badge: "inService", keywords: ["seated", "chairs"] },
  { id: "bookings", label: "Bookings", icon: "calendar", group: "OPERATIONS", audience: "owner", path: "bookings", keywords: ["appointments", "cancel"] },
  { id: "calendar", label: "Calendar", icon: "calendarGrid", group: "OPERATIONS", audience: "owner", path: "schedule", keywords: ["schedule", "day"] },
  { id: "customers", label: "Customers", icon: "users", group: "OPERATIONS", audience: "owner", path: "customers", keywords: ["clients", "dues"] },

  { id: "staff", label: "Staff / Barbers", icon: "team", group: "TEAM", audience: "owner", path: "staff", keywords: ["barbers", "invite", "access"] },
  { id: "staff-schedule", label: "Staff Schedule", icon: "clock", group: "TEAM", audience: "owner", path: "team", query: "tab=schedule", keywords: ["working hours", "shifts"] },
  { id: "staff-performance", label: "Staff Performance", icon: "trend", group: "TEAM", audience: "owner", path: "team", query: "tab=performance", keywords: ["productivity"] },

  { id: "analytics", label: "Analytics", icon: "chart", group: "BUSINESS", audience: "owner", path: "analytics", keywords: ["reports", "peak hours"] },
  { id: "revenue", label: "Revenue", icon: "rupee", group: "BUSINESS", audience: "owner", path: "revenue", keywords: ["income", "sales"] },
  { id: "booking-sources", label: "Booking Sources", icon: "trend", group: "BUSINESS", audience: "owner", path: "booking-sources", keywords: ["campaign", "facebook", "instagram", "where bookings come from"] },
  { id: "payments", label: "Payments", icon: "card", group: "BUSINESS", audience: "owner", path: "payments", keywords: ["received", "refunds"] },
  { id: "invoices", label: "Billing / Invoices", icon: "receipt", group: "BUSINESS", audience: "owner", path: "invoices", keywords: ["invoice", "gst", "pdf"] },
  { id: "cancellations", label: "Cancellations", icon: "alert", group: "BUSINESS", audience: "owner", path: "cancellations", keywords: ["cancelled", "reasons"] },
  { id: "reviews", label: "Reviews", icon: "star", group: "BUSINESS", audience: "owner", path: "reviews", keywords: ["ratings", "feedback"] },

  { id: "services", label: "Services", icon: "tag", group: "SHOP", audience: "owner", path: "services", keywords: ["prices", "menu"] },
  { id: "settings", label: "Shop Settings", icon: "settings", group: "SHOP", audience: "owner", path: "settings", keywords: ["profile", "timezone"] },
  { id: "hours", label: "Working Hours", icon: "clock", group: "SHOP", audience: "owner", path: "hours", keywords: ["opening", "closing"] },
  { id: "chairs", label: "Chairs", icon: "chair", group: "SHOP", audience: "owner", path: "chairs", keywords: ["seats"] },
  { id: "payment-qr", label: "Payment QR", icon: "qr", group: "SHOP", audience: "owner", path: "payment-qr", keywords: ["upi", "scan"] },
  { id: "notifications", label: "Notifications", icon: "bell", group: "SHOP", audience: "both", path: "notifications", badge: "unread", keywords: ["alerts", "inbox"] },

  // Help is a public page, so it opens in a NEW tab: ordinary dashboard navigation never leaves the
  // signed-in owner area. (There is deliberately no "Account settings" link into /account: that area
  // is the customer's, gated to customer accounts, and would bounce an owner to the customer login.)
  { id: "help", label: "Help & Support", icon: "help", group: "OTHER", audience: "both", href: "/contact-us", newTab: true, keywords: ["contact", "faq"] },
];

/** Items a given kind of user may see (presentation only - every API re-checks on the server). */
export function navItemsFor(kind: "owner" | "staff"): NavItem[] {
  return NAV_ITEMS.filter((item) => item.audience === "both" || item.audience === kind);
}

export function hrefFor(item: NavItem, salonId: string): string {
  if (item.href) return item.href;
  const base = `/dashboard/salons/${salonId}${item.path ? `/${item.path}` : ""}`;
  return item.query ? `${base}?${item.query}` : base;
}

/** Which item is "current" for a pathname + query string. A page shared by several items (the queue
 * console, the team page) is disambiguated by its `view`/`tab` query, never by guessing. */
export function activeItemId(pathname: string, search: string, salonId: string, items: ReadonlyArray<NavItem>): string | null {
  const prefix = `/dashboard/salons/${salonId}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/^\/+|\/+$/g, "");
  const first = rest.split("/")[0] ?? "";
  const params = new URLSearchParams(search);
  const candidates = items.filter((item) => item.path !== undefined && item.path === first);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  const wanted = candidates.find((item) => {
    if (!item.query) return false;
    const [key, value] = item.query.split("=");
    return params.get(key) === value;
  });
  return (wanted ?? candidates[0]).id;
}
