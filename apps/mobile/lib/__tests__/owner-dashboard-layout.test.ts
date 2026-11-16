import { PhotoType, type PhotoDto } from '@barbercue/shared';
import { pickCoverPhoto, showDashboardPanelLink } from '../owner-dashboard-layout';

const photo = (id: string, type: PhotoDto['type']): PhotoDto => ({ id, url: `https://img/${id}.jpg`, altText: null, type });

describe('owner dashboard layout (16 Nov)', () => {
  it('hides Revenue report, Cancellations and Reviews (iOS and Android identical)', () => {
    for (const panel of ['report', 'cancellations', 'reviews']) expect(showDashboardPanelLink(panel)).toBe(false);
  });

  it('keeps Business analytics and every other shortcut', () => {
    for (const panel of ['analytics', 'inventory']) expect(showDashboardPanelLink(panel)).toBe(true);
  });

  it('uses the COVER photo, else the first photo, else nothing (never a stock image)', () => {
    expect(pickCoverPhoto([photo('a', PhotoType.GALLERY), photo('b', PhotoType.COVER)])?.id).toBe('b');
    expect(pickCoverPhoto([photo('a', PhotoType.GALLERY), photo('c', PhotoType.GALLERY)])?.id).toBe('a');
    expect(pickCoverPhoto([])).toBeNull();
  });
});
