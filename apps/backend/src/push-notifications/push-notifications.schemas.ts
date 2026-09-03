import { z } from 'zod';

// Deliberately local, not in packages/shared: this is a backend<->mobile-only contract with no
// web consumer, and Issue #13's shared-change protocol says to avoid packages/shared/** when a
// local contract will do. The exact JSON shape is documented in the CROSS_AGENT_HANDOFF_TO_CODEX
// note on Issue #10 for Codex's mobile-side implementation to match.
export const registerPushDeviceSchema = z.object({
  expoPushToken: z.string().min(1).max(400),
  platform: z.enum(['ios', 'android']).optional(),
});
export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceSchema>;

export const unregisterPushDeviceSchema = z.object({
  expoPushToken: z.string().min(1).max(400),
});
export type UnregisterPushDeviceInput = z.infer<
  typeof unregisterPushDeviceSchema
>;
