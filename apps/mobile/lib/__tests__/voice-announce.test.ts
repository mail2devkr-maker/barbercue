import { Language } from '@barbercue/shared';

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  getAvailableVoicesAsync: jest.fn(),
}));

import * as Speech from 'expo-speech';
import { speakBooking, __resetVoiceCacheForTests } from '../voice-announce';

const speakMock = Speech.speak as jest.Mock;
const getVoicesMock = Speech.getAvailableVoicesAsync as jest.Mock;

// Flushes the getVoices() -> .then(...) -> Speech.speak() microtask chain inside speakBooking.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('speakBooking — the exact call site voice/TTS reaches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetVoiceCacheForTests();
  });

  it('English -> Hindi switch: booking.created speaks a Hindi sentence with the hi-IN locale', async () => {
    getVoicesMock.mockResolvedValue([{ identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' }]);

    speakBooking({
      event: 'booking.created',
      bookingId: 'b1',
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

  it('English -> Hindi switch: booking.cancelled speaks a Hindi cancellation sentence with the hi-IN locale', async () => {
    getVoicesMock.mockResolvedValue([{ identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' }]);

    speakBooking({ event: 'booking.cancelled', bookingId: 'b1', language: Language.HI });
    await flush();

    expect(speakMock).toHaveBeenCalledTimes(1);
    const [text, options] = speakMock.mock.calls[0];
    expect(text).toBe('बुकिंग रद्द कर दी गई है।');
    expect(options.language).toBe('hi-IN');
  });

  it('Hindi -> English switch: booking.created speaks English with the en-IN locale', async () => {
    getVoicesMock.mockResolvedValue([{ identifier: 'en-in-voice', name: 'English India', language: 'en-IN', quality: 'Default' }]);

    speakBooking({
      event: 'booking.created',
      bookingId: 'b2',
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
  });

  it('Hindi -> English switch: booking.cancelled speaks English with the en-IN locale', async () => {
    getVoicesMock.mockResolvedValue([{ identifier: 'en-in-voice', name: 'English India', language: 'en-IN', quality: 'Default' }]);

    speakBooking({ event: 'booking.cancelled', bookingId: 'b2', language: Language.EN });
    await flush();

    const [text, options] = speakMock.mock.calls[0];
    expect(text).toBe('Booking cancelled.');
    expect(options.language).toBe('en-IN');
  });

  it('create then cancel the same booking ID: each call gets its own correctly-localized announcement', async () => {
    getVoicesMock.mockResolvedValue([{ identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' }]);

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

  it('no installed voice matches the requested Hindi locale: still requests hi-IN by language tag and does not silently substitute English', async () => {
    getVoicesMock.mockResolvedValue([{ identifier: 'en-us-voice', name: 'English US', language: 'en-US', quality: 'Default' }]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    speakBooking({ event: 'booking.cancelled', bookingId: 'b3', language: Language.HI });
    await flush();

    const [text, options] = speakMock.mock.calls[0];
    expect(text).toBe('बुकिंग रद्द कर दी गई है।'); // text stays Hindi, never silently swapped to English
    expect(options.language).toBe('hi-IN'); // locale request stays hi-IN, never silently swapped
    expect(options.voice).toBeUndefined(); // no matching voice id to pass
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no installed voice matches requested locale'),
      expect.objectContaining({ requestedLocale: 'hi-IN' }),
    );
    warnSpy.mockRestore();
  });
});
