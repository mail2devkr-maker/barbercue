"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import ui from "./owner.module.css";

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: string; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={ui.pageHead}>
      <div>
        {eyebrow && <div className={ui.eyebrow}>{eyebrow}</div>}
        <h1 className={ui.pageTitle}>{title}</h1>
        {sub && <p className={ui.pageSub}>{sub}</p>}
      </div>
      {actions && <div className={ui.headActions}>{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  sub,
  action,
  children,
  tight,
  className,
  id,
}: {
  title?: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  tight?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`${ui.card} ${tight ? ui.cardTight : ""} ${className ?? ""}`} id={id} aria-label={title}>
      {(title || action) && (
        <div className={ui.cardHead}>
          <div>
            {title && <h2 className={ui.cardTitle}>{title}</h2>}
            {sub && <div className={ui.cardSub}>{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  foot,
  icon,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  icon: IconName;
  tone?: "brand" | "ok" | "warn" | "info";
  href?: string;
}) {
  const iconClass = tone === "ok" ? ui.kpiIconOk : tone === "warn" ? ui.kpiIconWarn : tone === "info" ? ui.kpiIconInfo : "";
  const body = (
    <>
      <div className={ui.kpiTop}>
        <span className={`${ui.kpiIcon} ${iconClass}`}>
          <Icon name={icon} size={18} />
        </span>
        <span>{label}</span>
      </div>
      <div className={ui.kpiValue}>{value}</div>
      {foot && <div className={ui.kpiFoot}>{foot}</div>}
    </>
  );
  return href ? (
    <Link href={href} className={`${ui.card} ${ui.cardTight} ${ui.kpi} ${ui.kpiLinkCard}`}>
      {body}
    </Link>
  ) : (
    <div className={`${ui.card} ${ui.cardTight} ${ui.kpi}`}>{body}</div>
  );
}

export type BadgeTone = "ok" | "warn" | "bad" | "info" | "brand" | "neutral";
const BADGE_CLASS: Record<BadgeTone, string> = {
  ok: ui.badgeOk,
  warn: ui.badgeWarn,
  bad: ui.badgeBad,
  info: ui.badgeInfo,
  brand: ui.badgeBrand,
  neutral: ui.badgeNeutral,
};
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`${ui.badge} ${BADGE_CLASS[tone]}`}>{children}</span>;
}

type BtnVariant = "primary" | "secondary" | "quiet" | "danger";
const BTN_CLASS: Record<BtnVariant, string> = {
  primary: ui.btnPrimary,
  secondary: ui.btnSecondary,
  quiet: ui.btnQuiet,
  danger: ui.btnDanger,
};
function btnClass(variant: BtnVariant, small?: boolean, block?: boolean, extra?: string): string {
  return [ui.btn, BTN_CLASS[variant], small ? ui.btnSm : "", block ? ui.btnBlock : "", extra ?? ""].filter(Boolean).join(" ");
}

export function Btn({
  variant = "secondary",
  small,
  block,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: { variant?: BtnVariant; small?: boolean; block?: boolean; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={btnClass(variant, small, block, className)} {...rest}>
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children}
    </button>
  );
}

export function BtnLink({
  variant = "secondary",
  small,
  block,
  icon,
  href,
  children,
  className,
  ...rest
}: { variant?: BtnVariant; small?: boolean; block?: boolean; icon?: IconName; href: string; className?: string; children: ReactNode } & Omit<React.ComponentProps<typeof Link>, "href" | "className">) {
  return (
    <Link href={href} className={btnClass(variant, small, block, className)} {...rest}>
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children}
    </Link>
  );
}

export function Banner({ tone, children }: { tone: "error" | "ok" | "warn" | "info"; children: ReactNode }) {
  const cls = tone === "error" ? ui.bannerError : tone === "ok" ? ui.bannerOk : tone === "warn" ? ui.bannerWarn : ui.bannerInfo;
  return (
    <div className={`${ui.banner} ${cls}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={ui.empty}>
      <div className={ui.emptyTitle}>{title}</div>
      {children && <div>{children}</div>}
      {action && <div className={ui.mt12}>{action}</div>}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div className={ui.skeleton} style={{ height, width }} aria-hidden="true" />;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className={ui.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={`${ui.tab} ${tab.id === value ? ui.tabActive : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className={ui.tabCount}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A modal dialog: focus moves in on open and back on close, Escape closes, background is inert to
 * the keyboard because Tab is wrapped inside the dialog. */
export function Dialog({
  title,
  onClose,
  children,
  wide,
  drawer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [],
      );
    (focusable()[0] ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/close lifecycle only
  }, []);
  return (
    <div className={drawer ? ui.drawerScrim : ui.dialogScrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={drawer ? ui.drawer : `${ui.dialog} ${wide ? ui.dialogWide : ""}`}
      >
        <div className={ui.dialogHead}>
          <h2 className={ui.dialogTitle} id={titleId}>
            {title}
          </h2>
          <Btn variant="quiet" small onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className={ui.hint}>{hint}</div>}
    </div>
  );
}
