"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Role, type CrmMeDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useCrmMe } from "../../lib/crm";
import s from "./crm.module.css";

const CrmMeContext = createContext<CrmMeDto | null>(null);
/** The signed-in person's CRM role and permissions (from crm/me). */
export const useMe = () => useContext(CrmMeContext);

interface NavItem {
  href: string;
  label: string;
  icon: string;
  group?: string;
  exact?: boolean;
}
const NAV: NavItem[] = [
  { href: "/employee", label: "Dashboard", icon: "▦", exact: true },
  { href: "/employee/leads", label: "Leads", icon: "◉" },
  { href: "/employee/activity/tasks", label: "Tasks", icon: "☑", group: "Activity" },
  { href: "/employee/activity/meetings", label: "Meetings", icon: "▤", group: "Activity" },
  { href: "/employee/activity/calls", label: "Calls", icon: "☎", group: "Activity" },
  { href: "/employee/onboarding", label: "Salon onboarding", icon: "✦", group: "Field" },
  { href: "/employee/conversations", label: "Sales conversations", icon: "🎙", group: "Field" },
  { href: "/employee/field", label: "Visits & follow-ups", icon: "◷", group: "Field" },
  { href: "/employee/support", label: "Support", icon: "✚", group: "More" },
  { href: "/employee/analytics", label: "Analytics", icon: "▥", group: "More" },
  { href: "/employee/notifications", label: "Notifications", icon: "🔔", group: "More" },
  { href: "/employee/profile", label: "My profile", icon: "👤", group: "More" },
];
const BOTTOM = ["/employee", "/employee/leads", "/employee/activity/calls", "/employee/onboarding", "/employee/notifications"];

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The field employee portal frame (/employee/*): FIELD_EXECUTIVE only; everything else redirects to
 * the employee login. Managers and admins use the same modules inside the admin dashboard.
 */
export function CrmShell({ title, eyebrow = "FastQue / Employee workspace", sub, actions, children }: { title: string; eyebrow?: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "/employee";
  const allowed = status === "authenticated" && !!user?.roles.includes(Role.FIELD_EXECUTIVE);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const { me, error } = useCrmMe();

  useEffect(() => {
    if (status === "loading") return;
    if (!allowed) router.replace("/employee/login");
  }, [allowed, router, status]);
  useEffect(() => {
    if (!allowed) return;
    apiFetch<{ unread: number }>("crm/notifications").then((n) => setUnread(n.unread)).catch(() => undefined);
  }, [allowed, pathname]);

  if (!allowed) return <main className={s.frame}><p className={s.empty} style={{ margin: 24 }} aria-busy="true">Checking your access…</p></main>;
  const initials = (me?.employee?.fullName ?? user?.email ?? "FQ").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <CrmMeContext.Provider value={me}>
      <div className={s.frame}>
        <aside className={`${s.side} ${open ? s.sideOpen : ""}`} aria-label="CRM navigation">
          <Link href="/employee" className={s.brand} onClick={() => setOpen(false)}>
            <strong>
              ◆ Fast<em>Que</em>
            </strong>
            <span>FIELD OPERATIONS</span>
          </Link>
          {NAV.map((item, i) => {
            const header = item.group && item.group !== NAV[i - 1]?.group ? item.group : null;
            return (
              <div key={item.href}>
                {header && <div className={s.navGroup}>{header}</div>}
                <Link href={item.href} className={s.navItem} aria-current={isActive(pathname, item) ? "page" : undefined} onClick={() => setOpen(false)}>
                  <span>
                    <span aria-hidden="true" style={{ marginRight: 10 }}>{item.icon}</span>
                    {item.label}
                  </span>
                  {item.href === "/employee/notifications" && unread > 0 && <span className={s.navBadge}>{unread}</span>}
                </Link>
              </div>
            );
          })}
          <div className={s.sideFoot}>
            <strong style={{ color: "var(--c-text)" }}>{me?.employee?.fullName ?? "Field partner"}</strong>
            <div>{me?.employee ? `${me.employee.employeeCode}${me.employee.territory ? ` · ${me.employee.territory}` : ""}` : ""}</div>
            <button type="button" className={s.link} style={{ marginTop: 8 }} onClick={() => void logout()}>Sign out</button>
          </div>
        </aside>
        {open && <div className={s.overlay} style={{ zIndex: 65, background: "rgba(5,3,10,0.5)" }} onClick={() => setOpen(false)} aria-hidden="true" />}
        <main className={s.main}>
          <div className={s.head}>
            <div>
              <button type="button" className={`${s.btn} ${s.btnSm} ${s.menuBtn}`} onClick={() => setOpen(true)} aria-label="Open menu">☰ Menu</button>
              <div className={s.eyebrow}>{eyebrow}</div>
              <h1 className={s.title}>{title}</h1>
              {sub && <p className={s.sub}>{sub}</p>}
            </div>
            <div className={s.toolbar} style={{ marginBottom: 0 }}>
              {actions}
              <span className={s.avatar} aria-hidden="true">{initials}</span>
            </div>
          </div>
          {error && <p className={`${s.alert} ${s.alertError}`}>{error}</p>}
          {children}
        </main>
        <nav className={s.bottomNav} aria-label="Quick navigation">
          {BOTTOM.map((href) => {
            const item = NAV.find((n) => n.href === href)!;
            return (
              <Link key={href} href={href} aria-current={isActive(pathname, item) ? "page" : undefined}>
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </CrmMeContext.Provider>
  );
}

/** Manager/admin embedding: the same modules without the employee frame (inside the admin dashboard). */
export function CrmEmbedded({ children }: { children: ReactNode }) {
  const { me, error } = useCrmMe();
  return (
    <CrmMeContext.Provider value={me}>
      <div className={`${s.frame} ${s.embedded}`}>
        {error && <p className={`${s.alert} ${s.alertError}`}>{error}</p>}
        {children}
      </div>
    </CrmMeContext.Provider>
  );
}
