import { PhotoType, type PhotoDto } from '@barbercue/shared';

/** Quick links the owner dashboard no longer lists, on iOS and Android alike (owner request,
 * 16 Nov 2026: both apps must stay identical). The reports themselves stay reachable from
 * Business center; only the dashboard shortcuts go. */
export const HIDDEN_DASHBOARD_PANELS = ['report', 'cancellations', 'reviews'] as const;

export function showDashboardPanelLink(panel: string): boolean {
  return !(HIDDEN_DASHBOARD_PANELS as readonly string[]).includes(panel);
}

/** The shop's cover photo: a COVER photo first, else the first photo, else null (no stock image). */
export function pickCoverPhoto(photos: PhotoDto[]): PhotoDto | null {
  return photos.find((p) => p.type === PhotoType.COVER) ?? photos[0] ?? null;
}
