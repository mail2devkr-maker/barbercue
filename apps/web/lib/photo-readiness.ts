import type { SalonPhotoActivationReadinessDto } from "@barbercue/shared";

// New-shop photo requirement (requirement #9, owner decision D8), on Codex PR #237:
//   GET dashboard/salons/:salonId/photo-readiness -> { required, current, ready, grandfathered, reasons[] }
//
// A shop that has never been open needs three different photos before it can open. A shop that was already open when the
// rule started is exempt ("grandfathered"). The count is the server's: it counts distinct, safe web addresses of the
// shop's photos, and it does not fetch or inspect them. This page only explains the answer; it never decides readiness
// itself and never blocks opening (the server does that on activation).

export type PhotoReadiness = Pick<SalonPhotoActivationReadinessDto, "required" | "current" | "ready" | "grandfathered"> & {
  reasons: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the answer defensively; anything that is not the documented shape is "no answer", never a guess. */
export function parsePhotoReadiness(raw: unknown): PhotoReadiness | null {
  if (!isRecord(raw)) return null;
  const { required, current, ready, grandfathered, reasons } = raw;
  if (typeof required !== "number" || !Number.isInteger(required) || required < 0) return null;
  if (typeof current !== "number" || !Number.isInteger(current) || current < 0) return null;
  if (typeof ready !== "boolean" || typeof grandfathered !== "boolean") return null;
  return {
    required: required as 3,
    current,
    ready,
    grandfathered,
    reasons: Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string") : [],
  };
}

export type ReadinessTone = "ok" | "info" | "warn";

export interface ReadinessView {
  tone: ReadinessTone;
  title: string;
  body: string;
  /** For a progress bar: how many of the required photos are counted, never above the requirement. */
  counted: number;
  required: number;
}

/** What to tell the owner about the requirement, in plain words. */
export function describePhotoReadiness(r: PhotoReadiness): ReadinessView {
  const counted = Math.min(r.current, r.required);
  if (r.grandfathered) {
    return {
      tone: "info",
      title: "Your shop is already open",
      body: "The three-photo rule only applies to shops opening for the first time, so it does not apply to yours. More good photos still help customers choose you.",
      counted,
      required: r.required,
    };
  }
  if (r.ready) {
    return {
      tone: "ok",
      title: `${counted} of ${r.required} photos added`,
      body: "You have enough photos to open your shop. You can add more at any time.",
      counted,
      required: r.required,
    };
  }
  const missing = Math.max(r.required - r.current, 0);
  return {
    tone: "warn",
    title: `${counted} of ${r.required} photos added`,
    body: `Add ${missing} more ${missing === 1 ? "photo" : "photos"} before you open your shop. Each photo needs its own web address or upload, so the same image added twice counts once.`,
    counted,
    required: r.required,
  };
}
