/** Live Queue Monitoring helpers (pure, unit-tested). */
export function waitedMinutes(
  since: string | null,
  now: number,
): number | null {
  if (!since) return null;
  return Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
}

export function waitText(minutes: number | null): string {
  if (minutes === null) return "Nobody waiting";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
