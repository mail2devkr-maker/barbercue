import { VoiceConversation, VOICE_LIMITS } from '../voice-conversation';

// Fakes: a recognizer we drive by hand, a speaker we finish by hand, and a manual clock.
function rig({ speaker = true, replies = [] } = {}) {
  const recs = [];
  const timers = [];
  let now = 0;
  const spoken = [];
  const sent = [];
  const queue = [...replies];
  const speak = { pending: null };
  const deps = {
    createRecognizer: () => {
      const r = {
        lang: '', interimResults: false, continuous: true, maxAlternatives: 0,
        started: 0, aborted: 0,
        start() { this.started += 1; }, stop() {}, abort() { this.aborted += 1; },
        onresult: null, onerror: null, onend: null,
      };
      recs.push(r);
      return r;
    },
    speaker: speaker ? {
      speak: (text, lang, done) => { spoken.push({ text, lang }); speak.pending = done; return true; },
      cancel: () => { speak.cancelled = (speak.cancelled ?? 0) + 1; },
    } : null,
    send: (text) => { sent.push(text); const r = queue.shift() ?? { say: `ok: ${text}` }; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); },
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { t.live = false; },
    now: () => now,
  };
  const v = new VoiceConversation(deps);
  const states = [];
  v.subscribe((s) => states.push(s.state));
  const last = () => recs[recs.length - 1];
  const say = (text, final = true) => last().onresult({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
  const tick = async (ms = 0) => {
    now += ms;
    for (const t of timers.filter((x) => x.live && x.at <= now)) { t.live = false; t.fn(); }
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  };
  const flush = () => tick(0);
  const finishSpeaking = async () => { const d = speak.pending; speak.pending = null; d?.(); await flush(); };
  return { v, recs, last, say, tick, flush, finishSpeaking, spoken, sent, states, speak, timers };
}

describe('VoiceConversation', () => {
  it('two consecutive turns without pressing the microphone again', async () => {
    const r = rig({ replies: [{ say: 'Teen chairs free hain.' }, { say: 'Queue mein 2 log hain.' }] });
    r.v.start('hi-IN');
    expect(r.v.snapshot.state).toBe('listening');
    expect(r.last().continuous).toBe(false);
    expect(r.last().lang).toBe('hi-IN');
    r.say('चेक करो कितनी चेयर्स अवेलेबल हैं');
    expect(r.v.snapshot.state).toBe('understanding');
    expect(r.recs[0].aborted).toBe(1); // mic closed before the request
    await r.flush();
    expect(r.v.snapshot.state).toBe('replying');
    expect(r.spoken[0].text).toBe('Teen chairs free hain.');
    expect(r.recs).toHaveLength(1); // mic stays closed while speaking (no echo)
    await r.finishSpeaking();
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    expect(r.v.snapshot.state).toBe('listening');
    expect(r.recs).toHaveLength(2);
    r.say('Aaj queue mein kitne log hain?');
    await r.flush();
    await r.finishSpeaking();
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    expect(r.sent).toEqual(['चेक करो कितनी चेयर्स अवेलेबल हैं', 'Aaj queue mein kitne log hain?']);
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('interim words are shown as a live caption and are not sent', async () => {
    const r = rig();
    r.v.start();
    r.say('kitni cha', false);
    expect(r.v.snapshot.interim).toBe('kitni cha');
    expect(r.sent).toEqual([]);
  });

  it('a duplicate final phrase is sent once', async () => {
    const r = rig();
    r.v.start();
    r.say('staff dikhao');
    const first = r.recs[0];
    first.onresult?.({ results: [Object.assign([{ transcript: 'staff dikhao' }], { isFinal: true })] }); // handlers detached
    await r.flush();
    expect(r.sent).toEqual(['staff dikhao']);
  });

  it('Stop during a reply cancels speech, ignores the late reply, and leaves no microphone open', async () => {
    let resolve;
    const r = rig();
    r.v.start();
    r.say('bookings dikhao');
    r.v.end();
    expect(r.v.snapshot.state).toBe('off');
    await r.flush();
    expect(r.spoken).toEqual([]); // the reply that arrived after Stop is not spoken
    expect(r.recs).toHaveLength(1);
    await r.tick(10_000);
    expect(r.recs).toHaveLength(1); // nothing reopened the mic
    void resolve;
  });

  it('interrupt() stops speaking and listens immediately', async () => {
    const r = rig();
    r.v.start();
    r.say('services dikhao');
    await r.flush();
    expect(r.v.snapshot.state).toBe('replying');
    r.v.interrupt();
    expect(r.speak.cancelled).toBeGreaterThan(0);
    expect(r.v.snapshot.state).toBe('listening');
    await r.finishSpeaking(); // a late "end" from the cancelled utterance changes nothing
    expect(r.recs).toHaveLength(2);
  });

  it('muted: replies are not spoken and listening resumes', async () => {
    const r = rig();
    r.v.setMuted(true);
    r.v.start();
    r.say('staff dikhao');
    await r.flush();
    expect(r.spoken).toEqual([]);
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('a browser without speech output still converses (text replies)', async () => {
    const r = rig({ speaker: false });
    r.v.start();
    r.say('queue status');
    await r.flush();
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('a speaker that never reports the end does not hang the conversation', async () => {
    const r = rig();
    r.v.start();
    r.say('hello');
    await r.flush();
    expect(r.v.snapshot.state).toBe('replying');
    await r.tick(30_000);
    await r.tick(VOICE_LIMITS.afterSpeechDelayMs);
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('the recognizer ending on its own is restarted; repeated silence pauses', async () => {
    const r = rig();
    r.v.start();
    for (let i = 1; i < VOICE_LIMITS.silentRestarts; i += 1) {
      r.last().onerror({ error: 'no-speech' });
      r.last().onend();
      await r.tick(VOICE_LIMITS.restartDelayMs);
      expect(r.v.snapshot.state).toBe('listening');
    }
    expect(r.recs).toHaveLength(VOICE_LIMITS.silentRestarts);
    r.last().onend();
    expect(r.v.snapshot.state).toBe('paused');
    await r.tick(5_000);
    expect(r.recs).toHaveLength(VOICE_LIMITS.silentRestarts); // no hidden restart while paused
    r.v.resume();
    expect(r.v.snapshot.state).toBe('listening');
  });

  it('idle limit pauses even when the recognizer keeps restarting', async () => {
    const r = rig();
    r.v.start();
    await r.tick(VOICE_LIMITS.idleMs);
    r.last().onend();
    expect(r.v.snapshot.state).toBe('paused');
  });

  it('microphone permission denied: error, mic released, no retry loop', async () => {
    const r = rig();
    r.v.start();
    r.last().onerror({ error: 'not-allowed' });
    expect(r.v.snapshot.state).toBe('error');
    expect(r.v.snapshot.note).toMatch(/permission/);
    expect(r.recs[0].aborted).toBe(1);
    r.recs[0].onend?.();
    await r.tick(5_000);
    expect(r.recs).toHaveLength(1);
  });

  it('network error pauses with an explanation', async () => {
    const r = rig();
    r.v.start();
    r.last().onerror({ error: 'network' });
    expect(r.v.snapshot.state).toBe('paused');
    expect(r.v.snapshot.note).toMatch(/internet/);
  });

  it('pause() (tab hidden) releases the mic; resume() reopens it', async () => {
    const r = rig();
    r.v.start();
    r.v.pause('Paused while the tab is hidden.');
    expect(r.recs[0].aborted).toBe(1);
    expect(r.v.snapshot.state).toBe('paused');
    r.v.resume();
    expect(r.recs).toHaveLength(2);
  });

  it('a confirmation is never given by voice: the conversation holds for an on-screen decision', async () => {
    const r = rig({ replies: [{ say: 'Please confirm on screen.', hold: true }] });
    r.v.start();
    r.say('haircut 150 karo');
    await r.flush();
    await r.finishSpeaking();
    expect(r.v.snapshot.state).toBe('paused');
    expect(r.sent).toEqual(['haircut 150 karo']);
  });

  it('assistant switched off for the account (404) ends the conversation', async () => {
    const r = rig({ replies: [{ say: '', end: true }] });
    r.v.start();
    r.say('staff dikhao');
    await r.flush();
    expect(r.v.snapshot.state).toBe('off');
    expect(r.v.snapshot.note).toMatch(/not available/);
  });

  it('a failed request is spoken as a failure and the conversation continues', async () => {
    const r = rig({ replies: [new Error('offline')] });
    r.v.start();
    r.say('queue');
    await r.flush();
    expect(r.spoken[0].text).toMatch(/Could not reach FastQue/);
  });

  it('a browser without recognition reports an error instead of pretending', () => {
    const r = rig();
    const v = new VoiceConversation({ ...r.v.deps, createRecognizer: () => null, speaker: null, send: async () => ({ say: '' }), setTimer: () => 0, clearTimer: () => {}, now: () => 0 });
    v.start();
    expect(v.snapshot.state).toBe('error');
  });

  it('a restart storm pauses instead of spinning', async () => {
    const r = rig();
    r.v.start();
    // sessions that "heard" something partial but ended without a final keep silentSessions at 0
    for (let i = 0; i <= VOICE_LIMITS.restartBurst; i += 1) {
      r.say('aa', false);
      r.v['heardThisSession'] = true;
      r.last().onend();
      if (r.v.snapshot.state !== 'listening' && r.v.snapshot.state !== 'paused') break;
      await r.tick(VOICE_LIMITS.restartDelayMs);
    }
    expect(r.v.snapshot.state).toBe('paused');
  });
});
