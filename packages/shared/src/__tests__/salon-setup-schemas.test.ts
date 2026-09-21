import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_CATEGORIES,
  createSalonServiceSchema,
  createSalonStaffSchema,
  normalizeServiceIdentity,
  updateSalonTimezoneSchema,
} from '..';

describe('owner setup contracts', () => {
  it('keeps staff phone/email optional but validates either value when supplied', () => {
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus',
    }).success).toBe(true);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', email: 'marcus@example.com',
    }).success).toBe(true);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', phone: '+919876543210',
    }).success).toBe(true);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', phone: '+442071838750', email: 'marcus@example.com',
    }).success).toBe(true);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', phone: '9876543210',
    }).success).toBe(false);
    expect(createSalonStaffSchema.safeParse({
      displayName: 'Marcus', email: 'not-an-email',
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

  it('ships the complete preset catalog with editable onboarding price/time defaults', () => {
    expect(SERVICE_CATALOG_CATEGORIES).toHaveLength(11);
    expect(SERVICE_CATALOG.length).toBeGreaterThanOrEqual(90);
    expect(SERVICE_CATALOG).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Classic Haircut', category: "Men's Hair & Grooming" }),
      expect.objectContaining({ name: 'Bridal Makeup', category: 'Makeup & Occasion' }),
      expect.objectContaining({ name: 'Gents Full Body Wax', category: 'Waxing' }),
      expect.objectContaining({ name: 'Ladies Full Body Wax', category: 'Waxing' }),
    ]));
    for (const preset of SERVICE_CATALOG) {
      expect(preset.defaultDurationMinutes).toBeGreaterThan(0);
      expect(preset.defaultPriceInr).toBeGreaterThan(0);
    }
    // Saved salon price remains owner-controlled; presets expose suggestions, not a persisted price.
    expect(SERVICE_CATALOG.some((preset) => 'price' in preset)).toBe(false);
  });

  it('normalizes punctuation and case for duplicate matching', () => {
    expect(normalizeServiceIdentity(' Skin-Fade ', "Men's Hair & Grooming"))
      .toBe(normalizeServiceIdentity('skin fade', "MEN'S HAIR & GROOMING"));
  });

  // Real IANA-name validity (recognized by Intl.DateTimeFormat) is checked server-side in
  // SalonTimezoneService, not here — this schema only enforces the general "Area/Location" shape,
  // since a real validity check needs the Intl runtime a zod schema doesn't have access to.
  it('accepts a plausible Area/Location time zone name', () => {
    expect(updateSalonTimezoneSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
    expect(updateSalonTimezoneSchema.safeParse({ timezone: 'America/New_York' }).success).toBe(true);
  });

  it('rejects an empty string, a bare offset, or a non-Area/Location shape', () => {
    expect(updateSalonTimezoneSchema.safeParse({ timezone: '' }).success).toBe(false);
    expect(updateSalonTimezoneSchema.safeParse({ timezone: 'UTC+5:30' }).success).toBe(false);
    expect(updateSalonTimezoneSchema.safeParse({ timezone: 'IST' }).success).toBe(false);
  });
});
