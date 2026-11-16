export interface FabOffset { x: number; y: number }

export interface FabBounds {
  width: number; // window width
  height: number; // window height
  fabWidth: number;
  fabHeight: number;
  /** Distance of the default spot's bottom edge from the screen bottom (tab bar + gap). */
  bottom: number;
  /** Top safe-area inset (status bar / notch). */
  top: number;
}

const SIDE_GAP = 16; // the default right margin
const EDGE_GAP = 8;

/**
 * The offset is relative to the default bottom-right anchor (right: 16, bottom: `bottom`), so
 * x <= 0 moves left and y <= 0 moves up. Keeps the whole button on screen, above the tab bar
 * and below the status bar.
 */
export function clampFabOffset(o: FabOffset, b: FabBounds): FabOffset {
  const minX = -(b.width - b.fabWidth - SIDE_GAP - EDGE_GAP);
  const maxX = SIDE_GAP - EDGE_GAP; // may sit closer to the right edge than the default
  const minY = -(b.height - b.bottom - b.fabHeight - b.top - EDGE_GAP);
  // The default spot sits 14px above the tab bar; it may move down by at most 8px (6px above the bar).
  const maxY = 8;
  return {
    x: Math.min(maxX, Math.max(minX, Math.round(o.x))),
    y: Math.min(maxY, Math.max(minY, Math.round(o.y))),
  };
}

/** Stored offsets are untrusted JSON: anything but two finite numbers is ignored. */
export function parseFabOffset(raw: string | null | undefined): FabOffset | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FabOffset>;
    if (typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x, y: v.y };
  } catch { /* fall through */ }
  return null;
}
