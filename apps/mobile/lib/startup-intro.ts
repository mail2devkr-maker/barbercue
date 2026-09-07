// FastQue V9 brand intro (P0 mobile app opening brand intro mission) — a plain module-level flag,
// not persisted storage. A JS module instance lives for exactly one process: it survives the app
// going to background and resuming (same process, same module instance, flag stays true — no
// replay), and resets to false on a genuinely new cold launch (new process, fresh module
// evaluation). That is exactly the required "replay on cold launch only" behavior with no
// AsyncStorage/SecureStore round-trip needed. Mirrors the same shape as
// shop-registration-intent.ts's pending-intent flag.
let introPlayedThisSession = false;

export function hasIntroPlayed(): boolean {
  return introPlayedThisSession;
}

export function markIntroPlayed(): void {
  introPlayedThisSession = true;
}

// The approved V9 clip is ~6.25s including its intentional ~2s final hold. This is deliberately
// longer than that so it only ever fires if playback has genuinely stalled (asset failure, a
// player that never reaches 'error' or 'playToEnd') — never as the normal way the intro ends.
export const INTRO_SAFETY_TIMEOUT_MS = 9000;
