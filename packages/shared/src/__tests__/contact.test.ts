import { joinQueueSchema } from '../schemas';
import { normalizeContactName, normalizeContactPhone, telHrefFor } from '../contact';

describe('normalizeContactPhone', () => {
  it.each([
    ['9811122233', '+919811122233'],
    ['98111 22233', '+919811122233'],
    ['098111-22233', '+919811122233'],
    ['919811122233', '+919811122233'],
    ['+91 98111 22233', '+919811122233'],
    ['(+91) 98111-22233', '+919811122233'],
    ['+14155552671', '+14155552671'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeContactPhone(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '12345', '5811122233', '+0123456789', '+12', '98111222', '981112223344455'])(
    'refuses %j rather than guessing a number',
    (input) => {
      expect(normalizeContactPhone(input)).toBeNull();
    },
  );

  it('never guesses a country for a non-Indian number typed without +', () => {
    expect(normalizeContactPhone('4155552671')).toBeNull();
  });

  it('handles non-strings safely', () => {
    expect(normalizeContactPhone(undefined)).toBeNull();
    expect(normalizeContactPhone(null)).toBeNull();
  });
});

describe('normalizeContactName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeContactName('  Ravi   Kumar ')).toBe('Ravi Kumar');
  });
  it('accepts Devanagari names', () => {
    expect(normalizeContactName('रवि कुमार')).toBe('रवि कुमार');
  });
  it('refuses empty, one-character and over-long values', () => {
    expect(normalizeContactName('')).toBeNull();
    expect(normalizeContactName(' A ')).toBeNull();
    expect(normalizeContactName('x'.repeat(61))).toBeNull();
    expect(normalizeContactName(undefined)).toBeNull();
  });
});

describe('telHrefFor', () => {
  it('builds a dialable tel: link from a stored E.164 number', () => {
    expect(telHrefFor('+919811122233')).toBe('tel:+919811122233');
  });
  it('strips formatting characters', () => {
    expect(telHrefFor('+91 98111-22233')).toBe('tel:+919811122233');
  });
  it('returns null when there is nothing dialable, so no dead button is shown', () => {
    expect(telHrefFor(null)).toBeNull();
    expect(telHrefFor('')).toBeNull();
    expect(telHrefFor('123')).toBeNull();
  });
  it('cannot be turned into a different scheme or carry injected characters', () => {
    expect(telHrefFor('javascript:alert(1)')).toBeNull();
    expect(telHrefFor('+91981112223;rm')).toBe('tel:+91981112223');
  });
});

describe('joinQueueSchema contact fields', () => {
  it('still accepts the old body shape (no contact fields)', () => {
    expect(joinQueueSchema.safeParse({}).success).toBe(true);
  });

  it('normalizes a valid name and phone', () => {
    const parsed = joinQueueSchema.parse({ contactName: '  Ravi  Kumar ', contactPhone: '98111 22233' });
    expect(parsed.contactName).toBe('Ravi Kumar');
    expect(parsed.contactPhone).toBe('+919811122233');
  });

  it('rejects an invalid phone with a readable message', () => {
    const result = joinQueueSchema.safeParse({ contactPhone: '12345' });
    expect(result.success).toBe(false);
  });

  it('rejects a too-short name', () => {
    expect(joinQueueSchema.safeParse({ contactName: 'A' }).success).toBe(false);
  });
});
