import { Language } from '@barbercue/shared';

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  getAvailableVoicesAsync: jest.fn(),
}));

import * as Speech from 'expo-speech';
import {
  speakBooking,
  __resetVoiceCacheForTests,
  __resetHindiVoiceWarningThrottleForTests,
} from '../voice-announce';

const speakMock = Speech.speak as jest.Mock;
const getVoicesMock = Speech.getAvailableVoicesAsync as jest.Mock;

// Flushes the getVoices() -> .then(...) -> Speech.speak() microtask chain inside speakBooking.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('speakBooking — Hindi voice-selection hardening (Build 10 physical retest: Hindi new-booking spoke English, Hindi cancellation was silent)', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks): a couple of tests below set a persistent
    // mockImplementation on speakMock (not mockImplementationOnce) to simulate a
    // permanently-failing engine — clearAllMocks only resets call history, not implementations,
    // which would otherwise leak that failing behavior into every later test in this file.
    jest.resetAllMocks();
    __resetVoiceCacheForTests();
    __resetHindiVoiceWarningThrottleForTests();
  });

  describe('voice selection — hi-IN / bare hi / other hi-* families', () => {
    it('selects an exact hi-IN voice by identifier when installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b1', language: Language.HI });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(1);
      const [text, options] = speakMock.mock.calls[0];
      expect(text).toBe('बुकिंग रद्द कर दी गई है।');
      expect(options.language).toBe('hi-IN');
      expect(options.voice).toBe('hi-in-voice');
    });

    it('selects a bare "hi" voice (no region subtag) by identifier when that is all that is installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-bare-voice', name: 'Hindi', language: 'hi', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b2', language: Language.HI });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(1);
      const [, options] = speakMock.mock.calls[0];
      expect(options.voice).toBe('hi-bare-voice');
    });

    it('selects another hi-* family voice (e.g. underscore-separated "hi_IN") by identifier', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-underscore-voice', name: 'Hindi (India)', language: 'hi_IN', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b3', language: Language.HI });
      await flush();

      const [, options] = speakMock.mock.calls[0];
      expect(options.voice).toBe('hi-underscore-voice');
    });

    it('prefers an exact hi-IN match over a same-family hi-* voice when both are installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-generic-voice', name: 'Hindi generic', language: 'hi-Latn', quality: 'Default' },
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Enhanced' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b4', language: Language.HI });
      await flush();

      const [, options] = speakMock.mock.calls[0];
      expect(options.voice).toBe('hi-in-voice');
    });
  });

  describe('English-only device: Hindi never falls back to an English/default voice', () => {
    it('an English-only device skips Hindi speech entirely rather than speaking with an English voice', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      speakBooking({ event: 'booking.cancelled', bookingId: 'b5', language: Language.HI });
      await flush();

      expect(speakMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('no installed Hindi-family voice found'),
        expect.objectContaining({ requestedLocale: 'hi-IN' }),
      );
      warnSpy.mockRestore();
    });

    it('a device with zero installed voices at all also skips Hindi speech rather than defaulting', async () => {
      getVoicesMock.mockResolvedValue([]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b6', language: Language.HI });
      await flush();

      expect(speakMock).not.toHaveBeenCalled();
    });
  });

  describe('all-Hindi-voices-fail warning (throttled, actionable)', () => {
    it('calls onHindiVoiceMissing exactly once when no Hindi voice is installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);
      const onHindiVoiceMissing = jest.fn();

      speakBooking({ event: 'booking.cancelled', bookingId: 'b7', language: Language.HI, onHindiVoiceMissing });
      await flush();

      expect(onHindiVoiceMissing).toHaveBeenCalledTimes(1);
    });

    it('never calls onHindiVoiceMissing for English, even with zero matching voices', async () => {
      getVoicesMock.mockResolvedValue([]);
      const onHindiVoiceMissing = jest.fn();

      speakBooking({ event: 'booking.cancelled', bookingId: 'b8', language: Language.EN, onHindiVoiceMissing });
      await flush();

      expect(onHindiVoiceMissing).not.toHaveBeenCalled();
      // English still speaks (unchanged, regression guard) even with no matching voice installed.
      expect(speakMock).toHaveBeenCalledTimes(1);
    });

    it('throttles repeated warnings: two Hindi announcements within the cooldown window warn only once', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);
      const onHindiVoiceMissing = jest.fn();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b9', language: Language.HI, onHindiVoiceMissing });
      await flush();
      speakBooking({ event: 'booking.cancelled', bookingId: 'b10', language: Language.HI, onHindiVoiceMissing });
      await flush();

      expect(onHindiVoiceMissing).toHaveBeenCalledTimes(1);
      nowSpy.mockRestore();
    });

    it('warns again once the throttle cooldown has elapsed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);
      const onHindiVoiceMissing = jest.fn();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b11', language: Language.HI, onHindiVoiceMissing });
      await flush();

      nowSpy.mockReturnValue(1_000_000 + 6 * 60_000); // past the 5-minute cooldown
      speakBooking({ event: 'booking.cancelled', bookingId: 'b12', language: Language.HI, onHindiVoiceMissing });
      await flush();

      expect(onHindiVoiceMissing).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });
  });

  describe('new-booking and cancellation both use the same canonical voice-selection behavior', () => {
    it('Hindi new-booking path: speaks with the matched Hindi voice when one is installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
      ]);

      speakBooking({
        event: 'booking.created',
        bookingId: 'b13',
        language: Language.HI,
        serviceName: 'Haircut',
        barberName: null,
        salonName: 'Test Salon',
        date: null,
        time: null,
      });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(1);
      const [text, options] = speakMock.mock.calls[0];
      expect(text).toContain('नई');
      expect(text).toMatch(/[ऀ-ॿ]/); // contains Devanagari
      expect(options.language).toBe('hi-IN');
      expect(options.voice).toBe('hi-in-voice');
    });

    it('Hindi new-booking path: skips speech (never English fallback) and warns when no Hindi voice is installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);
      const onHindiVoiceMissing = jest.fn();

      speakBooking({
        event: 'booking.created',
        bookingId: 'b14',
        language: Language.HI,
        serviceName: 'Haircut',
        barberName: null,
        salonName: 'Test Salon',
        date: null,
        time: null,
        onHindiVoiceMissing,
      });
      await flush();

      expect(speakMock).not.toHaveBeenCalled();
      expect(onHindiVoiceMissing).toHaveBeenCalledTimes(1);
    });

    it('Hindi cancellation path: speaks with the matched Hindi voice when one is installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b15', language: Language.HI });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(1);
      const [text, options] = speakMock.mock.calls[0];
      expect(text).toBe('बुकिंग रद्द कर दी गई है।');
      expect(options.voice).toBe('hi-in-voice');
    });

    it('Hindi cancellation path: skips speech (never silent-without-explanation) and warns when no Hindi voice is installed', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);
      const onHindiVoiceMissing = jest.fn();

      speakBooking({ event: 'booking.cancelled', bookingId: 'b16', language: Language.HI, onHindiVoiceMissing });
      await flush();

      expect(speakMock).not.toHaveBeenCalled();
      expect(onHindiVoiceMissing).toHaveBeenCalledTimes(1);
    });

    it('create then cancel the same booking ID: each call gets its own correctly-localized announcement', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
      ]);

      speakBooking({
        event: 'booking.created',
        bookingId: 'shared-id',
        language: Language.HI,
        serviceName: 'Beard Trim',
        barberName: null,
        salonName: null,
        date: null,
        time: null,
      });
      await flush();
      speakBooking({ event: 'booking.cancelled', bookingId: 'shared-id', language: Language.HI });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(2);
      expect(speakMock.mock.calls[0][0]).toContain('नई');
      expect(speakMock.mock.calls[1][0]).toBe('बुकिंग रद्द कर दी गई है।');
    });
  });

  describe('bounded Hindi retry — walks the ordered candidate list of genuine Hindi voices, never English', () => {
    it('Voice A fails -> Voice B is attempted and succeeds; no English voice attempted, no missing-Hindi warning', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hindi-voice-a', name: 'Hindi Voice A', language: 'hi-IN', quality: 'Default' },
        { identifier: 'hindi-voice-b', name: 'Hindi Voice B', language: 'hi-Deva-IN', quality: 'Default' },
        { identifier: 'english-voice', name: 'English Voice', language: 'en-US', quality: 'Default' },
      ]);
      speakMock.mockImplementationOnce((_text: string, options: { onError?: (e: unknown) => void }) => {
        options.onError?.(new Error('Voice A failed'));
      });
      speakMock.mockImplementationOnce(() => {
        // Voice B succeeds — no onError called.
      });
      const onHindiVoiceMissing = jest.fn();

      speakBooking({ event: 'booking.cancelled', bookingId: 'b17', language: Language.HI, onHindiVoiceMissing });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(2);
      expect(speakMock.mock.calls[0][1].voice).toBe('hindi-voice-a');
      expect(speakMock.mock.calls[1][1].voice).toBe('hindi-voice-b');
      // Never the English voice, at any point.
      expect(speakMock.mock.calls.some((call) => call[1].voice === 'english-voice')).toBe(false);
      expect(onHindiVoiceMissing).not.toHaveBeenCalled();
    });

    it('Voice A fails, Voice B also fails -> warning fires and the English voice is never attempted', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hindi-voice-a', name: 'Hindi Voice A', language: 'hi-IN', quality: 'Default' },
        { identifier: 'hindi-voice-b', name: 'Hindi Voice B', language: 'hi-Deva-IN', quality: 'Default' },
        { identifier: 'english-voice', name: 'English Voice', language: 'en-US', quality: 'Default' },
      ]);
      speakMock.mockImplementation((_text: string, options: { onError?: (e: unknown) => void }) => {
        options.onError?.(new Error('engine keeps failing'));
      });
      const onHindiVoiceMissing = jest.fn();

      speakBooking({ event: 'booking.cancelled', bookingId: 'b18', language: Language.HI, onHindiVoiceMissing });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(2); // Voice A + Voice B, bounded by the candidate list length
      expect(speakMock.mock.calls[0][1].voice).toBe('hindi-voice-a');
      expect(speakMock.mock.calls[1][1].voice).toBe('hindi-voice-b');
      expect(speakMock.mock.calls.some((call) => call[1].voice === 'english-voice')).toBe(false);
      expect(onHindiVoiceMissing).toHaveBeenCalledTimes(1);
    });

    it('with three genuine Hindi voices, walks A -> B -> C and stops (bounded by the candidate list length, never a fourth attempt)', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hindi-voice-a', name: 'Hindi Voice A', language: 'hi-IN', quality: 'Default' },
        { identifier: 'hindi-voice-b', name: 'Hindi Voice B', language: 'hi_IN', quality: 'Default' },
        { identifier: 'hindi-voice-c', name: 'Hindi Voice C', language: 'hi', quality: 'Default' },
      ]);
      speakMock.mockImplementation((_text: string, options: { onError?: (e: unknown) => void }) => {
        options.onError?.(new Error('always fails'));
      });

      speakBooking({ event: 'booking.cancelled', bookingId: 'b19', language: Language.HI });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(3);
      expect(speakMock.mock.calls.map((call) => call[1].voice)).toEqual(['hindi-voice-a', 'hindi-voice-b', 'hindi-voice-c']);
    });

    it('never attempts a retry at all for Hindi when no voice was matched in the first place (nothing genuine to retry)', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b20', language: Language.HI });
      await flush();

      expect(speakMock).not.toHaveBeenCalled();
    });
  });

  describe('voice cache refresh — a stale "no Hindi voice" result does not persist forever', () => {
    it('does not re-query the device on a second Hindi announcement within the cooldown, even though no Hindi voice was found', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b21', language: Language.HI });
      await flush();
      speakBooking({ event: 'booking.cancelled', bookingId: 'b22', language: Language.HI });
      await flush();

      expect(getVoicesMock).toHaveBeenCalledTimes(1); // second call reused the cached (negative) result
      nowSpy.mockRestore();
    });

    it('re-queries the device once the warning cooldown has elapsed, and finds the newly-installed Hindi voice', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      // First check: no Hindi voice yet.
      getVoicesMock.mockResolvedValueOnce([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b23', language: Language.HI });
      await flush();
      expect(speakMock).not.toHaveBeenCalled();

      // Owner installs a Hindi voice and reopens the app; enough time has passed for a recheck.
      nowSpy.mockReturnValue(1_000_000 + 6 * 60_000);
      getVoicesMock.mockResolvedValueOnce([
        { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b24', language: Language.HI });
      await flush();

      expect(getVoicesMock).toHaveBeenCalledTimes(2); // re-queried, not trusted from the stale cache
      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(speakMock.mock.calls[0][1].voice).toBe('hi-in-voice');
      nowSpy.mockRestore();
    });

    it('never re-queries the device once a Hindi voice has already been found, no matter how many bookings follow', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
      ]);
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      speakBooking({ event: 'booking.cancelled', bookingId: 'b25', language: Language.HI });
      await flush();

      nowSpy.mockReturnValue(1_000_000 + 60 * 60_000); // an hour later — well past any cooldown
      speakBooking({ event: 'booking.cancelled', bookingId: 'b26', language: Language.HI });
      await flush();

      expect(getVoicesMock).toHaveBeenCalledTimes(1); // a known-good result is never re-queried
      expect(speakMock).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });
  });

  describe('English regression guard — pre-existing, physically-verified-working behavior is unchanged', () => {
    it('booking.created speaks English with the en-IN locale and a matched voice', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-in-voice', name: 'English India', language: 'en-IN', quality: 'Default' },
      ]);

      speakBooking({
        event: 'booking.created',
        bookingId: 'b20',
        language: Language.EN,
        serviceName: 'Haircut',
        barberName: 'Sam',
        salonName: 'Test Salon',
        date: null,
        time: null,
      });
      await flush();

      const [text, options] = speakMock.mock.calls[0];
      expect(text).toContain('New Haircut service booked for Sam at Test Salon');
      expect(options.language).toBe('en-IN');
      expect(options.voice).toBe('en-in-voice');
    });

    it('booking.cancelled speaks English with the en-IN locale', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'en-in-voice', name: 'English India', language: 'en-IN', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b21', language: Language.EN });
      await flush();

      const [text, options] = speakMock.mock.calls[0];
      expect(text).toBe('Booking cancelled.');
      expect(options.language).toBe('en-IN');
    });

    it('English still speaks (with the bare language tag, no voice id) even when no voice matches at all', async () => {
      getVoicesMock.mockResolvedValue([
        { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
      ]);

      speakBooking({ event: 'booking.cancelled', bookingId: 'b22', language: Language.EN });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(1);
      const [, options] = speakMock.mock.calls[0];
      expect(options.language).toBe('en-IN');
      expect(options.voice).toBeUndefined();
    });

    it('English still retries once with the bare subtag on a genuine engine error', async () => {
      getVoicesMock.mockResolvedValue([]);
      speakMock.mockImplementationOnce((_text: string, options: { onError?: (e: unknown) => void }) => {
        options.onError?.(new Error('engine error'));
      });
      speakMock.mockImplementationOnce(() => {});

      speakBooking({ event: 'booking.cancelled', bookingId: 'b23', language: Language.EN });
      await flush();

      expect(speakMock).toHaveBeenCalledTimes(2);
      expect(speakMock.mock.calls[0][1].language).toBe('en-IN');
      expect(speakMock.mock.calls[1][1].language).toBe('en');
    });
  });
});
