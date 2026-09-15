import { SERVICE_CATALOG, SERVICE_CATALOG_CATEGORIES } from '@barbercue/shared';
import { availableServicePresets } from '../ShopSetupSections';

describe('mobile owner service presets', () => {
  it('uses the shared web catalog with its full category set', () => {
    expect(SERVICE_CATALOG_CATEGORIES).toContain("Men's Hair & Grooming");
    expect(SERVICE_CATALOG).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Classic Haircut', defaultDurationMinutes: 30 }),
      expect.objectContaining({ name: 'Beard Trim', defaultDurationMinutes: 20 }),
    ]));
  });

  it('does not offer a saved active service again, including case differences', () => {
    const available = availableServicePresets([
      { name: 'classic haircut', isActive: true },
      { name: 'Beard Trim', isActive: false },
    ]);

    expect(available.some((preset) => preset.name === 'Classic Haircut')).toBe(false);
    expect(available.some((preset) => preset.name === 'Beard Trim')).toBe(true);
  });

  it('keeps owner-entered price and duration separate from preset defaults', () => {
    const preset = SERVICE_CATALOG.find((item) => item.id === 'classic-haircut');
    expect(preset).toEqual(expect.objectContaining({ defaultDurationMinutes: 30 }));
    expect(preset).not.toHaveProperty('price');
  });
});
