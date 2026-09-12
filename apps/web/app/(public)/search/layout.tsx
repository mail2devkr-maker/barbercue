import { CustomerShell } from "../../../components/layout/CustomerShell";

// Public/unauthenticated page — CustomerHeader/Footer render for anonymous visitors too (Account
// area shows "Sign in" instead of the account menu). No RequireRole here; this route was never
// gated and stays that way.
//
// `dark`: owner correction — /search must match the approved landing page's premium dark system,
// including its header/footer chrome, not the cream default every other CustomerShell page still
// uses. This is the only route currently opted in.
export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return <CustomerShell dark>{children}</CustomerShell>;
}
