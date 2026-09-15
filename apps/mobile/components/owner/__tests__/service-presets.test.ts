import { SERVICE_CATALOG, SERVICE_CATALOG_CATEGORIES } from '@barbercue/shared';
import { findExistingServiceForPreset } from '../ServiceCatalogPicker';

describe('mobile owner service presets', () => {
  const classic = SERVICE_CATALOG.find((item) => item.id === 'classic-haircut');
  const beard = SERVICE_CATALOG.find((item) => item.id === 'beard-trim');

  if (!classic || !beard) throw new Error('Expected core service catalog presets');

  it('uses the shared web catalog with its full category set', () => {
    expect(SERVICE_CATALOG_CATEGORIES).toContain("Men's Hair & Grooming");
    expect(SERVICE_CATALOG_CATEGORIES).toContain('Facial & Skin');
    expect(SERVICE_CATALOG).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Classic Haircut', defaultDurationMinutes: 30 }),
      expect.objectContaining({ name: 'Beard Trim', defaultDurationMinutes: 20 }),
    ]));
  });

  it('recognizes an existing active preset including case differences', () => {
    const existing = findExistingServiceForPreset([
      { id: 'saved-1', name: 'classic haircut', category: "Men's Hair & Grooming", isActive: true },
    ], classic);

    expect(existing?.id).toBe('saved-1');
    expect(existing?.isActive).toBe(true);
  });

  it('recognizes inactive services so the UI can reactivate instead of duplicating them', () => {
    const existing = findExistingServiceForPreset([
      { id: 'saved-2', name: 'Beard Trim', category: 'Beard & Shaving', isActive: false },
    ], beard);

    expect(existing?.id).toBe('saved-2');
    expect(existing?.isActive).toBe(false);
  });

  it('uses name-only fallback for legacy/custom services without a catalog category', () => {
    const existing = findExistingServiceForPreset([
      { id: 'saved-3', name: 'CLASSIC  HAIRCUT', category: '', isActive: true },
    ], classic);

    expect(existing?.id).toBe('saved-3');
  });

  it('keeps owner-entered price separate from preset defaults while preserving suggested duration', () => {
    expect(classic).toEqual(expect.objectContaining({ defaultDurationMinutes: 30 }));
    expect(classic).not.toHaveProperty('price');
  });
});
