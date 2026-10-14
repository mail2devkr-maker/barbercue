import type { OwnerScheduleItemDto } from "@barbercue/shared";

// Layout maths for the day-schedule timeline (barbers across, hours down). Pure so it can be tested.

export const UNASSIGNED = "Not assigned";
export const PX_PER_HOUR = 56;

export interface ScheduleBlock {
  id: string;
  column: string;
  /** minutes after the grid's first hour */
  top: number;
  height: number;
  item: OwnerScheduleItemDto;
}

export interface ScheduleLayout {
  startHour: number;
  endHour: number;
  hours: number[];
  columns: string[];
  blocks: ScheduleBlock[];
}

/** Minutes since local midnight for an instant, read in the shop's own timezone. */
export function localMinutes(iso: string, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return (hour % 24) * 60 + minute;
  } catch {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }
}

export function buildScheduleLayout(items: readonly OwnerScheduleItemDto[], timeZone: string, staffNames: readonly string[]): ScheduleLayout {
  const spans = items.map((item) => {
    const start = localMinutes(item.slotStart, timeZone);
    let end = localMinutes(item.slotEnd, timeZone);
    if (end <= start) end = start + 30; // crosses midnight or zero length: keep a visible block
    return { item, start, end };
  });
  const first = spans.length ? Math.min(...spans.map((s) => s.start)) : 9 * 60;
  const last = spans.length ? Math.max(...spans.map((s) => s.end)) : 18 * 60;
  const startHour = Math.max(0, Math.floor(first / 60));
  const endHour = Math.min(24, Math.max(startHour + 3, Math.ceil(last / 60)));
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);

  const used = new Set(spans.map((s) => s.item.staffName ?? UNASSIGNED));
  const columns = [...staffNames];
  for (const name of used) if (!columns.includes(name) && name !== UNASSIGNED) columns.push(name);
  if (used.has(UNASSIGNED)) columns.push(UNASSIGNED);

  const blocks = spans.map(({ item, start, end }): ScheduleBlock => ({
    id: item.id,
    column: item.staffName ?? UNASSIGNED,
    top: start - startHour * 60,
    height: Math.max(end - start, 20),
    item,
  }));
  return { startHour, endHour, hours, columns, blocks };
}

export const CATEGORY_PALETTE = [
  { bg: "#e2f1d6", ink: "#1f3d12", dot: "#7cc255" },
  { bg: "#e5def8", ink: "#34236b", dot: "#8a6fe0" },
  { bg: "#dcebf8", ink: "#143a5c", dot: "#5aa2dc" },
  { bg: "#fde7d5", ink: "#6b3510", dot: "#f09a52" },
  { bg: "#fbe0ea", ink: "#6b1636", dot: "#e8628f" },
  { bg: "#f6f0c8", ink: "#54460a", dot: "#cdb52e" },
] as const;

/** A stable colour for a category: the same category is the same colour every day. */
export function paletteIndex(category: string | null | undefined): number {
  const key = (category ?? "").trim().toLowerCase();
  if (!key) return 0;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % CATEGORY_PALETTE.length;
}
