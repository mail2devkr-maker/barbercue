import { resolveAutoTimezone } from './timezone-resolution';

describe('resolveAutoTimezone', () => {
  describe('coordinates (Priority A) -- verified against real city coordinates', () => {
    const cases: { name: string; lat: number; lng: number; expected: string }[] = [
      { name: 'Mumbai', lat: 19.076, lng: 72.8777, expected: 'Asia/Kolkata' },
      { name: 'Delhi', lat: 28.7041, lng: 77.1025, expected: 'Asia/Kolkata' },
      { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, expected: 'Asia/Kolkata' },
      { name: 'Dallas', lat: 32.7767, lng: -96.797, expected: 'America/Chicago' },
      { name: 'Houston', lat: 29.7604, lng: -95.3698, expected: 'America/Chicago' },
      { name: 'Austin', lat: 30.2672, lng: -97.7431, expected: 'America/Chicago' },
      { name: 'San Antonio', lat: 29.4241, lng: -98.4936, expected: 'America/Chicago' },
      { name: 'El Paso', lat: 31.7619, lng: -106.485, expected: 'America/Denver' },
      { name: 'New York City', lat: 40.7128, lng: -74.006, expected: 'America/New_York' },
      { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, expected: 'America/Los_Angeles' },
      { name: 'Chicago', lat: 41.8781, lng: -87.6298, expected: 'America/Chicago' },
      { name: 'Denver', lat: 39.7392, lng: -104.9903, expected: 'America/Denver' },
      { name: 'Phoenix', lat: 33.4484, lng: -112.074, expected: 'America/Phoenix' },
    ];

    it.each(cases)('$name coordinates resolve to $expected with EXACT confidence', ({ lat, lng, expected }) => {
      expect(resolveAutoTimezone({ latitude: lat, longitude: lng })).toEqual({
        timezone: expected,
        confidence: 'EXACT',
        source: 'coordinates',
      });
    });

    it('never blindly maps all of Texas to America/Chicago -- El Paso is genuinely different', () => {
      const dallas = resolveAutoTimezone({ latitude: 32.7767, longitude: -96.797 });
      const elPaso = resolveAutoTimezone({ latitude: 31.7619, longitude: -106.485 });
      expect(dallas?.timezone).toBe('America/Chicago');
      expect(elPaso?.timezone).toBe('America/Denver');
    });

    it('falls through to city rather than guessing when coordinates straddle a real zone boundary', () => {
      // A genuine multi-candidate point (Xinjiang, China) -- geo-tz itself returns two valid
      // zones here, so trusting either one arbitrarily would be exactly the wrong-guess failure
      // mode this feature must avoid.
      expect(
        resolveAutoTimezone({ latitude: 43.839319, longitude: 87.526148, cityTimezone: 'Asia/Shanghai' }),
      ).toEqual({ timezone: 'Asia/Shanghai', confidence: 'HIGH', source: 'city' });
    });

    it('falls through to city when coordinates are missing', () => {
      expect(
        resolveAutoTimezone({ cityTimezone: 'America/Chicago' }),
      ).toEqual({ timezone: 'America/Chicago', confidence: 'HIGH', source: 'city' });
    });

    it('falls through to city when latitude/longitude are not finite numbers', () => {
      expect(
        resolveAutoTimezone({
          latitude: Number.NaN,
          longitude: Number.NaN,
          cityTimezone: 'America/Denver',
        }),
      ).toEqual({ timezone: 'America/Denver', confidence: 'HIGH', source: 'city' });
    });

    it('resolves even open-ocean coordinates -- geo-tz assigns nautical Etc/GMT zones everywhere', () => {
      // Middle of the South Pacific -- confirms the lookup itself never throws/returns nothing
      // for a location far from any city, it just yields the nautical offset zone.
      const result = resolveAutoTimezone({ latitude: -30, longitude: -140 });
      expect(result?.source).toBe('coordinates');
      expect(result?.confidence).toBe('EXACT');
    });
  });

  describe('city (Priority B)', () => {
    it('uses the resolved city timezone when no coordinates are available', () => {
      expect(resolveAutoTimezone({ cityTimezone: 'Europe/London' })).toEqual({
        timezone: 'Europe/London',
        confidence: 'HIGH',
        source: 'city',
      });
    });

    it('ignores an invalid/garbage city timezone value rather than trusting it', () => {
      expect(
        resolveAutoTimezone({ cityTimezone: 'Not/AZone', countryCode: 'IN' }),
      ).toEqual({ timezone: 'Asia/Kolkata', confidence: 'HIGH', source: 'country' });
    });
  });

  describe('country (Priority D) -- India only', () => {
    it('falls back to Asia/Kolkata for an India-city salon with no coordinates or city timezone', () => {
      expect(resolveAutoTimezone({ countryCode: 'IN' })).toEqual({
        timezone: 'Asia/Kolkata',
        confidence: 'HIGH',
        source: 'country',
      });
    });

    it('is case-insensitive on country code', () => {
      expect(resolveAutoTimezone({ countryCode: 'in' })?.timezone).toBe('Asia/Kolkata');
    });

    it('does NOT fall back for the USA -- multi-timezone country, must stay ambiguous', () => {
      expect(resolveAutoTimezone({ countryCode: 'US' })).toBeNull();
    });
  });

  describe('ambiguous / incomplete location -- never fabricates a value', () => {
    it('returns null when nothing at all is known', () => {
      expect(resolveAutoTimezone({})).toBeNull();
    });

    it('returns null for an incomplete USA location with no coordinates, city, or usable country rule', () => {
      expect(resolveAutoTimezone({ countryCode: 'US', cityTimezone: null })).toBeNull();
    });

    it('returns null when only one of latitude/longitude is present', () => {
      expect(resolveAutoTimezone({ latitude: 32.7767, longitude: null, countryCode: 'US' })).toBeNull();
    });
  });
});
