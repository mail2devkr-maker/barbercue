"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./dashboard.module.css";

// Issue #13 Mission B: real production review found no way back from Customers to the rest of
// the shop-management area — every section page was an island. This is the standardized,
// persistent nav across ALL 13 shop-management sections (not the 6-step SetupNavigation wizard,
// which is a linear onboarding flow, not an ongoing-operations nav, and doesn't cover
// bookings/schedule/customers/analytics/reviews/verification at all). Rendered once by
// [salonId]/layout.tsx, so no current or future section page can "forget" it and dead-end again.
const SHOP_SECTIONS = [
  { id: "queue", label: "Live queue" },
  { id: "settings", label: "Set up & open" },
  { id: "bookings", label: "Bookings" },
  { id: "schedule", label: "Schedule" },
  { id: "customers", label: "Customers" },
  { id: "analytics", label: "Analytics" },
  { id: "reviews", label: "Reviews" },
  { id: "verification", label: "Verification" },
  { id: "services", label: "Services" },
  { id: "hours", label: "Hours" },
  { id: "photos", label: "Photos" },
  { id: "chairs", label: "Chairs" },
  { id: "staff", label: "Barbers" },
] as const;

export function OwnerShopNav({ salonId }: { salonId: string }) {
  const pathname = usePathname();
  // Everything after `/dashboard/salons/{salonId}/` up to the next slash — works for both a bare
  // section (`.../customers`) and a nested route within one (`.../schedule/2026-09-03`).
  const currentSection = pathname
    .split(`/dashboard/salons/${salonId}/`)[1]
    ?.split("/")[0];

  return (
    <nav className={styles.shopNav} aria-label="Shop management sections">
      <ul className={styles.shopNavRail}>
        {SHOP_SECTIONS.map((section) => {
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
