"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Role } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import styles from "./dashboard.module.css";

// Issue #13 Mission B: real production review found no way back from Customers to the rest of
// the shop-management area — every section page was an island. This is the standardized,
// persistent nav across ALL 13 shop-management sections (not the 6-step SetupNavigation wizard,
// which is a linear onboarding flow, not an ongoing-operations nav, and doesn't cover
// bookings/schedule/customers/analytics/reviews/verification at all). Rendered once by
// [salonId]/layout.tsx, so no current or future section page can "forget" it and dead-end again.
//
// `adminEnabled` (Part 2, admin delegated shop management) marks exactly the sections
// SalonAccessService.assertOwnerOrAdminAccess actually backs today (settings — profile/timezone/
// payment-QR all live on that one page — plus services/hours/photos/chairs/staff). Queue,
// bookings, schedule, customers, analytics, reviews and verification all still gate on the
// owner/staff-only assertAccess/assertOwnerAccess untouched by Part 2, so a PLATFORM_ADMIN
// following any of those links would get a real 403 — this is the single source of truth for
// which links to even show a delegated-admin session, rather than a second hard-coded list
// somewhere else (see settings/page.tsx's own history: it used to keep a duplicate of this exact
// list, removed once this component started covering the same ground).
const SHOP_SECTIONS = [
  { id: "queue", label: "Live queue", adminEnabled: false },
  { id: "settings", label: "Set up & open", adminEnabled: true },
  { id: "bookings", label: "Bookings", adminEnabled: false },
  { id: "schedule", label: "Schedule", adminEnabled: false },
  { id: "customers", label: "Customers", adminEnabled: false },
  { id: "analytics", label: "Analytics", adminEnabled: false },
  { id: "reviews", label: "Reviews", adminEnabled: false },
  { id: "verification", label: "Verification", adminEnabled: false },
  { id: "services", label: "Services", adminEnabled: true },
  { id: "hours", label: "Hours", adminEnabled: true },
  { id: "photos", label: "Photos", adminEnabled: true },
  { id: "chairs", label: "Chairs", adminEnabled: true },
  { id: "staff", label: "Barbers", adminEnabled: true },
] as const;

export function OwnerShopNav({ salonId }: { salonId: string }) {
  const pathname = usePathname();
  const { user } = useAuth();
  // A dual-role user (rare) who happens to also be PLATFORM_ADMIN still gets the restricted view —
  // same conservative call AdminManagingBanner already makes: showing the disclosure/restriction
  // is never the wrong choice, only silently granting extra reach would be.
  const isDelegatedAdmin = Boolean(user?.roles.includes(Role.PLATFORM_ADMIN));
  const sections = isDelegatedAdmin
    ? SHOP_SECTIONS.filter((section) => section.adminEnabled)
    : SHOP_SECTIONS;
  // Everything after `/dashboard/salons/{salonId}/` up to the next slash — works for both a bare
  // section (`.../customers`) and a nested route within one (`.../schedule/2026-09-03`).
  const currentSection = pathname
    .split(`/dashboard/salons/${salonId}/`)[1]
    ?.split("/")[0];

  return (
    <nav className={styles.shopNav} aria-label="Shop management sections">
      <ul className={styles.shopNavRail}>
        {sections.map((section) => {
          const isCurrent = section.id === currentSection;
          return (
            <li key={section.id}>
              <Link
                href={`/dashboard/salons/${salonId}/${section.id}`}
                className={`${styles.shopNavItem} ${isCurrent ? styles.shopNavItemCurrent : ""}`}
                aria-current={isCurrent ? "page" : undefined}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
