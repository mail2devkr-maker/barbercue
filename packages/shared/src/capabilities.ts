export const FASTQUE_CAPABILITY_KEYS = [
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

export type FastQueCapabilityKey = (typeof FASTQUE_CAPABILITY_KEYS)[number];
export type FeatureCapabilityStatus =
  "ENABLED" | "SANDBOX" | "DISABLED" | "UNCONFIGURED";

export interface FeatureCapabilityDto {
  status: FeatureCapabilityStatus;
  reasonCode: string | null;
  updatedAt: string | null;
}

export type FeatureCapabilityMapDto = Record<
  FastQueCapabilityKey,
  FeatureCapabilityDto
>;

export interface SalonCapabilitiesDto {
  features: FeatureCapabilityMapDto;
}
