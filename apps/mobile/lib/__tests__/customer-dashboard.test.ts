import { Language } from '@barbercue/shared';
import { greetingText, lastViewedLabel, nextBookingPath, pickNextBooking, salonProfileParams, starsText } from '../customer-dashboard';

const now = new Date('2026-11-17T10:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('mobile customer dashboard helpers', () => {
  it('asks for confirmed / pending-payment bookings, oldest first, from yesterday', () => {
    const path = nextBookingPath(new Date(2026, 10, 17, 12, 0, 0));
    expect(path).toContain('bookings/mine?');
    expect(path).toContain('status=CONFIRMED%2CPENDING_PAYMENT');
    expect(path).toContain('sort=oldest');
    expect(path).toContain('from=2026-11-16');
  });

  it('picks the first booking that is still upcoming', () => {
    const past = { id: 'a', status: 'CONFIRMED', slotStart: '2026-11-10T10:00:00.000Z' };
    const future = { id: 'b', status: 'CONFIRMED', slotStart: '2026-11-20T10:00:00.000Z' };
    expect(pickNextBooking([past, future] as never, now)?.id).toBe('b');
    expect(pickNextBooking([past] as never, now)).toBeNull();
    expect(pickNextBooking([], now)).toBeNull();
  });

  it('builds SalonProfile params from a salon entry', () => {
    expect(salonProfileParams({ countryCode: 'IN', citySlug: 'noida', slug: 'kreative-unisex-salon' })).toEqual({
      countryCode: 'IN', citySlug: 'noida', salonSlug: 'kreative-unisex-salon',
    });
  });

  it('labels when a salon was last viewed (English)', () => {
    expect(lastViewedLabel(ago(10_000), Language.EN, now)).toBe('Just now');
    expect(lastViewedLabel(ago(5 * 60_000), Language.EN, now)).toBe('5 min ago');
    expect(lastViewedLabel(ago(60 * 60_000), Language.EN, now)).toBe('1 hour ago');
    expect(lastViewedLabel(ago(3 * 3_600_000), Language.EN, now)).toBe('3 hours ago');
    expect(lastViewedLabel(ago(30 * 3_600_000), Language.EN, now)).toBe('Yesterday');
    expect(lastViewedLabel(ago(3 * 86_400_000), Language.EN, now)).toBe('3 days ago');
    expect(lastViewedLabel(ago(20 * 86_400_000), Language.EN, now)).toMatch(/Oct|Nov/);
  });

  it('labels in Hindi and never goes negative on a skewed clock', () => {
    expect(lastViewedLabel(ago(2 * 3_600_000), Language.HI, now)).toBe('2 घंटे पहले');
    expect(lastViewedLabel(ago(30 * 3_600_000), Language.HI, now)).toBe('कल');
    expect(lastViewedLabel(new Date(now.getTime() + 60_000).toISOString(), Language.EN, now)).toBe('Just now');
  });

  it('renders a 5-star row', () => {
    expect(starsText(4)).toBe('★★★★☆');
    expect(starsText(5)).toBe('★★★★★');
    expect(starsText(0)).toBe('☆☆☆☆☆');
    expect(starsText(9)).toBe('★★★★★');
  });

  it('greets by time of day in both languages', () => {
    expect(greetingText(8, Language.EN)).toBe('Good morning');
    expect(greetingText(13, Language.EN)).toBe('Good afternoon');
    expect(greetingText(21, Language.EN)).toBe('Good evening');
    expect(greetingText(3, Language.EN)).toBe('Good evening');
    expect(greetingText(8, Language.HI)).toBe('सुप्रभात');
    expect(greetingText(21, Language.HI)).toBe('शुभ संध्या');
  });
});
