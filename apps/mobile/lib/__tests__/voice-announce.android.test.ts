import { Language } from '@barbercue/shared';

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  getAvailableVoicesAsync: jest.fn(),
}));

import * as Speech from 'expo-speech';
import {
  androidSpeechLanguageFor,
  speakBooking,
  __resetHindiVoiceWarningThrottleForTests,
  __resetVoiceCacheForTests,
} from '../voice-announce.android';

const speakMock = Speech.speak as jest.Mock;
const getVoicesMock = Speech.getAvailableVoicesAsync as jest.Mock;

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('voice-announce.android — Expo SDK 57 Locale(String) workaround', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
    __resetVoiceCacheForTests();
    __resetHindiVoiceWarningThrottleForTests();
    // Normal successful native lifecycle so watchdog timers are cleared in ordinary tests.
    speakMock.mockImplementation((_text: string, options: { onStart?: () => void; onDone?: () => void }) => {
      options.onStart?.();
      options.onDone?.();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes BCP-47 Hindi tags to the bare primary subtag for Expo Android', () => {
    expect(androidSpeechLanguageFor('hi-IN', 'hi-IN')).toBe('hi');
    expect(androidSpeechLanguageFor('hi_IN', 'hi-IN')).toBe('hi');
    expect(androidSpeechLanguageFor('hi-Deva-IN', 'hi-IN')).toBe('hi');
    expect(androidSpeechLanguageFor(undefined, 'hi-IN')).toBe('hi');
  });

  it('uses a real hi-IN voice id but passes bare hi to the SDK-57 Android native layer', async () => {
    getVoicesMock.mockResolvedValue([
      { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
    ]);

    speakBooking({ event: 'booking.cancelled', bookingId: 'b1', language: Language.HI });
    await flush();

    expect(speakMock).toHaveBeenCalledTimes(1);
    const [text, options] = speakMock.mock.calls[0];
    expect(text).toBe('बुकिंग रद्द कर दी गई है।');
    expect(options.language).toBe('hi');
    expect(options.voice).toBe('hi-in-voice');
  });

  it('speaks a Hindi reschedule announcement with the new slot using the same Android Hindi voice path', async () => {
    getVoicesMock.mockResolvedValue([
      { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
    ]);

    speakBooking({ event: 'booking.rescheduled', bookingId: 'b-rescheduled', language: Language.HI, date: '10th September', time: '4 PM' });
    await flush();

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toContain('बुकिंग पुनर्निर्धारित की गई है');
    expect(speakMock.mock.calls[0][0]).toContain('10th September');
    expect(speakMock.mock.calls[0][0]).toContain('4 PM');
    expect(speakMock.mock.calls[0][1]).toEqual(expect.objectContaining({ language: 'hi', voice: 'hi-in-voice' }));
  });

  it('also uses bare hi with an underscore-form Hindi voice returned by an Android engine', async () => {
    getVoicesMock.mockResolvedValue([
      { identifier: 'hi-underscore', name: 'Hindi India', language: 'hi_IN', quality: 'Default' },
    ]);

    speakBooking({ event: 'booking.cancelled', bookingId: 'b2', language: Language.HI });
    await flush();

    expect(speakMock.mock.calls[0][1]).toEqual(expect.objectContaining({ language: 'hi', voice: 'hi-underscore' }));
  });

  it('preserves the previously passing English Android behavior', async () => {
    getVoicesMock.mockResolvedValue([
      { identifier: 'en-in-voice', name: 'English India', language: 'en-IN', quality: 'Default' },
    ]);

    speakBooking({ event: 'booking.cancelled', bookingId: 'b3', language: Language.EN });
    await flush();

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][1]).toEqual(expect.objectContaining({ language: 'en-IN', voice: 'en-in-voice' }));
  });

  it('never falls through to an English voice when Hindi is requested but unavailable', async () => {
    getVoicesMock.mockResolvedValue([
      { identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' },
    ]);
    const onHindiVoiceMissing = jest.fn();

    speakBooking({
      event: 'booking.cancelled',
      bookingId: 'b4',
      language: Language.HI,
      onHindiVoiceMissing,
    });
    await flush();

    expect(speakMock).not.toHaveBeenCalled();
    expect(onHindiVoiceMissing).toHaveBeenCalledTimes(1);
  });

  it('retries the next genuine Hindi voice on native error, still using bare hi each time', async () => {
    getVoicesMock.mockResolvedValue([
      { identifier: 'hi-a', name: 'Hindi A', language: 'hi-IN', quality: 'Default' },
      { identifier: 'hi-b', name: 'Hindi B', language: 'hi-Deva-IN', quality: 'Default' },
      { identifier: 'en', name: 'English', language: 'en-US', quality: 'Default' },
    ]);
    speakMock
      .mockImplementationOnce((_text: string, options: { onError?: (error: unknown) => void }) => {
        options.onError?.(new Error('first voice failed'));
      })
      .mockImplementationOnce((_text: string, options: { onStart?: () => void; onDone?: () => void }) => {
        options.onStart?.();
        options.onDone?.();
      });
    const onHindiVoiceMissing = jest.fn();

    speakBooking({
      event: 'booking.cancelled',
      bookingId: 'b5',
      language: Language.HI,
      onHindiVoiceMissing,
    });
    await flush();

    expect(speakMock).toHaveBeenCalledTimes(2);
    expect(speakMock.mock.calls[0][1]).toEqual(expect.objectContaining({ language: 'hi', voice: 'hi-a' }));
    expect(speakMock.mock.calls[1][1]).toEqual(expect.objectContaining({ language: 'hi', voice: 'hi-b' }));
    expect(speakMock.mock.calls.some((call) => call[1].voice === 'en')).toBe(false);
    expect(onHindiVoiceMissing).not.toHaveBeenCalled();
  });

  it('surfaces a visible failure callback if Android accepts speak but produces no native callbacks', async () => {
    jest.useFakeTimers();
    getVoicesMock.mockResolvedValue([
      { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },
    ]);
    speakMock.mockImplementation(() => {
      // Simulate the physical failure mode: native call returns, but no start/done/error callback.
    });
    const onHindiVoiceMissing = jest.fn();

    speakBooking({
      event: 'booking.cancelled',
      bookingId: 'b6',
      language: Language.HI,
      onHindiVoiceMissing,
    });
    await flush();

    expect(onHindiVoiceMissing).not.toHaveBeenCalled();
    jest.advanceTimersByTime(8_000);
    expect(onHindiVoiceMissing).toHaveBeenCalledTimes(1);
  });
});
