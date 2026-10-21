"use client";

import type { ReactNode } from "react";
import {
  EPISODE_STATUS_LABEL,
  LIFECYCLE_LABEL,
  OFFER_STATUS_LABEL,
  deriveLifecycle,
  lifecycleTone,
  offerTone,
} from "../../lib/hr-register/lifecycle";
import type { HrEpisodeStatus, HrOfferStatus, HrPersonSummary } from "../../lib/hr-register/types";
import styles from "./hr-register.module.css";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  neutral: styles.toneNeutral,
  good: styles.toneGood,
  warn: styles.toneWarn,
  bad: styles.toneBad,
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`${styles.badge} ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function LifecycleBadge({ person }: { person: Pick<HrPersonSummary, "currentEpisode"> }) {
  const lifecycle = deriveLifecycle(person);
  return <Badge tone={lifecycleTone(lifecycle)}>{LIFECYCLE_LABEL[lifecycle]}</Badge>;
}

export function OfferStatusBadge({ status }: { status: HrOfferStatus }) {
  return <Badge tone={offerTone(status)}>{OFFER_STATUS_LABEL[status]}</Badge>;
}

export function EpisodeStatusBadge({ status }: { status: HrEpisodeStatus }) {
  const tone: Tone = status === "ACTIVE" ? "good" : status === "EXITED" ? "bad" : status === "NOT_JOINED" ? "warn" : "neutral";
  return <Badge tone={tone}>{EPISODE_STATUS_LABEL[status]}</Badge>;
}

export function CodeChip({ code }: { code: string }) {
  return <span className={styles.codeChip}>{code}</span>;
}

type BannerKind = "info" | "ok" | "warn" | "error";
const BANNER_CLASS: Record<BannerKind, string> = {
  info: styles.bannerInfo,
  ok: styles.bannerOk,
  warn: styles.bannerWarn,
  error: styles.bannerErr,
};

export function Banner({ kind = "info", children }: { kind?: BannerKind; children: ReactNode }) {
  return (
    <p className={`${styles.banner} ${BANNER_CLASS[kind]}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.facts}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
