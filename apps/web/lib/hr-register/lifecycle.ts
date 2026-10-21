import type {
  HrEpisodeStatus,
  HrLifecycleFilter,
  HrOfferStatus,
  HrOfferVersion,
  HrPersonDetail,
  HrPersonSummary,
} from "./types";

/**
 * Presentation helpers for the two status axes (offer status and employment status). These decide
 * which buttons are *offered* to HR; the backend remains the authority and rejects any transition
 * that is not valid for the stored state.
 */

export type HrLifecycle = Exclude<HrLifecycleFilter, "ALL">;

export const LIFECYCLE_LABEL: Record<HrLifecycle, string> = {
  OFFERED: "Offered",
  NOT_JOINED: "Not joined",
  ACTIVE: "Joined",
  EXITED: "Exited",
  REOFFERED: "Re-offered",
  REJOINED: "Rejoined",
};

export const OFFER_STATUS_LABEL: Record<HrOfferStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  SENT: "Emailed (recorded)",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

export const EPISODE_STATUS_LABEL: Record<HrEpisodeStatus, string> = {
  PENDING_JOIN: "Awaiting joining",
  NOT_JOINED: "Did not join",
  ACTIVE: "Employed",
  EXITED: "Exited",
};

type EpisodeLike = Pick<NonNullable<HrPersonSummary["currentEpisode"]>, "episodeNumber" | "status"> | null;

/** Current stage of a person, derived from the employment episode (never from the offer alone). */
export function deriveLifecycle(person: { currentEpisode: EpisodeLike }): HrLifecycle {
  const episode = person.currentEpisode;
  if (!episode) return "OFFERED";
  switch (episode.status) {
    case "PENDING_JOIN":
      return episode.episodeNumber > 1 ? "REOFFERED" : "OFFERED";
    case "NOT_JOINED":
      return "NOT_JOINED";
    case "ACTIVE":
      return episode.episodeNumber > 1 ? "REJOINED" : "ACTIVE";
    case "EXITED":
      return "EXITED";
  }
}

const OPEN_OFFER_STATUSES: ReadonlySet<HrOfferStatus> = new Set(["ISSUED", "SENT", "ACCEPTED"]);

/** An offer that is still waiting for an outcome (HR must resolve it before issuing another). */
export function isOpenOffer(offer: Pick<HrOfferVersion, "status" | "supersededByVersion">): boolean {
  return offer.supersededByVersion === null && OPEN_OFFER_STATUSES.has(offer.status);
}

export function latestOffer(offers: HrOfferVersion[]): HrOfferVersion | null {
  if (offers.length === 0) return null;
  return offers.reduce((best, offer) => (offer.version > best.version ? offer : best));
}

/** Status changes HR may record on an offer document (offer axis only). */
export function allowedOfferTransitions(offer: Pick<HrOfferVersion, "status" | "supersededByVersion">): Array<"SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED"> {
  if (offer.supersededByVersion !== null) return [];
  switch (offer.status) {
    case "ISSUED":
      return ["SENT", "ACCEPTED", "DECLINED", "EXPIRED"];
    case "SENT":
      return ["ACCEPTED", "DECLINED", "EXPIRED"];
    default:
      return [];
  }
}

export type HrPersonActions = {
  /** Another offer for a person who never joined, declined or let an offer lapse. */
  canReoffer: boolean;
  /** A fresh offer for a former employee. Reuses the code, starts a new employment episode. */
  canRehire: boolean;
  /** Approve joining for the open accepted offer (the only step that may enable a login). */
  canRecordJoining: boolean;
  canRecordNotJoined: boolean;
  canRecordExit: boolean;
};

export function allowedPersonActions(person: Pick<HrPersonDetail, "currentEpisode" | "offers">): HrPersonActions {
  const latest = latestOffer(person.offers);
  const episode = person.currentEpisode;
  // An offer only blocks the next one while its own employment episode is still awaiting an outcome.
  // After "did not join" or an exit the old accepted letter is history, not an open offer.
  const awaitingOutcome = !episode || episode.status === "PENDING_JOIN";
  const open = latest && awaitingOutcome ? isOpenOffer(latest) : false;
  const none: HrPersonActions = {
    canReoffer: false,
    canRehire: false,
    canRecordJoining: false,
    canRecordNotJoined: false,
    canRecordExit: false,
  };

  // Staff hired before the register existed have an episode but no offer yet: they can still be exited
  // or rehired (the rehire offer becomes their first recorded offer).
  if (episode?.status === "ACTIVE") return { ...none, canRecordExit: true };
  if (episode?.status === "EXITED") return { ...none, canRehire: !open };
  if (!latest) return none;

  const pendingJoin = !episode || episode.status === "PENDING_JOIN";
  if (pendingJoin) {
    return {
      ...none,
      canRecordJoining: latest.status === "ACCEPTED" && latest.supersededByVersion === null,
      canRecordNotJoined: latest.supersededByVersion === null && ["ISSUED", "SENT", "ACCEPTED", "EXPIRED"].includes(latest.status),
      canReoffer: !open,
    };
  }

  // NOT_JOINED
  return { ...none, canReoffer: !open };
}

export function lifecycleTone(lifecycle: HrLifecycle): "neutral" | "good" | "warn" | "bad" {
  switch (lifecycle) {
    case "ACTIVE":
    case "REJOINED":
      return "good";
    case "OFFERED":
    case "REOFFERED":
      return "neutral";
    case "NOT_JOINED":
      return "warn";
    case "EXITED":
      return "bad";
  }
}

export function offerTone(status: HrOfferStatus): "neutral" | "good" | "warn" | "bad" {
  switch (status) {
    case "ACCEPTED":
      return "good";
    case "DECLINED":
    case "EXPIRED":
      return "bad";
    case "SENT":
      return "warn";
    default:
      return "neutral";
  }
}
