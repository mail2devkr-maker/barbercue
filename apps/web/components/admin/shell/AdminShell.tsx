"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Role } from "@barbercue/shared";
import { useAuth } from "../../../lib/auth-context";
import { BrandLockup } from "../../ui/BrandLockup";
import { NotificationBell } from "../../layout/NotificationBell";
import { Icon } from "../../owner/icons";
import { initialsOf, shortName } from "../../owner/format";
import ui from "../../owner/owner.module.css";
import { COMMAND_CENTER_PRESETS, formatRangeLabel } from "../shop-activity-range";
import { ADMIN_NAV_GROUPS, activeAdminItem, adminNavFor, hrefOf } from "./admin-nav";
import { AdminFiltersProvider, useAdminFilters } from "./admin-filters";
import shell from "./admin-shell.module.css";

const ROLE_LABEL: Partial<Record<Role, string>> = {
  [Role.PLATFORM_ADMIN]: "Platform admin",
  [Role.CO_FOUNDER]: "Co-founder",
  [Role.HR_ADMIN]: "HR admin",
  [Role.SALES_ADMIN]: "Sales admin",
  [Role.PLATFORM_VIEWER]: "Read-only viewer",
};

/**
 * The admin application frame: the same rail + sidebar + toolbar layout and styles as the salon
 * owner dashboard (owner.module.css), with its own navigation (admin-nav.ts) and a shared reporting
 * period. Presentation only - every admin API re-checks the caller's role on the server.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AdminFiltersProvider>
      <Suspense fallback={<div className={ui.root} />}>
        <ShellInner>{children}</ShellInner>
      </Suspense>
    </AdminFiltersProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const roles = user?.roles ?? [];
  const items = adminNavFor(roles);
  const active = activeAdminItem(items, pathname, search);
  const groups = ADMIN_NAV_GROUPS.filter((g) => items.some((i) => i.group === g.id));
  const roleLabel = roles.map((r) => ROLE_LABEL[r]).find(Boolean) ?? "Admin";
  const displayName = user?.email ?? user?.phone ?? "Account";

  // The public site paints a light page background; behind the dark admin frame it would show as a
  // light band below short pages, so the page background matches the shell while the shell is mounted.
  useEffect(() => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#101016"; // owner.module.css --os-bg
    return () => {
      document.body.style.backgroundColor = previous;
    };
  }, []);

  // Close the phone drawer and the account menu on every navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient UI when the route changes
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [pathname, search]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    router.push("/admin/login");
  }

  return (
    <div className={`${ui.root} ${shell.root}`}>
      <a href="#admin-main" className={ui.skipLink}>
        Skip to content
      </a>
      <div className={ui.app}>
        <nav className={`${ui.rail} ${shell.rail}`} aria-label="Sections">
          <Link href="/dashboard/admin" className={ui.railLogo} aria-label="Admin home" title="Admin home">
            <BrandLockup compact markOnly />
          </Link>
          {groups.map((group) => {
            const first = items.find((i) => i.group === group.id && i.status === "live") ?? items.find((i) => i.group === group.id)!;
            const isActive = active?.group === group.id;
            return (
              <Link
                key={group.id}
                href={hrefOf(first)}
                className={`${ui.railBtn} ${isActive ? ui.railBtnActive : ""}`}
                aria-current={isActive ? "true" : undefined}
                title={group.label}
              >
                <Icon name={group.icon} size={22} />
                <span>{group.label.split(" ")[0]}</span>
              </Link>
            );
          })}
          <span className={ui.railSpacer} />
        </nav>

        <aside id="admin-sidebar" className={`${ui.sidebar} ${drawerOpen ? ui.sidebarOpen : ""}`} aria-label="Admin navigation">
          <div className={ui.sidebarHead}>
            <div className={ui.brandRow}>
              <BrandLockup compact canonicalArtwork />
            </div>
            <div className={ui.shopName}>FastQue Admin</div>
            <div className={ui.shopSub}>{roleLabel}</div>
          </div>
          {groups.map((group) => (
            <div key={group.id}>
              <div className={ui.navGroupLabel}>{group.label}</div>
              <ul className={ui.navList}>
                {items
                  .filter((i) => i.group === group.id)
                  .map((item) => {
                    const isActive = active?.id === item.id;
                    return (
                      <li key={item.id}>
                        <Link
                          href={hrefOf(item)}
                          className={`${ui.navLink} ${isActive ? ui.navLinkActive : ""}`}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <span className={ui.navLabel}>{item.label}</span>
                          {item.status === "planned" && <span className={shell.soon}>Planned</span>}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          <ul className={ui.navList}>
            <li>
              <button type="button" className={ui.navLink} onClick={() => void handleLogout()}>
                <Icon name="logout" />
                <span className={ui.navLabel}>Log out</span>
              </button>
            </li>
          </ul>
        </aside>
        <div className={drawerOpen ? ui.scrimOpen : ui.scrim} onClick={() => setDrawerOpen(false)} aria-hidden="true" />

        <div className={ui.main}>
          <header className={ui.topbar}>
            <button
              type="button"
              className={`${ui.iconBtn} ${ui.menuBtn}`}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              aria-controls="admin-sidebar"
              onClick={() => setDrawerOpen((open) => !open)}
            >
              <Icon name={drawerOpen ? "close" : "menu"} />
            </button>
            <DateRangeControl />
            <div className={ui.topbarRight}>
              <span className={shell.scope} title="Geography filters arrive with sales territories (Phase 2)">
                All India · IST
              </span>
              {user && <NotificationBell />}
              <div className={ui.menuWrap} ref={menuRef}>
                <button
                  type="button"
                  className={ui.avatarBtn}
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <span className={ui.avatar}>{initialsOf(displayName)}</span>
                  <span className={ui.avatarName}>{shortName(displayName)}</span>
                </button>
                {menuOpen && (
                  <div className={ui.menuPanel} role="menu">
                    <div className={ui.menuWho}>
                      <div className={ui.menuWhoName}>{displayName}</div>
                      <div className={ui.menuWhoSub}>{roleLabel}</div>
                    </div>
                    <button type="button" className={ui.menuItem} role="menuitem" onClick={() => void handleLogout()}>
                      <Icon name="logout" /> Log out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          {/* Pages supply their own <main> landmark. */}
          <div id="admin-main" className={`${ui.content} ${shell.content}`} tabIndex={-1}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top-bar reporting period: quick picks plus a custom range, shared by every admin page. */
function DateRangeControl() {
  const { range, setPreset, setCustom } = useAdminFilters();
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState({ from: range.from, to: range.to });
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={shell.range}>
      <label htmlFor="admin-range" className={ui.srOnly}>
        Reporting period
      </label>
      <Icon name="calendar" className={shell.rangeIcon} />
      <select
        id="admin-range"
        className={shell.rangeSelect}
        value={range.preset}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "custom") {
            setDraft({ from: range.from, to: range.to });
            setError(null);
            setCustomOpen(true);
          } else {
            setCustomOpen(false);
            setPreset(value as Exclude<typeof range.preset, "custom">);
          }
        }}
      >
        {COMMAND_CENTER_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range…</option>
      </select>
      <span className={shell.rangeLabel}>{formatRangeLabel(range.from, range.to)}</span>
      {customOpen && (
        <form
          className={shell.rangePanel}
          onSubmit={(event) => {
            event.preventDefault();
            const message = setCustom(draft.from, draft.to);
            setError(message);
            if (!message) setCustomOpen(false);
          }}
        >
          <label>
            From
            <input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          </label>
          <label>
            To
            <input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </label>
          <button type="submit" className={`${ui.btn} ${ui.btnPrimary} ${ui.btnSm}`}>
            Apply
          </button>
          <button type="button" className={`${ui.btn} ${ui.btnQuiet} ${ui.btnSm}`} onClick={() => setCustomOpen(false)}>
            Cancel
          </button>
          {error && (
            <p className={shell.rangeError} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
