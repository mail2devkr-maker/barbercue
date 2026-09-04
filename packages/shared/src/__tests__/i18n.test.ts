import { Language } from '../enums';
import { NOTIFICATION_TYPES } from '../types';
import {
  NOTIFICATION_TYPE_LABELS,
  PUSH_COPY,
  UI_STRINGS,
  formatVoiceDateTime,
  notificationTypeLabel,
  ordinalDay,
  pushCopyFor,
  uiStringsFor,
  voiceAnnouncementsFor,
} from '../i18n';

describe('ordinalDay', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [5, '5th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [31, '31st'],
  ])('formats day %i as %s', (day, expected) => {
    expect(ordinalDay(day)).toBe(expected);
  });
});

describe('formatVoiceDateTime', () => {
  it('drops a redundant :00 for an on-the-hour slot', () => {
    // 2026-09-05T10:00:00 IST (UTC+5:30) == 2026-09-05T04:30:00Z
    const result = formatVoiceDateTime('2026-09-05T04:30:00.000Z', 'Asia/Kolkata');
    expect(result.date).toBe('5th September');
    expect(result.time).toBe('10 AM');
  });

  it('keeps real minutes for a half-hour slot', () => {
    // 2026-09-05T10:30:00 IST == 2026-09-05T05:00:00Z
    const result = formatVoiceDateTime('2026-09-05T05:00:00.000Z', 'Asia/Kolkata');
    expect(result.date).toBe('5th September');
    expect(result.time).toBe('10:30 AM');
  });

  it('uses the salon timezone, not the raw UTC hour', () => {
    // 2026-09-05T23:30:00 UTC == 2026-09-06T05:00:00 IST (next day, matching a real +5:30 offset)
    const result = formatVoiceDateTime('2026-09-05T23:30:00.000Z', 'Asia/Kolkata');
    expect(result.date).toBe('6th September');
    expect(result.time).toBe('5 AM');
  });
});

describe('voiceAnnouncementsFor(EN).newBookingReceived', () => {
  const en = voiceAnnouncementsFor(Language.EN);

  it('announces the real assigned/preferred barber by name', () => {
    expect(en.newBookingReceived('Haircut', 'Dinesh', 'Handsome Center', '5th September', '10 AM')).toBe(
      'New Haircut service booked for Dinesh at Handsome Center on 5th September at 10 AM.',
    );
  });

  it('never invents a barber name when none is assigned or preferred', () => {
    const sentence = en.newBookingReceived('Haircut', null, 'Handsome Center', '5th September', '10 AM');
    expect(sentence).toBe('New Haircut service booked at Handsome Center on 5th September at 10 AM. Barber not assigned yet.');
    expect(sentence).not.toContain('Dinesh');
  });

  it('degrades gracefully when salon/date/time are unavailable', () => {
    expect(en.newBookingReceived('Haircut', 'Dinesh', null, null, null)).toBe('New Haircut service booked for Dinesh.');
  });
});

describe('voiceAnnouncementsFor(HI).newBookingReceived', () => {
  const hi = voiceAnnouncementsFor(Language.HI);

  it('includes the barber name when known', () => {
    const sentence = hi.newBookingReceived('Haircut', 'Dinesh', 'Handsome Center', '5th September', '10 AM');
    expect(sentence).toContain('Dinesh');
    expect(sentence).toContain('Handsome Center');
  });

  it('appends the not-assigned-yet notice instead of inventing a barber', () => {
    const sentence = hi.newBookingReceived('Haircut', null, 'Handsome Center', '5th September', '10 AM');
    expect(sentence).toContain('अभी तक बार्बर तय नहीं हुआ है');
  });
});

describe('uiStringsFor', () => {
  it('every language has a complete, distinct set of UI strings', () => {
    expect(Object.keys(UI_STRINGS[Language.EN]).sort()).toEqual(Object.keys(UI_STRINGS[Language.HI]).sort());
    // Spot-check a few keys actually differ between languages — catches an accidental EN copy-paste.
    expect(UI_STRINGS[Language.EN].book).not.toBe(UI_STRINGS[Language.HI].book);
    expect(UI_STRINGS[Language.EN].waiting).not.toBe(UI_STRINGS[Language.HI].waiting);
  });

  it('falls back to English for an unrecognised/unset language', () => {
    expect(uiStringsFor(undefined)).toBe(UI_STRINGS[Language.EN]);
    expect(uiStringsFor(null)).toBe(UI_STRINGS[Language.EN]);
  });

  it('resolves Hindi when requested', () => {
    expect(uiStringsFor(Language.HI)).toBe(UI_STRINGS[Language.HI]);
  });
});

// Guards against exactly the Build 9 physical-device regression: a NotificationsScreen kept its
// own English-only label map outside this module, so the screen heading could be Hindi while
// every notification title underneath stayed English. Every NotificationType must resolve to a
// real, distinct-from-English Hindi label — no silent fallback to the raw type string.
describe('notificationTypeLabel', () => {
  it('every NotificationType has a label in every language', () => {
    for (const language of [Language.EN, Language.HI]) {
      for (const type of NOTIFICATION_TYPES) {
        expect(NOTIFICATION_TYPE_LABELS[language][type]).toBeTruthy();
      }
    }
  });

  it('Hindi labels are actually Hindi, not a copy-pasted English fallback', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPE_LABELS[Language.HI][type]).not.toBe(NOTIFICATION_TYPE_LABELS[Language.EN][type]);
    }
  });

  it('falls back to the English label for an unrecognised/unset language', () => {
    expect(notificationTypeLabel(undefined, 'owner.booking.created')).toBe('New booking');
    expect(notificationTypeLabel(null, 'owner.booking.cancelled')).toBe('Booking cancelled');
  });

  it('resolves the correct Hindi label', () => {
    expect(notificationTypeLabel(Language.HI, 'owner.booking.created')).toBe('नई बुकिंग');
  });
});

// Push notification title/body are generated server-side (bookings.service.ts), the one path in
// this codebase where a push payload's copy was hardcoded English regardless of the recipient
// owner's preferredLanguage — a second concrete Build 9 physical-device defect distinct from the
// in-app notification list above.
describe('pushCopyFor', () => {
  it('every language produces a non-empty title and body for both event types', () => {
    for (const language of [Language.EN, Language.HI]) {
      const copy = PUSH_COPY[language];
      expect(copy.newBooking('Haircut').title).toBeTruthy();
      expect(copy.newBooking('Haircut').body).toBeTruthy();
      expect(copy.bookingCancelled('Haircut').title).toBeTruthy();
      expect(copy.bookingCancelled('Haircut').body).toBeTruthy();
    }
  });

  it('Hindi copy is actually Hindi, not an English copy-paste', () => {
    expect(PUSH_COPY[Language.HI].newBooking('Haircut').title).not.toBe(PUSH_COPY[Language.EN].newBooking('Haircut').title);
    expect(PUSH_COPY[Language.HI].bookingCancelled('Haircut').body).not.toBe(
      PUSH_COPY[Language.EN].bookingCancelled('Haircut').body,
    );
  });

  it('degrades gracefully with no service name', () => {
    expect(pushCopyFor(Language.EN).newBooking(null).body).toBeTruthy();
    expect(pushCopyFor(Language.HI).bookingCancelled(null).body).toBeTruthy();
  });

  it('falls back to English for an unrecognised/unset language', () => {
    expect(pushCopyFor(undefined)).toBe(PUSH_COPY[Language.EN]);
  });
});
