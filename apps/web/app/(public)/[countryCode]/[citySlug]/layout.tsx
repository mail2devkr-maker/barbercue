import { CustomerShell } from "../../../../components/layout/CustomerShell";

// Covers the city page, the locality page (app/(public)/[citySlug]/areas/[localitySlug]), and the
// salon profile page (app/(public)/[citySlug]/[salonSlug]) — all three are descendants of this
// segment, so one layout wraps all of them via normal Next.js layout nesting. The landing page
// (app/(public)/page.tsx) is a sibling of this segment, not a descendant, so it is unaffected.
// Public/unauthenticated — same "Sign in" vs. account-menu behavior as search/layout.tsx.
export default function CityLayout({ children }: { children: React.ReactNode }) {
  return <CustomerShell>{children}</CustomerShell>;
}
