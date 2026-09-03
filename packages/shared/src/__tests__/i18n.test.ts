import { Language } from '../enums';
import { UI_STRINGS, formatVoiceDateTime, ordinalDay, uiStringsFor, voiceAnnouncementsFor } from '../i18n';

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
