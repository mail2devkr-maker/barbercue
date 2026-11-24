import { isBackendMaintenanceResponse } from '@barbercue/shared';

// Small store: lib/api.ts reports a "backend unreachable" answer, MaintenanceOverlay subscribes.
type Listener = (down: boolean) => void;
let down = false;
const listeners = new Set<Listener>();

export function setMaintenance(next: boolean): void {
  if (down === next) return;
  down = next;
  listeners.forEach((l) => l(down));
}

export function isMaintenance(): boolean {
  return down;
}

export function subscribeMaintenance(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Checks a response without consuming it; flags maintenance when the backend is not reachable. */
export async function checkMaintenance(res: Response): Promise<void> {
  if (res.ok || ![404, 502, 503, 504].includes(res.status)) return;
  let text = '';
  try {
    text = res.status === 404 ? await res.clone().text() : '';
  } catch {
    text = '';
  }
  if (isBackendMaintenanceResponse(res.status, text)) setMaintenance(true);
}
