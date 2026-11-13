// Keep in step with apps/web/lib/__tests__/voice-conversation.test.jsx — same engine, same rules.
import { VoiceConversation, VOICE_LIMITS, readResults } from '../voice-conversation';

// Fakes: a recognizer we drive by hand, a speaker we finish by hand, and a manual clock.
function rig({ speaker = true, replies = [] } = {}) {
  const recs = [];
  const timers = [];
  let now = 0;
  const spoken = [];
  const sent = [];
  const queue = [...replies];
  const speak = { pending: null, cancelled: 0 };
  const deps = {
    createRecognizer: () => {
      const r = {
        lang: '', interimResults: false, continuous: false, maxAlternatives: 0,
        started: 0, aborted: 0,
        start() { this.started += 1; }, stop() {}, abort() { this.aborted += 1; },
        onresult: null, onerror: null, onend: null, onaudiostart: null,
      };
      recs.push(r);
      return r;
    },
    speaker: speaker ? {
      speak: (text, lang) => new Promise((resolve) => { spoken.push({ text, lang }); speak.pending = resolve; }),
      cancel: () => { speak.cancelled += 1; const p = speak.pending; speak.pending = null; p?.({ ok: false, reason: 'interrupted' }); },
    } : null,
    send: (heard) => { sent.push(heard); const r = queue.shift() ?? { say: `ok: ${heard.text}` }; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); },
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    now: () => now,
  };
  const v = new VoiceConversation(deps);
  const last = () => recs[recs.length - 1];
  const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
  const tick = async (ms = 0) => {
    now += ms;
    for (const t of timers.filter((x) => x.live && x.at <= now)) { t.live = false; t.fn(); }
    await flush();
  };
  const result = (segments) => ({ results: segments.map(([alts, isFinal]) => Object.assign(alts.map((a) => (typeof a === 'string' ? { transcript: a } : a)), { isFinal })) });
  /** Say a complete phrase: final result, then the end-of-phrase silence. */
  const say = async (text, alts = []) => {
    last().onresult(result([[[text, ...alts], true]]));
    await tick(VOICE_LIMITS.endOfPhraseMs);
  };
  const finishSpeaking = async (r = { ok: true, voice: 'Google हिन्दी (hi-IN)' }) => {
    const p = speak.pending; speak.pending = null; p?.(r); await flush(); await tick(VOICE_LIMITS.afterSpeechDelayMs);
  };
  return { v, recs, last, say, tick, flush, result, finishSpeaking, spoken, sent, speak, timers };
}

describe('VoiceConversation (#368 behaviour kept)', () => {
  it('two consecutive turns without pressing the microphone again, replies spoken in between', async () => {
    const r = rig({ replies: [{ say: 'Teen chairs free hain.' }, { say: 'Queue mein 2 log hain.' }] });
    r.v.start('hi-IN');
    expect(r.v.snapshot.state).toBe('listening');
    expect(r.last().lang).toBe('hi-IN');
    await r.say('चेक करो कितनी चेयर्स अवेलेबल हैं');
    expect(r.recs[0].aborted).toBe(1); // mic closed before the request
    expect(r.v.snapshot.state).toBe('replying');
    expect(r.spoken[0]).toEqual({ text: 'Teen chairs free hain.', lang: 'hi-IN' });
    expect(r.recs).toHaveLength(1); // mic stays closed while speaking (no echo)
    await r.finishSpeaking();
    expect(r.v.snapshot.state).toBe('listening');
    expect(r.recs).toHaveLength(2);
    await r.say('Aaj queue mein kitne log hain?');
    await r.finishSpeaking();
    expect(r.sent.map((s) => s.text)).toEqual(['चेक करो कितनी चेयर्स अवेलेबल हैं', 'Aaj queue mein kitne log hain?']);
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('Stop before the phrase completes: nothing is sent or spoken and no microphone reopens', async () => {
    const r = rig();
    r.v.start();
    r.last().onresult(r.result([[['bookings dikhao'], true]]));
    await r.tick(VOICE_LIMITS.endOfPhraseMs - 1);
    r.v.end();
    await r.tick(10_000);
    expect(r.spoken).toEqual([]);
    expect(r.sent).toEqual([]);
    expect(r.recs).toHaveLength(1);
  });

  it('interrupt() stops speaking and listens immediately; an interruption is not an error', async () => {
    const r = rig();
    r.v.start();
    await r.say('services dikhao');
    expect(r.v.snapshot.state).toBe('replying');
    r.v.interrupt();
    expect(r.speak.cancelled).toBeGreaterThan(0);
    expect(r.v.snapshot.state).toBe('listening');
    await r.flush();
    expect(r.v.snapshot.speechError).toBeNull();
    expect(r.recs).toHaveLength(2);
  });

  it('muted: replies are not spoken and listening resumes', async () => {
    const r = rig();
    r.v.setMuted(true);
    r.v.start();
    await r.say('staff dikhao');
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    expect(r.spoken).toEqual([]);
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('repeated silence pauses; nothing restarts while paused; resume reopens', async () => {
    const r = rig();
    r.v.start();
    for (let i = 1; i < VOICE_LIMITS.silentRestarts; i += 1) {
      r.last().onerror({ error: 'no-speech' });
      r.last().onend();
      await r.tick(VOICE_LIMITS.restartDelayMs);
    }
    r.last().onend();
    expect(r.v.snapshot.state).toBe('paused');
    await r.tick(5_000);
    expect(r.recs).toHaveLength(VOICE_LIMITS.silentRestarts);
    r.v.resume();
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('microphone permission revoked / microphone lost: error, mic released, no retry loop', async () => {
    for (const code of ['not-allowed', 'audio-capture']) {
      const r = rig();
      r.v.start();
      r.last().onerror({ error: code });
      expect(r.v.snapshot.state).toBe('error');
      expect(r.recs[0].aborted).toBe(1);
      await r.tick(5_000);
      expect(r.recs).toHaveLength(1);
    }
  });

  it('a confirmation is never given by voice: the conversation holds for an on-screen decision', async () => {
    const r = rig({ replies: [{ say: 'Please confirm on screen.', hold: true }] });
    r.v.start();
    await r.say('haircut 150 karo');
    await r.finishSpeaking();
    expect(r.v.snapshot.state).toBe('paused');
  });

  it('assistant switched off for the account ends the conversation', async () => {
    const r = rig({ replies: [{ say: '', end: true }] });
    r.v.start();
    await r.say('staff dikhao');
    expect(r.v.snapshot.state).toBe('off');
  });

  it('a failed request is spoken as a failure and the conversation continues', async () => {
    const r = rig({ replies: [new Error('offline')] });
    r.v.start();
    await r.say('queue');
    expect(r.spoken[0].text).toMatch(/Could not reach FastQue/);
  });
});

describe('first-attempt recognition (#371)', () => {
  it('asks the browser for continuous capture and 5 alternatives', () => {
    const r = rig();
    r.v.start('en-IN');
    expect(r.last()).toMatchObject({ continuous: true, maxAlternatives: 5, interimResults: true, lang: 'en-IN' });
  });

  it('"Speak now" only after the browser reports audio capture started', async () => {
    const r = rig();
    r.v.start();
    expect(r.v.snapshot.ready).toBe(false);
    await r.tick(420);
    r.last().onaudiostart();
    expect(r.v.snapshot.ready).toBe(true);
    expect(r.v.snapshot.micStartMs).toBe(420);
  });

  it('a pause mid-sentence does not send half a phrase', async () => {
    const r = rig();
    r.v.start();
    r.last().onresult(r.result([[['bookings'], true]]));
    await r.tick(VOICE_LIMITS.endOfPhraseMs - 100);
    r.last().onresult(r.result([[['bookings'], true], [['khol'], false]]));
    await r.tick(VOICE_LIMITS.endOfPhraseMs); // words still arriving: wait longer
    expect(r.sent).toEqual([]);
    r.last().onresult(r.result([[['bookings'], true], [['kholo'], true]]));
    await r.tick(VOICE_LIMITS.endOfPhraseMs);
    expect(r.sent.map((s) => s.text)).toEqual(['bookings kholo']);
  });

  it('the recognizer ending right after the last words sends the phrase at once', async () => {
    const r = rig();
    r.v.start();
    r.last().onresult(r.result([[['staff dikhao'], true]]));
    r.last().onend();
    await r.flush();
    expect(r.sent.map((s) => s.text)).toEqual(['staff dikhao']);
  });

  it('alternatives and confidence are passed along with the top transcript', async () => {
    const r = rig();
    r.v.start();
    await r.say({ transcript: 'book in school', confidence: 0.41 }, ['bookings kholo', 'booking school']);
    expect(r.sent[0]).toEqual({ text: 'book in school', alternatives: ['bookings kholo', 'booking school'], confidence: 0.41 });
  });

  it('a browser that returns no alternatives or no confidence still works', async () => {
    const r = rig();
    r.v.start();
    await r.say('staff dikhao');
    expect(r.sent[0]).toEqual({ text: 'staff dikhao', alternatives: [], confidence: null });
  });

  it('a duplicate final phrase is sent once', async () => {
    const r = rig({ replies: [{ say: '' }] });
    r.v.start();
    await r.say('staff dikhao');
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    await r.say('staff dikhao'); // the browser repeating the same final within the window
    expect(r.sent).toHaveLength(1);
  });

  it('changing language while listening restarts the microphone in the new language', () => {
    const r = rig();
    r.v.start('hi-IN');
    r.v.setLang('en-IN');
    expect(r.recs).toHaveLength(2);
    expect(r.last().lang).toBe('en-IN');
    expect(r.recs[0].aborted).toBe(1);
  });

  it('readResults joins segments and builds alternatives for the last segment', () => {
    const res = [
      Object.assign([{ transcript: 'aaj ' }], { isFinal: true }),
      Object.assign([{ transcript: 'queue status', confidence: 0.8 }, { transcript: 'cue status' }, { transcript: 'queue status' }], { isFinal: true }),
    ];
    expect(readResults(res)).toEqual({ final: { text: 'aaj queue status', alternatives: ['aaj cue status'], confidence: 0.8 }, interim: '' });
  });
});

describe('spoken replies (#371)', () => {
  it('a reply that never played is shown as an error and the conversation still listens again', async () => {
    const r = rig();
    r.v.start();
    await r.say('hello');
    await r.finishSpeaking({ ok: false, reason: 'no-start' });
    expect(r.v.snapshot.speechError).toMatch(/did not start playing/);
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('a missing Hindi voice is reported, not hidden', async () => {
    const r = rig();
    r.v.start();
    await r.say('hello');
    await r.finishSpeaking({ ok: false, reason: 'no-voice-for-text' });
    expect(r.v.snapshot.speechError).toMatch(/No Hindi voice/);
  });

  it('a blocked speaker says how to unblock it', async () => {
    const r = rig();
    r.v.start();
    await r.say('hello');
    await r.finishSpeaking({ ok: false, reason: 'not-allowed' });
    expect(r.v.snapshot.speechError).toMatch(/Test speaker/);
  });

  it('a successful reply clears an earlier playback error', async () => {
    const r = rig();
    r.v.start();
    await r.say('one');
    await r.finishSpeaking({ ok: false, reason: 'engine-error' });
    await r.say('two');
    await r.finishSpeaking({ ok: true });
    expect(r.v.snapshot.speechError).toBeNull();
  });

  it('the microphone reopens only after the reply finished, never during it', async () => {
    const r = rig();
    r.v.start();
    await r.say('services dikhao');
    await r.tick(60_000); // a long reply: nothing in the engine reopens the mic while audio plays
    expect(r.recs).toHaveLength(1);
    expect(r.v.snapshot.state).toBe('replying');
    await r.finishSpeaking();
    expect(r.recs).toHaveLength(2);
  });

  it('no speaker at all (browser without speech output): text replies, conversation continues', async () => {
    const r = rig({ speaker: false });
    r.v.start();
    await r.say('queue status');
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    expect(r.v.snapshot.state).toBe('listening');
  });
});

describe('VoiceConversation network recovery', () => {
  it('a brief connection drop reconnects on its own (mic closed meanwhile), then the conversation continues', async () => {
    const r = rig({ speaker: false });
    r.v.start('hi-IN');
    r.last().onerror({ error: 'network' });
    expect(r.v.snapshot.state).toBe('paused');
    expect(r.v.snapshot.note).toMatch(/Reconnecting/);
    expect(r.recs).toHaveLength(1);
    await r.tick(VOICE_LIMITS.networkRetryMs);
    expect(r.v.snapshot.state).toBe('listening');
    expect(r.recs).toHaveLength(2);
    await r.say('queue status');
    expect(r.sent.map((s) => s.text)).toEqual(['queue status']);
  });

  it('gives up after the retry budget and asks for Resume, without a hidden microphone', async () => {
    const r = rig({ speaker: false });
    r.v.start();
    r.last().onerror({ error: 'network' });
    await r.tick(VOICE_LIMITS.networkRetryMs);
    r.last().onerror({ error: 'network' });
    await r.tick(VOICE_LIMITS.networkRetryMs * 2);
    r.last().onerror({ error: 'network' });
    expect(r.v.snapshot.state).toBe('paused');
    expect(r.v.snapshot.note).toMatch(/Press Resume/);
    const opened = r.recs.length;
    await r.tick(60_000);
    expect(r.recs).toHaveLength(opened); // nothing reopens on its own
    r.v.resume();
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('Stop during a reconnect wait cancels the reconnect', async () => {
    const r = rig({ speaker: false });
    r.v.start();
    r.last().onerror({ error: 'network' });
    r.v.end();
    await r.tick(VOICE_LIMITS.networkRetryMs * 4);
    expect(r.v.snapshot.state).toBe('off');
    expect(r.recs).toHaveLength(1);
  });

  it('a successful phrase restores the full retry budget', async () => {
    const r = rig({ speaker: false });
    r.v.start();
    r.last().onerror({ error: 'network' });
    await r.tick(VOICE_LIMITS.networkRetryMs);
    r.last().onerror({ error: 'network' });
    await r.tick(VOICE_LIMITS.networkRetryMs * 2);
    await r.say('queue status');
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    r.last().onerror({ error: 'network' });
    expect(r.v.snapshot.note).toMatch(/Reconnecting/);
  });
});
