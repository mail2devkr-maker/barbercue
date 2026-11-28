// Feature capabilities (owner decision D1): GET dashboard/salons/:salonId/capabilities tells the dashboard which of the
// new, provider-backed or unfinished features are really available for this shop. A feature is shown as usable only
// when the server says so; a missing endpoint, a failed request or an unknown value always means "not available".
// The response never carries secrets, so everything here is safe to show.
//
// These types are local until the shared package publishes them (it is owned by the backend side).

export const FEATURE_KEYS = [
  "revenueReport",
  "inventory",
  "offers",
  "contactImport",
  "aiDescription",
  "ownerAssistant",
  "customerAssistant",
  "consultations",
  "professionals",
  "demoData",
  "subscription",
  "ownerEmail",
  "socialImport",
  "locationPin",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureStatus = "ENABLED" | "SANDBOX" | "DISABLED" | "UNCONFIGURED";

const STATUSES: ReadonlyArray<FeatureStatus> = ["ENABLED", "SANDBOX", "DISABLED", "UNCONFIGURED"];

export interface FeatureState {
  status: FeatureStatus;
  /** Stable machine code such as PROVIDER_NOT_CONFIGURED; never shown raw as the only explanation. */
  reasonCode: string | null;
  updatedAt: string | null;
}

export type CapabilityMap = Partial<Record<FeatureKey, FeatureState>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the server response defensively. Only the documented features with a documented status are kept; anything
 * else (a new key, a misspelt status, a non-object) is dropped, which leaves that feature unavailable.
 */
export function parseCapabilities(raw: unknown): CapabilityMap {
  const features = isRecord(raw) && isRecord(raw.features) ? raw.features : null;
  const result: CapabilityMap = {};
  if (!features) return result;
  for (const key of FEATURE_KEYS) {
    const entry = features[key];
    if (!isRecord(entry)) continue;
    const status = entry.status;
    if (typeof status !== "string" || !STATUSES.includes(status as FeatureStatus)) continue;
    result[key] = {
      status: status as FeatureStatus,
      reasonCode: typeof entry.reasonCode === "string" ? entry.reasonCode : null,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
    };
  }
  return result;
}

/** True when the owner may use the feature: fully enabled, or enabled in test (sandbox) mode. */
export function isUsable(map: CapabilityMap, key: FeatureKey): boolean {
  const status = map[key]?.status;
  return status === "ENABLED" || status === "SANDBOX";
}

/** Sandbox features work, but anything they do is a test and must be labelled as one. */
export function isSandbox(map: CapabilityMap, key: FeatureKey): boolean {
  return map[key]?.status === "SANDBOX";
}

const REASON_TEXT: Record<string, string> = {
  FEATURE_DISABLED: "This has not been switched on for your shop yet.",
  PROVIDER_NOT_CONFIGURED: "The service behind this has not been set up yet.",
  PROVIDER_TIMEOUT: "The service behind this is not responding right now.",
  QUOTA_EXCEEDED: "The limit for this has been reached. Try again later.",
};

/** A plain explanation of why a feature cannot be used, never a working-looking dead link. */
export function unavailableMessage(map: CapabilityMap | null, key: FeatureKey): string {
  const state = map?.[key];
  if (!state) return "This is not available for your shop yet.";
  if (state.reasonCode && REASON_TEXT[state.reasonCode]) return REASON_TEXT[state.reasonCode];
  if (state.status === "UNCONFIGURED") return "This has not been set up yet.";
  return "This has not been switched on for your shop yet.";
}
