import { SpeechOutput, SPEECH_LIMITS, pickVoice, splitForSpeech } from '../speech-output';

// A fake speechSynthesis that behaves like the Chromium we measured (issue #371):
// voices arrive later via `voiceschanged`; `start` can be slow; events fire per utterance.
function rig({ voices = [], voicesLater = null } = {}) {
  const timers = [];
  let now = 0;
  const spoken = [];
  const listeners = {};
  const synth = {
    _voices: voices,
    speaking: false,
    pending: false,
    cancelled: 0,
    resumed: 0,
    getVoices() { return this._voices; },
    speak(u) { spoken.push(u); },
    cancel() { this.cancelled += 1; },
    resume() { this.resumed += 1; },
    addEventListener(t, fn) { listeners[t] = fn; },
    removeEventListener() {},
  };
  const deps = {
    synth,
    makeUtterance: (text) => ({ text, lang: '', voice: null, onstart: null, onend: null, onerror: null }),
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    now: () => now,
  };
  const out = new SpeechOutput(deps);
  const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
  const tick = async (ms) => { now += ms; for (const t of timers.filter((x) => x.live && x.at <= now)) { t.live = false; t.fn(); } await flush(); };
  const voicesArrive = async () => { synth._voices = voicesLater; listeners.voiceschanged?.(); await flush(); };
  return { out, synth, spoken, tick, flush, voicesArrive };
}
const V = (name, lang, localService = true) => ({ name, lang, localService, default: false });
const WINDOWS = [V('Microsoft David - English (United States)', 'en-US'), V('Microsoft Zira', 'en-US'), V('Microsoft Mark', 'en-US')];
const CHROME = [...WINDOWS, V('Google हिन्दी', 'hi-IN', false), V('Google UK English Female', 'en-GB', false), V('Microsoft Heera - English (India)', 'en-IN')];

describe('SpeechOutput', () => {
  it('waits for the voice list (0 voices at first), then uses an installed Hindi voice', async () => {
    const r = rig({ voices: [], voicesLater: CHROME });
    const p = r.out.speak('Teen chairs free hain.', 'hi-IN');
    await r.flush();
    expect(r.spoken).toHaveLength(0); // nothing spoken before the voices are known
    await r.voicesArrive();
    expect(r.spoken).toHaveLength(1);
    expect(r.spoken[0].voice.name).toBe('Google हिन्दी');
    expect(r.spoken[0].lang).toBe('hi-IN');
    r.spoken[0].onstart();
    r.spoken[0].onend();
    await expect(p).resolves.toEqual({ ok: true, voice: 'Google हिन्दी (hi-IN)' });
  });

  it('gives up waiting for voices after a short time and still speaks with the default', async () => {
    const r = rig({ voices: [] });
    const p = r.out.speak('Hello', 'en-IN');
    await r.tick(SPEECH_LIMITS.voicesWaitMs);
    expect(r.spoken).toHaveLength(1);
    r.spoken[0].onstart();
    r.spoken[0].onend();
    expect((await p).ok).toBe(true);
  });

  it('a reply counts as played only after "start": no start within the limit is a visible failure', async () => {
    const r = rig({ voices: WINDOWS });
    const p = r.out.speak('Queue mein 2 log hain.', 'hi-IN');
    await r.flush();
    await r.tick(SPEECH_LIMITS.startTimeoutMs);
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'no-start' });
  });

  it('a slow cold start (4.7 s measured) is NOT cut off: the end is timed from "start"', async () => {
    const r = rig({ voices: CHROME });
    const p = r.out.speak('Teen chairs free hain. Queue mein do log hain.', 'hi-IN');
    await r.flush();
    await r.tick(4700);
    r.spoken[0].onstart();
    await r.tick(3000); // still speaking; the old 4 s + 90 ms/char watchdog from speak() would have fired by now
    let settled = false;
    p.then(() => { settled = true; });
    await r.flush();
    expect(settled).toBe(false);
    r.spoken[0].onend();
    expect((await p).ok).toBe(true);
  });

  it('"end" without "start" (Devanagari sent to an English voice: 26 ms of silence) is a failure', async () => {
    const r = rig({ voices: WINDOWS });
    const p = r.out.speak('Hello there', 'en-IN');
    await r.flush();
    r.spoken[0].onend();
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'no-start' });
  });

  it('Devanagari-only text with no Hindi voice is reported, never "spoken" silently', async () => {
    const r = rig({ voices: WINDOWS });
    await expect(r.out.speak('तीन कुर्सियां खाली हैं।', 'hi-IN')).resolves.toMatchObject({ ok: false, reason: 'no-voice-for-text' });
    expect(r.spoken).toHaveLength(0);
  });

  it('mixed text with no Hindi voice: the English part is spoken, the Devanagari part dropped', async () => {
    const r = rig({ voices: WINDOWS });
    const p = r.out.speak('I heard "चेक करो". 3 chairs are free.', 'hi-IN');
    await r.flush();
    expect(r.spoken[0].text).not.toMatch(/[ऀ-ॿ]/);
    expect(r.spoken[0].text).toMatch(/3 chairs are free/);
    r.spoken[0].onstart();
    r.spoken[0].onend();
    expect((await p).ok).toBe(true);
  });

  it('browser blocked sound (not-allowed) and engine errors are distinguished', async () => {
    const r = rig({ voices: CHROME });
    const a = r.out.speak('Hello', 'en-IN');
    await r.flush();
    r.spoken[0].onerror({ error: 'not-allowed' });
    await expect(a).resolves.toMatchObject({ ok: false, reason: 'not-allowed' });
    const b = r.out.speak('Hello', 'en-IN');
    await r.flush();
    r.spoken[1].onerror({ error: 'synthesis-failed' });
    await expect(b).resolves.toMatchObject({ ok: false, reason: 'engine-error' });
  });

  it('cancel() resolves the reply as interrupted and only touches the engine when something plays', async () => {
    const r = rig({ voices: CHROME });
    r.out.cancel();
    expect(r.synth.cancelled).toBe(0); // nothing queued: the engine is left alone (cancel-then-speak drops replies)
    const p = r.out.speak('Hello', 'en-IN');
    await r.flush();
    r.synth.speaking = true;
    r.out.cancel();
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'interrupted' });
    expect(r.synth.cancelled).toBe(1);
  });

  it('long replies are spoken in chunks, one after another', async () => {
    const r = rig({ voices: CHROME });
    const text = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} is here to make this reply long enough.`).join(' ');
    const p = r.out.speak(text, 'en-IN');
    await r.flush();
    let i = 0;
    while (r.spoken[i]) {
      r.spoken[i].onstart();
      r.spoken[i].onend();
      await r.flush();
      i += 1;
    }
    expect(i).toBeGreaterThan(1);
    expect(r.spoken.every((u) => u.text.length <= SPEECH_LIMITS.chunkChars)).toBe(true);
    expect((await p).ok).toBe(true);
  });

  it('resumes a paused engine before speaking (Chrome after a tab switch)', async () => {
    const r = rig({ voices: CHROME });
    void r.out.speak('Hello', 'en-IN');
    await r.flush();
    expect(r.synth.resumed).toBeGreaterThan(0);
  });

  it('the voice the owner picked is used', async () => {
    const r = rig({ voices: CHROME });
    r.out.setPreferred('en', 'Google UK English Female');
    void r.out.speak('Hello', 'en-IN');
    await r.flush();
    expect(r.spoken[0].voice.name).toBe('Google UK English Female');
  });

  it('no speechSynthesis at all: unsupported, reported', async () => {
    const out = new SpeechOutput({ synth: null, makeUtterance: () => ({}), setTimer: () => 0, clearTimer: () => {} });
    await expect(out.speak('Hello', 'en-IN')).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('real-browser regression (#371): a slow voice must not queue the next chunk twice', () => {
  it('the watchdog waits while the engine still speaks; the late "end" advances exactly once', async () => {
    const r = rig({ voices: CHROME });
    const text = 'I am your FastQue Assistant. Ask me about the live queue, bookings, free chairs, services and prices, staff and more. I can open any page too: say Bookings kholo. Changes are switched off for now, so I only look things up.';
    const p = r.out.speak(text, 'en-IN');
    await r.flush();
    expect(r.spoken).toHaveLength(1);
    r.synth.speaking = true;
    r.spoken[0].onstart();
    await r.tick(26_000); // measured: 26 s for the first chunk with a slow default voice
    expect(r.spoken).toHaveLength(1); // still speaking: nothing else queued
    r.synth.speaking = false;
    r.spoken[0].onend();
    await r.flush();
    expect(r.spoken).toHaveLength(2); // the second chunk, once
    await r.tick(5_000);
    expect(r.spoken).toHaveLength(2);
    r.spoken[1].onstart();
    r.spoken[1].onend();
    expect((await p).ok).toBe(true);
    expect(r.spoken.map((u) => u.text).filter((t, i, a) => a.indexOf(t) !== i)).toEqual([]);
  });

  it('an engine that never reports "end" and stops speaking still moves on (no hang)', async () => {
    const r = rig({ voices: CHROME });
    const p = r.out.speak('Short reply.', 'en-IN');
    await r.flush();
    r.spoken[0].onstart();
    await r.tick(SPEECH_LIMITS.endGraceMs + 20 * SPEECH_LIMITS.msPerChar);
    await r.tick(SPEECH_LIMITS.watchEveryMs);
    expect((await p).ok).toBe(true);
  });

  it('a stuck engine that claims to speak forever is capped', async () => {
    const r = rig({ voices: CHROME });
    const p = r.out.speak('Short reply.', 'en-IN');
    await r.flush();
    r.synth.speaking = true;
    r.spoken[0].onstart();
    for (let t = 0; t < SPEECH_LIMITS.maxChunkMs + 10_000; t += 1_000) await r.tick(1_000);
    expect((await p).ok).toBe(true);
  });
});

describe('helpers', () => {
  it('pickVoice: exact language, then same language, else none', () => {
    const list = CHROME.map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
    expect(pickVoice(list, 'hi-IN')?.name).toBe('Google हिन्दी');
    expect(pickVoice(list, 'en-IN')?.name).toBe('Microsoft Heera - English (India)');
    expect(pickVoice(list.filter((v) => !v.lang.startsWith('hi')), 'hi-IN')).toBeNull();
  });
  it('splitForSpeech keeps sentences together and respects the limit', () => {
    expect(splitForSpeech('One. Two.')).toEqual(['One. Two.']);
    const parts = splitForSpeech('a'.repeat(100) + '. ' + 'b'.repeat(100) + '.');
    expect(parts).toHaveLength(2);
    expect(splitForSpeech('   ')).toEqual([]);
  });
});
