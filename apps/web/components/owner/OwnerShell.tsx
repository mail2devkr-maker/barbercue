"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DASHBOARD_PATHS, DISCOVERY_PATHS, Role } from "@barbercue/shared";
import type { CapacitySummaryDto, OwnerSearchResultDto, SalonWorkplaceDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { rememberLastShop } from "../../lib/last-shop";
import { getRealtimeSocket, joinSalonRoom, onReconnect } from "../../lib/realtime";
import { AdminManagingBanner } from "../dashboard/AdminManagingBanner";
import { MaintenanceNotice } from "../layout/MaintenanceNotice";
import { Icon } from "./icons";
import { BrandLockup } from "../ui/BrandLockup";
import { NAV_GROUPS, NAV_ITEMS, activeItemId, hrefFor, navItemsFor, type NavItem } from "./owner-nav";
import { initialsOf, shortName } from "./format";
import ui from "./owner.module.css";

export type ShopKind = "owner" | "staff";

interface ShellContextValue {
  salonId: string;
  salonName: string | null;
  /** What the signed-in user is at THIS shop. Presentation only: every API re-checks on the server. */
  kind: ShopKind;
  isAdmin: boolean;
  counts: { waiting: number; inService: number; unread: number };
  workplaces: SalonWorkplaceDto[];
  refreshCounts: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useOwnerShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useOwnerShell must be used inside <OwnerShell>");
  return ctx;
}

const COUNT_POLL_MS = 45_000;

export function OwnerShell({ salonId, children }: { salonId: string; children: ReactNode }) {
  // useSearchParams needs a Suspense boundary; the shell itself is cheap, so the fallback is empty.
  return (
    <Suspense fallback={<div className={ui.root} />}>
      <ShellInner salonId={salonId}>{children}</ShellInner>
    </Suspense>
  );
}

function ShellInner({ salonId, children }: { salonId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout } = useAuth();
  const search = searchParams.toString();

  const [workplaces, setWorkplaces] = useState<SalonWorkplaceDto[]>([]);
  // True once the server's list of shops this user may operate has actually arrived.
  const [workplacesLoaded, setWorkplacesLoaded] = useState(false);
  const [counts, setCounts] = useState({ waiting: 0, inService: 0, unread: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = Boolean(user?.roles.includes(Role.PLATFORM_ADMIN));
  const workplace = workplaces.find((w) => w.id === salonId) ?? null;
  // Until the workplace list arrives, fall back to the roles in the session so the first paint is
  // already the right menu for an owner-only or a barber-only account.
  const kind: ShopKind = workplace
    ? workplace.isOwner || isAdmin
      ? "owner"
      : "staff"
    : user?.roles.includes(Role.SALON_OWNER) || isAdmin
      ? "owner"
      : "staff";

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonWorkplaceDto[]>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.workplaces}`)
      .then((list) => {
        if (cancelled) return;
        setWorkplaces(list);
        setWorkplacesLoaded(true);
      })
      .catch(() => {
        /* the menu still works from the session roles */
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  // Remember the shop being worked in - but only once the server confirms this user may operate it.
  useEffect(() => {
    if (user && workplace) rememberLastShop(user.id, salonId);
  }, [user, workplace, salonId]);

  // A shop this user no longer (or never) had access to: go to the shop picker rather than sit on a
  // page full of refused requests. A platform admin managing on someone's behalf is exempt - the API
  // authorises each of their actions.
  useEffect(() => {
    if (workplacesLoaded && !workplace && !isAdmin) router.replace("/dashboard/salons?select=1");
  }, [workplacesLoaded, workplace, isAdmin, router]);

  const refreshCounts = useCallback(() => {
    const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
    apiFetch<CapacitySummaryDto>(`${base}/${DASHBOARD_PATHS.capacity}`)
      .then((c) => setCounts((prev) => ({ ...prev, waiting: c.waitingCustomers, inService: c.currentServices })))
      .catch(() => {
        /* badges are a courtesy; a failure leaves the previous numbers */
      });
    apiFetch<{ count: number }>("notifications/mine/unread-count")
      .then((r) => setCounts((prev) => ({ ...prev, unread: r.count })))
      .catch(() => {});
  }, [salonId]);

  useEffect(() => {
    refreshCounts();
    const timer = window.setInterval(refreshCounts, COUNT_POLL_MS);
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const onEvent = (payload: { salonId?: string }) => {
      if (!payload?.salonId || payload.salonId === salonId) refreshCounts();
    };
    socket.on("queue.updated", onEvent);
    const unsubscribeReconnect = onReconnect(refreshCounts);
    return () => {
      window.clearInterval(timer);
      socket.off("queue.updated", onEvent);
      unsubscribeReconnect();
    };
  }, [salonId, refreshCounts]);

  // Close transient UI on navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient UI when the route or search text changes
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

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const items = useMemo(() => navItemsFor(kind), [kind]);
  const currentId = activeItemId(pathname, search, salonId, NAV_ITEMS);
  const currentGroup = NAV_ITEMS.find((i) => i.id === currentId)?.group ?? "HOME";
  const visibleGroups = NAV_GROUPS.filter((g) => items.some((i) => i.group === g.id));
  const ownedShops = workplaces.filter((w) => w.isOwner);

  const ctx = useMemo<ShellContextValue>(
    () => ({ salonId, salonName: workplace?.name ?? null, kind, isAdmin, counts, workplaces, refreshCounts }),
    [salonId, workplace?.name, kind, isAdmin, counts, workplaces, refreshCounts],
  );

  const badgeFor = (item: NavItem): number | null => {
    if (!item.badge) return null;
    const value = item.badge === "waiting" ? counts.waiting : item.badge === "inService" ? counts.inService : counts.unread;
    return value > 0 ? value : null;
  };

  const bottomIds = kind === "owner" ? ["overview", "queue", "bookings", "invoices"] : ["overview", "queue", "in-service", "notifications"];
  const bottomItems = bottomIds.map((id) => items.find((i) => i.id === id)).filter((i): i is NavItem => Boolean(i));

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    router.push("/staff/login");
  }

  const displayName = user?.email ?? user?.phone ?? "Account";

  return (
    <ShellContext.Provider value={ctx}>
      <div className={ui.root}>
        <a href="#owner-main" className={ui.skipLink}>
          Skip to content
        </a>
        <div className={ui.app}>
          {/* ---- narrow icon rail: jump between sections ---- */}
          <nav className={ui.rail} aria-label="Sections">
            <Link href={`/dashboard/salons/${salonId}`} className={ui.railLogo} aria-label="Dashboard home" title="Dashboard home">
              <BrandLockup compact markOnly />
            </Link>
            {/* Only groups that live inside the dashboard: "More" holds Help, a public page that opens in a new tab. */}
            {visibleGroups.filter((group) => group.id !== "OTHER").map((group) => {
              const first = items.find((i) => i.group === group.id)!;
              const active = currentGroup === group.id;
              return (
                <Link
                  key={group.id}
                  href={hrefFor(first, salonId)}
                  className={`${ui.railBtn} ${active ? ui.railBtnActive : ""}`}
                  aria-current={active ? "true" : undefined}
                  title={group.label}
                >
                  <Icon name={group.icon} size={22} />
                  <span>{group.label}</span>
                </Link>
              );
            })}
            <span className={ui.railSpacer} />
          </nav>

          {/* ---- expanded sidebar ---- */}
          <aside
            id="owner-sidebar"
            className={`${ui.sidebar} ${drawerOpen ? ui.sidebarOpen : ""}`}
            aria-label="Main navigation"
          >
            <div className={ui.sidebarHead}>
              <div className={ui.brandRow}>
                <BrandLockup compact canonicalArtwork />
              </div>
              <div className={ui.shopName}>{workplace?.name ?? "Your shop"}</div>
              <div className={ui.shopSub}>{kind === "owner" ? (isAdmin ? "Managing as admin" : "Shop owner") : "Barber"}</div>
            </div>
            {visibleGroups.map((group) => (
              <div key={group.id}>
                {group.id !== "HOME" && <div className={ui.navGroupLabel}>{group.label === "More" ? "Help & account" : group.label}</div>}
                <ul className={ui.navList}>
                  {items
                    .filter((i) => i.group === group.id)
                    .map((item) => {
                      const active = item.id === currentId;
                      const badge = badgeFor(item);
                      return (
                        <li key={item.id}>
                          <Link
                            href={hrefFor(item, salonId)}
                            className={`${ui.navLink} ${active ? ui.navLinkActive : ""}`}
                            aria-current={active ? "page" : undefined}
                            {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          >
                            <Icon name={item.icon} />
                            <span className={ui.navLabel}>
                              {item.id === "overview" && kind === "staff" ? "My day" : item.label}
                              {item.newTab && <span className={ui.srOnly}> (opens in a new tab)</span>}
                            </span>
                            {badge !== null && (
                              <span className={`${ui.navBadge} ${item.badge === "inService" ? ui.navBadgeQuiet : ""}`} aria-label={`${badge} ${item.badge === "unread" ? "unread" : ""}`}>
                                {badge > 99 ? "99+" : badge}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  {group.id === "OTHER" && (
                    <li>
                      <button type="button" className={ui.navLink} onClick={() => void handleLogout()}>
                        <Icon name="logout" />
                        <span className={ui.navLabel}>Log out</span>
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </aside>
          <div className={drawerOpen ? ui.scrimOpen : ui.scrim} onClick={() => setDrawerOpen(false)} aria-hidden="true" />

          {/* ---- main column ---- */}
          <div className={ui.main}>
            <header className={ui.topbar}>
              <button
                type="button"
                className={`${ui.iconBtn} ${ui.menuBtn}`}
                aria-label="Open navigation"
                aria-expanded={drawerOpen}
                aria-controls="owner-sidebar"
                onClick={() => setDrawerOpen((open) => !open)}
              >
                <Icon name={drawerOpen ? "close" : "menu"} />
              </button>
              <GlobalSearch salonId={salonId} kind={kind} />
              <div className={ui.topbarRight}>
                {ownedShops.length > 1 && (
                  <select
                    className={ui.shopSwitch}
                    aria-label="Switch shop"
                    value={salonId}
                    onChange={(e) => router.push(`/dashboard/salons/${e.target.value}`)}
                  >
                    {ownedShops.map((shop) => (
                      <option key={shop.id} value={shop.id}>
                        {shop.name}
                      </option>
                    ))}
                  </select>
                )}
                <Link
                  href={`/dashboard/salons/${salonId}/notifications`}
                  className={ui.iconBtn}
                  aria-label={counts.unread > 0 ? `Notifications, ${counts.unread} unread` : "Notifications"}
                >
                  <Icon name="bell" />
                  {counts.unread > 0 && (
                    <span className={ui.navBadge} style={{ position: "absolute", top: -6, right: -6 }}>
                      {counts.unread > 99 ? "99+" : counts.unread}
                    </span>
                  )}
                </Link>
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
                        <div className={ui.menuWhoSub}>{kind === "owner" ? "Shop owner" : "Barber"} · {workplace?.name ?? "this shop"}</div>
                      </div>
                      {kind === "owner" && (
                        <Link href={`/dashboard/salons/${salonId}/settings`} className={ui.menuItem} role="menuitem">
                          <Icon name="settings" /> Shop settings
                        </Link>
                      )}
                      <a href="/contact-us" className={ui.menuItem} role="menuitem" target="_blank" rel="noopener noreferrer">
                        <Icon name="help" /> Help &amp; support<span className={ui.srOnly}> (opens in a new tab)</span>
                      </a>
                      {(ownedShops.length > 1 || workplaces.length > 1) && (
                        <Link href="/dashboard/salons?select=1" className={ui.menuItem} role="menuitem">
                          <Icon name="store" /> Switch shop
                        </Link>
                      )}
                      <button type="button" className={ui.menuItem} role="menuitem" onClick={() => void handleLogout()}>
                        <Icon name="logout" /> Log out
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </header>
            {/* A plain container: every page supplies its own <main> landmark (legacy pages already do). */}
            <div id="owner-main" className={ui.content} tabIndex={-1}>
              <MaintenanceNotice variant="inline" />
              <AdminManagingBanner />
              {children}
            </div>
          </div>
        </div>

        {/* ---- phones: a thumb-reachable bottom bar ---- */}
        <nav className={ui.bottomBar} aria-label="Quick navigation">
          {bottomItems.map((item) => {
            const active = item.id === currentId;
            const badge = badgeFor(item);
            return (
              <Link key={item.id} href={hrefFor(item, salonId)} className={`${ui.bottomLink} ${active ? ui.bottomLinkActive : ""}`} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} size={22} />
                <span>{item.id === "overview" && kind === "staff" ? "My day" : item.label.split(" / ")[0].replace("Live Queue", "Queue")}</span>
                {badge !== null && <span className={ui.bottomBadge}>{badge > 99 ? "99+" : badge}</span>}
              </Link>
            );
          })}
          <button type="button" className={ui.bottomLink} onClick={() => setDrawerOpen(true)} aria-label="More: open all navigation">
            <Icon name="menu" size={22} />
            <span>More</span>
          </button>
        </nav>
      </div>
    </ShellContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Global search: matches the menu (instantly, client side) and, with the server, the people and
// records the caller is allowed to see at this shop.

type Hit = { key: string; group: string; title: string; subtitle: string | null; href: string };

function GlobalSearch({ salonId, kind }: { salonId: string; kind: ShopKind }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [serverHits, setServerHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl K");
  useEffect(() => {
    // The platform is only known in the browser, so the hint is corrected after the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- platform is not available during server render
    if (/Mac|iPhone|iPad/i.test(navigator.platform)) setShortcutLabel("⌘ K");
  }, []);

  const navHits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return navItemsFor(kind)
      .filter((item) => item.label.toLowerCase().includes(q) || (item.keywords ?? []).some((k) => k.includes(q)))
      .slice(0, 5)
      .map((item) => ({ key: `nav-${item.id}`, group: "Go to", title: item.label, subtitle: null, href: hrefFor(item, salonId) }));
  }, [query, kind, salonId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient UI when the route or search text changes
      setServerHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      apiFetch<OwnerSearchResultDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/search?q=${encodeURIComponent(q)}`)
        .then((result) => {
          if (cancelled) return;
          const label: Record<string, string> = { booking: "Bookings", customer: "Customers", service: "Services", queue: "Live Queue", invoice: "Invoices" };
          setServerHits(result.hits.map((h) => ({ key: `${h.type}-${h.id}`, group: label[h.type] ?? "Results", title: h.title, subtitle: h.subtitle, href: h.href })));
        })
        .catch(() => {
          if (!cancelled) setServerHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, salonId]);

  const hits = useMemo(() => [...navHits, ...serverHits], [navHits, serverHits]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient UI when the route or search text changes
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement))) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQuery("");
    router.push(hit.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      go(hits[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showPanel = open && query.trim().length >= 2;
  let lastGroup = "";
  return (
    <div className={ui.searchWrap} ref={wrapRef} role="search">
      <Icon name="search" className={ui.searchIcon} />
      <input
        ref={inputRef}
        type="search"
        className={ui.searchInput}
        placeholder={kind === "owner" ? "Search customers, bookings, services…" : "Search the queue and services…"}
        aria-label="Search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="owner-search-results"
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {query === "" && (
        <span className={ui.searchHint} aria-hidden="true">
          {shortcutLabel}
        </span>
      )}
      {showPanel && (
        <div className={ui.searchPanel} id="owner-search-results" role="listbox" aria-label="Search results">
          {hits.length === 0 && (
            <div className={ui.empty} role="status">
              {loading ? "Searching…" : "No matches. Try a name, phone number, service or invoice number."}
            </div>
          )}
          {hits.map((hit, index) => {
            const header = hit.group !== lastGroup ? <div className={ui.searchGroup}>{hit.group}</div> : null;
            lastGroup = hit.group;
            return (
              <div key={hit.key}>
                {header}
                <Link
                  href={hit.href}
                  className={`${ui.searchHit} ${index === active ? ui.searchHitActive : ""}`}
                  role="option"
                  aria-selected={index === active}
                  onClick={(event) => {
                    event.preventDefault();
                    go(hit);
                  }}
                >
                  <div className={ui.searchHitTitle}>{hit.title}</div>
                  {hit.subtitle && <div className={ui.searchHitSub}>{hit.subtitle}</div>}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
