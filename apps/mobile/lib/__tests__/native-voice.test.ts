import { createNativeRecognizer } from '../native-voice';
import { readResults } from '../voice-conversation';
import { createNativeSpeaker, speechLanguageFor } from '../speech-output';

jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));

type Listener = (event: any) => void;
function fakeModule() {
  const listeners = new Map<string, Listener[]>();
  const calls: { start: any[]; stop: number; abort: number } = { start: [], stop: 0, abort: 0 };
  return {
    calls,
    emit: (name: string, event: unknown = null) => (listeners.get(name) ?? []).forEach((l) => l(event)),
    module: {
      start: (opts: unknown) => { calls.start.push(opts); },
      stop: () => { calls.stop += 1; },
      abort: () => { calls.abort += 1; },
      addListener: (name: string, fn: Listener) => {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
        return { remove: () => listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== fn)) };
      },
    } as never,
  };
}

describe('native recognizer adapter', () => {
  it('starts the phone recognizer with the chosen language and continuous interim results', () => {
    const f = fakeModule();
    const r = createNativeRecognizer(f.module);
    r.lang = 'hi-IN';
    r.start();
    expect(f.calls.start[0]).toMatchObject({ lang: 'hi-IN', interimResults: true, continuous: true, maxAlternatives: 5 });
  });

  it('turns native utterances into the browser-style continuous result list the shared engine reads', () => {
    const f = fakeModule();
    const r = createNativeRecognizer(f.module);
    const seen: Array<ReturnType<typeof readResults>> = [];
    r.onresult = (event) => seen.push(readResults(event.results));
    r.start();
    f.emit('result', { isFinal: false, results: [{ transcript: 'kitni', confidence: -1 }] });
    f.emit('result', { isFinal: true, results: [{ transcript: 'kitni chairs', confidence: 0.9 }, { transcript: 'kitne chairs', confidence: 0.5 }] });
    f.emit('result', { isFinal: true, results: [{ transcript: 'free hain', confidence: 0.8 }] });
    expect(seen[0]).toEqual({ final: null, interim: 'kitni' });
    expect(seen[1].final).toEqual({ text: 'kitni chairs', alternatives: ['kitne chairs'], confidence: 0.9 });
    expect(seen[2].final?.text).toBe('kitni chairs free hain');
  });

  it('passes native error codes through and detaches on end', () => {
    const f = fakeModule();
    const r = createNativeRecognizer(f.module);
    const errors: string[] = [];
    let ended = 0;
    r.onerror = (e) => errors.push(e.error);
    r.onend = () => { ended += 1; };
    r.start();
    f.emit('error', { error: 'not-allowed' });
    f.emit('end');
    f.emit('end');
    expect(errors).toEqual(['not-allowed']);
    expect(ended).toBe(1);
  });
});

describe('native speaker', () => {
  function fakeEngine() {
    let opts: any = null;
    return { engine: { speak: (_t: string, o: any) => { opts = o; }, stop: jest.fn(async () => undefined) }, get opts() { return opts; } };
  }

  it('speaks Devanagari with a Hindi voice and reports played only when the engine finished', async () => {
    const f = fakeEngine();
    const speaker = createNativeSpeaker(f.engine as never);
    const p = speaker.speak('तीन चेयर खाली हैं', 'en-IN');
    expect(f.opts.language).toBe('hi-IN');
    f.opts.onStart(); f.opts.onDone();
    await expect(p).resolves.toEqual({ ok: true, voice: 'hi-IN' });
  });

  it('reports a missing Hindi voice instead of moving on silently', async () => {
    const f = fakeEngine();
    const p = createNativeSpeaker(f.engine as never).speak('नमस्ते', 'hi-IN');
    f.opts.onError(new Error('no voice'));
    await expect(p).resolves.toEqual({ ok: false, reason: 'no-voice-for-text' });
  });

  it('cancel interrupts the current reply', async () => {
    const f = fakeEngine();
    const speaker = createNativeSpeaker(f.engine as never);
    const p = speaker.speak('Hello', 'en-IN');
    speaker.cancel();
    await expect(p).resolves.toEqual({ ok: false, reason: 'interrupted' });
    expect(f.engine.stop).toHaveBeenCalled();
  });

  it('keeps Latin text in the chosen language', () => {
    expect(speechLanguageFor('Bookings kholo', 'hi-IN')).toBe('hi-IN');
    expect(speechLanguageFor('Open bookings', 'en-IN')).toBe('en-IN');
  });
});
