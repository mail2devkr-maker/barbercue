import {
  INDIAN_PIN_CODE_REGEX,
  currencyForCountry,
  formatBookingArrivalTime,
  formatMoney,
  formatZonedDateTime,
  isValidPostalCode,
  phonePlaceholderForCountry,
  postalCodeRuleFor,
  zonedDateKey,
} from '../index';

describe('postal codes', () => {
  describe('India — must remain exactly as shipped in Phase 11', () => {
    it.each(['560001', '844101', '110001', '999999'])('accepts %p', (v) => {
      expect(isValidPostalCode('IN', v)).toBe(true);
    });

    it.each([
      ['56001', 'five digits'],
      ['5600011', 'seven digits'],
      ['56000A', 'contains a letter'],
      ['060001', 'leading zero'],
      ['', 'empty — India requires one'],
      ['   ', 'whitespace only'],
    ])('rejects %p (%s)', (v) => {
      expect(isValidPostalCode('IN', v)).toBe(false);
    });

    it('is byte-identical to the original INDIAN_PIN_CODE_REGEX', () => {
      expect(postalCodeRuleFor('IN').regex.source).toBe(
        INDIAN_PIN_CODE_REGEX.source,
      );
    });

    it('is required and labelled "PIN Code"', () => {
      const rule = postalCodeRuleFor('IN');
      expect(rule.required).toBe(true);
      expect(rule.label).toBe('PIN Code');
    });

    it('tolerates surrounding whitespace', () => {
      expect(isValidPostalCode('IN', '  560001  ')).toBe(true);
    });
  });

  // No other country has an authoritative rule wired, so every one of them must land on the
  // permissive fallback rather than being validated against India's format.
  describe('countries with no wired rule fall back permissively', () => {
    it.each([
      ['GB', 'SW1A 1AA'],
      ['US', '90210'],
      ['CA', 'K1A 0B1'],
      ['SG', '018956'],
    ])('accepts a legitimate %s postal code %p', (cc, v) => {
      expect(isValidPostalCode(cc, v)).toBe(true);
    });

    it('does NOT apply India’s 6-digit rule to another country', () => {
      // Would be rejected by INDIAN_PIN_CODE_REGEX; must be accepted here.
      expect(INDIAN_PIN_CODE_REGEX.test('SW1A 1AA')).toBe(false);
      expect(isValidPostalCode('GB', 'SW1A 1AA')).toBe(true);
    });

    it('allows an empty postal code where none is required (e.g. UAE)', () => {
      expect(isValidPostalCode('AE', '')).toBe(true);
      expect(postalCodeRuleFor('AE').required).toBe(false);
    });

    it('still rejects clearly malformed input', () => {
      expect(isValidPostalCode('GB', '!!')).toBe(false);
      expect(isValidPostalCode('GB', 'x'.repeat(30))).toBe(false);
    });

    it('treats an unknown or missing country as generic', () => {
      expect(postalCodeRuleFor(undefined).required).toBe(false);
      expect(postalCodeRuleFor('ZZ').label).toBe('Postal code');
    });

    it('is case-insensitive about the country code', () => {
      expect(postalCodeRuleFor('in').label).toBe('PIN Code');
    });
  });
});

describe('currency', () => {
  it('maps India to INR', () => {
    expect(currencyForCountry('IN')).toBe('INR');
  });

  it('returns null rather than guessing for a country we do not operate in', () => {
    expect(currencyForCountry('GB')).toBeNull();
    expect(currencyForCountry('ZZ')).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
  });
});

describe('formatMoney', () => {
  // The pre-existing UI rendered `₹{price}` — "₹300", never "₹300.00". That must not change.
  it.each([
    [300, '₹300'],
    [4850, '₹4,850'],
    [0, '₹0'],
  ])('formats %p as %p for INR', (amount, expected) => {
    expect(formatMoney(amount, 'INR', 'IN')).toBe(expected);
  });

  it('shows real paise when present', () => {
    expect(formatMoney(300.5, 'INR', 'IN')).toBe('₹300.5');
  });

  it('uses Indian digit grouping, not Western', () => {
    expect(formatMoney(1234567, 'INR', 'IN')).toBe('₹12,34,567');
  });

  // A wrong symbol is misinformation; an unlabelled number is merely incomplete.
  it('renders a bare number when the currency is unknown', () => {
    const out = formatMoney(300, null, 'IN');
    expect(out).not.toContain('₹');
    expect(out).toBe('300');
  });

  it('degrades to a plain number instead of throwing on an invalid currency code', () => {
    expect(() => formatMoney(300, 'NOTACURRENCY', 'IN')).not.toThrow();
    expect(formatMoney(300, 'NOTACURRENCY', 'IN')).toBe('300');
  });

  it('formats a non-INR currency correctly when one is supplied', () => {
    expect(formatMoney(300, 'GBP', 'GB')).toContain('300');
  });
});

describe('formatZonedDateTime / formatBookingArrivalTime (Part 5 — show arrival time after booking)', () => {
  // A fixed instant that is unambiguously a different calendar day/hour depending on zone —
  // 2026-01-15T02:00:00Z is Jan 14 evening in Chicago, Jan 15 morning in Kolkata.
  const instant = '2026-01-15T02:00:00.000Z';

  it('renders the same instant differently depending on the requested IANA zone, regardless of host timezone', () => {
    const kolkata = formatZonedDateTime(instant, 'Asia/Kolkata', 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const chicago = formatZonedDateTime(instant, 'America/Chicago', 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    // 02:00 UTC = 07:30 IST (UTC+5:30) = 20:00 CST previous day (UTC-6).
    expect(kolkata).toBe('7:30 AM');
    expect(chicago).toBe('8:00 PM');
  });

  it('degrades to formatting with no explicit zone rather than throwing on an invalid timezone string', () => {
    expect(() =>
      formatZonedDateTime(instant, 'Not/AZone', 'en-US', { hour: 'numeric', minute: '2-digit' }),
    ).not.toThrow();
  });

  it('treats a null/undefined timezone as "use the runtime default" rather than throwing', () => {
    expect(() => formatZonedDateTime(instant, null, 'en-US', { hour: 'numeric' })).not.toThrow();
    expect(() => formatZonedDateTime(instant, undefined, 'en-US', { hour: 'numeric' })).not.toThrow();
  });

  describe('formatBookingArrivalTime', () => {
    it('returns a distinct date and time string formatted in the given zone', () => {
      const result = formatBookingArrivalTime(instant, 'Asia/Kolkata', 'en-US');
      expect(result.time).toBe('7:30 AM');
      expect(result.date).toContain('Jan');
      expect(result.date).toContain('15');
    });

    it('flags isDeviceLocalTimezone=true when the salon timezone is unknown (never a false "different zone" alarm)', () => {
      expect(formatBookingArrivalTime(instant, null, 'en-US').isDeviceLocalTimezone).toBe(true);
    });

    it('flags isDeviceLocalTimezone based on the actual resolved device zone, not a hard-coded guess', () => {
      const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      expect(formatBookingArrivalTime(instant, deviceZone, 'en-US').isDeviceLocalTimezone).toBe(true);

      // Pick whichever of these two well-known zones is NOT the actual device zone, so this
      // assertion holds no matter what machine/CI runner executes the test.
      const definitelyDifferentZone = deviceZone === 'Pacific/Kiritimati' ? 'Etc/GMT+12' : 'Pacific/Kiritimati';
      expect(
        formatBookingArrivalTime(instant, definitelyDifferentZone, 'en-US').isDeviceLocalTimezone,
      ).toBe(false);
    });
  });
});

describe('zonedDateKey', () => {
  it('gives a different calendar-day key depending on zone for an instant near midnight', () => {
    // 2026-01-15T02:00:00Z is Jan 15 morning in Kolkata but still Jan 14 evening in Chicago.
    expect(zonedDateKey('2026-01-15T02:00:00.000Z', 'Asia/Kolkata')).toBe('2026-01-15');
    expect(zonedDateKey('2026-01-15T02:00:00.000Z', 'America/Chicago')).toBe('2026-01-14');
  });

  it('always returns YYYY-MM-DD regardless of what locale-dependent ordering might otherwise apply', () => {
    expect(zonedDateKey('2026-03-05T12:00:00.000Z', 'Europe/London')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('degrades to the runtime default zone rather than throwing on an invalid timezone', () => {
    expect(() => zonedDateKey('2026-01-15T02:00:00.000Z', 'Not/AZone')).not.toThrow();
  });
});

describe('phone placeholders', () => {
  it('keeps the existing India example', () => {
    expect(phonePlaceholderForCountry('IN')).toBe('+919876543210');
  });

  it('falls back to a neutral hint rather than showing +91 for another country', () => {
    expect(phonePlaceholderForCountry('GB')).toBe('+…');
    expect(phonePlaceholderForCountry(null)).toBe('+…');
  });
});
