"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../components/auth/RequireRole";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import styles from "./account-shell.module.css";

const ACCOUNT_LINKS = [
  { href: "/account/bookings", label: "Overview" },
  { href: "/account/profile", label: "Profile & security" },
  { href: "/account/premium", label: "Premium" },
] as const;

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <RequireRole roles={[Role.CUSTOMER]} redirectTo="/login">
      <CustomerShell>
        <main className={styles.main}>
          <nav className={styles.accountNav} aria-label="Customer account">
            <div className={styles.accountLinks}>
              {ACCOUNT_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={styles.accountLink}
                  aria-current={pathname === link.href ? "page" : undefined}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <Link href="/style-advisor" className={styles.styleAdvisorLink}>
              AI Style Advisor <span aria-hidden="true">→</span>
            </Link>
          </nav>
          <div className={styles.content}>{children}</div>
        </main>
      </CustomerShell>
    </RequireRole>
  );
}
