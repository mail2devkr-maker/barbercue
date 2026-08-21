import { CustomerShell } from "../../../components/layout/CustomerShell";

// Public/unauthenticated page — CustomerHeader/Footer render for anonymous visitors too (Account
// area shows "Sign in" instead of the account menu). No RequireRole here; this route was never
// gated and stays that way.
export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return <CustomerShell>{children}</CustomerShell>;
}
