import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_CATEGORIES,
  createSalonServiceSchema,
  createSalonStaffSchema,
  normalizeServiceIdentity,
} from '..';

describe('owner setup contracts', () => {
  it('requires a country-agnostic E.164 phone and keeps email optional for staff', () => {
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', phone: '+919876543210',
    }).success).toBe(true);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', phone: '+442071838750', email: 'marcus@example.com',
    }).success).toBe(true);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', email: 'marcus@example.com',
    }).success).toBe(false);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', phone: '9876543210',
    }).success).toBe(false);
  });

  it('accepts optional service details without changing price/duration requirements', () => {
    expect(createSalonServiceSchema.safeParse({
      name: 'Skin Fade', description: 'Includes wash and finish',
      category: "Men's Hair & Grooming", price: 500, durationMinutes: 45,
    }).success).toBe(true);
    expect(createSalonServiceSchema.safeParse({
      name: 'Skin Fade', durationMinutes: 45,
    }).success).toBe(false);
  });

  it('ships the complete extensible preset categories without any default prices', () => {
    expect(SERVICE_CATALOG_CATEGORIES).toHaveLength(11);
    expect(SERVICE_CATALOG.length).toBeGreaterThanOrEqual(90);
    expect(SERVICE_CATALOG).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Classic Haircut', category: "Men's Hair & Grooming" }),
      expect.objectContaining({ name: 'Bridal Makeup', category: 'Makeup & Occasion' }),
      expect.objectContaining({ name: 'Full Body Wax', category: 'Waxing' }),
    ]));
    expect(SERVICE_CATALOG.some((preset) => 'price' in preset)).toBe(false);
  });

  it('normalizes punctuation and case for duplicate matching', () => {
    expect(normalizeServiceIdentity(' Skin-Fade ', "Men's Hair & Grooming"))
      .toBe(normalizeServiceIdentity('skin fade', "MEN'S HAIR & GROOMING"));
  });
});
