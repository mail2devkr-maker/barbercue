import { SalonStatus, type SalonShareLinksDto } from '@barbercue/shared';
import { create as createQrCode } from 'qrcode/lib/core/qrcode';

const QUIET_ZONE_MODULES = 4;

export type SalonShareResult =
  | { kind: 'ready'; salonName: string; publicUrl: string }
  | { kind: 'not-public'; salonName: string }
  | { kind: 'unavailable'; salonName: string };

/** Use only the backend's canonical, salon-scoped link. Never derive a QR target from a name or slug. */
export function classifySalonShareLinks(dto: SalonShareLinksDto, expectedSalonId: string): SalonShareResult {
  const salonName = dto.metadata?.title?.trim() || 'Your shop';
  if (dto.salonId !== expectedSalonId) return { kind: 'unavailable', salonName };
  if (dto.status !== SalonStatus.ACTIVE || dto.readiness?.reasons?.includes('SALON_NOT_PUBLIC')) {
    return { kind: 'not-public', salonName };
  }

  const publicUrl = dto.publicUrl?.trim();
  if (!dto.readiness?.ready || !publicUrl) return { kind: 'unavailable', salonName };

  try {
    if (new URL(publicUrl).protocol !== 'https:') return { kind: 'unavailable', salonName };
  } catch {
    return { kind: 'unavailable', salonName };
  }

  return { kind: 'ready', salonName, publicUrl };
}

export interface QrMatrix {
  size: number;
  /** Includes four white modules on every edge. */
  cells: boolean[];
}

/** Build a QR matrix with high error correction and a scanner-safe four-module quiet zone. */
export function createQrMatrix(value: string): QrMatrix {
  const modules = createQrCode(value, { errorCorrectionLevel: 'H' }).modules;
  const size = modules.size;
  const fullSize = size + QUIET_ZONE_MODULES * 2;
  const cells = Array.from({ length: fullSize * fullSize }, () => false);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      cells[(row + QUIET_ZONE_MODULES) * fullSize + column + QUIET_ZONE_MODULES] =
        modules.data[row * size + column] === 1;
    }
  }

  return { size: fullSize, cells };
}
