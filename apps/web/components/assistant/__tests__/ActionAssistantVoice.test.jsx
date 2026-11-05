import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ActionAssistant, safeRoute, spokenReply } from '../ActionAssistant';
import { apiFetch, ApiError } from '../../../lib/api';

// Issue #368: hands-free voice conversation and navigation on the MAIN screen.
jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, onClick }) => <a href={href} onClick={onClick}>{children}</a> }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), prefetch: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const findText = (tree, type, text) => tree.root.findAll((n) => n.type === type && textOf(n).includes(text));
const button = (tree, text) => {
  const all = findText(tree, 'button', text);
  if (!all.length) throw new Error(`no button "${text}" in: ${textOf(tree.root).slice(0, 400)}`);
  return all[0];
};

const turn = (over) => ({ requestId: 'r', status: 'DONE', action: { id: 'staff.list', title: 'Show staff', kind: 'READ' }, message: 'ok', completedAt: '2026-11-04T10:00:00.000Z', ...over });
const NAV = (page, path) => turn({ action: { id: 'app.navigate', title: 'Open a page', kind: 'READ' }, message: `Opening ${page}.`, navigateTo: path });

let replies;
let sent;
function route(list) {
  replies = [...list];
  sent = [];
  apiFetch.mockImplementation((path, init) => {
    if (path === 'assistant/access') return Promise.resolve({ enabled: true, writes: false });
    if (path === 'assistant/capabilities') return Promise.resolve({ interpreter: 'rules', voice: { browser: true, local: false }, actions: [] });
    sent.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = replies.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}

let recs;
let spoken;
let storage;
function browser({ recognition = true, synthesis = true, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' } = {}) {
  recs = [];
  spoken = [];
  storage = {};
  class FakeRecognition {
    constructor() {
      this.aborted = 0;
      this.started = 0;
      recs.push(this);
    }
    start() { this.started += 1; }
    stop() {}
    abort() { this.aborted += 1; }
  }
  globalThis.window = {
    dispatchEvent: () => {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    navigator: { userAgent: ua, maxTouchPoints: 0 },
    localStorage: { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
    ...(recognition ? { webkitSpeechRecognition: FakeRecognition } : {}),
    ...(synthesis
      ? {
          speechSynthesis: {
            speaking: false,
            pending: false,
            getVoices: () => [{ name: 'Google हिन्दी', lang: 'hi-IN', localService: false }, { name: 'Microsoft Heera', lang: 'en-IN', localService: true }],
            addEventListener: () => {},
            speak: (u) => spoken.push(u),
            cancel: jest.fn(),
            resume: jest.fn(),
          },
        }
      : {}),
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
}

async function open(props = { salonId: 's1' }) {
  let tree;
  await act(async () => { tree = TestRenderer.create(<ActionAssistant {...props} />); });
  await act(async () => button(tree, 'Assistant').props.onClick());
  return tree;
}
async function type(tree, text) {
  const input = tree.root.findByProps({ 'aria-label': 'Message to the assistant' });
  await act(async () => input.props.onChange({ target: { value: text } }));
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
}
const lastRec = () => recs[recs.length - 1];
async function hear(text, alternatives = []) {
  await act(async () => lastRec().onresult({ results: [Object.assign([{ transcript: text }, ...alternatives.map((a) => ({ transcript: a }))], { isFinal: true })] }));
  // the phrase is complete after a short silence
  await act(async () => { jest.advanceTimersByTime(1000); });
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}
async function finishSpeaking() {
  const u = spoken[spoken.length - 1];
  await act(async () => { u.onstart?.(); u.onend(); });
  await act(async () => { jest.advanceTimersByTime(1000); });
}

beforeEach(() => {
  apiFetch.mockReset();
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  browser();
});
afterEach(() => {
  jest.useRealTimers();
  delete globalThis.window;
});

describe('navigation happens on the MAIN screen', () => {
  it('"Bookings kholo" opens the page with the router and shrinks the assistant to a small bar', async () => {
    route([NAV('Bookings', '/dashboard/salons/s1/bookings')]);
    const tree = await open();
    await type(tree, 'Bookings kholo');
    expect(mockRouter.push).toHaveBeenCalledWith('/dashboard/salons/s1/bookings');
    expect(tree.root.findAllByType('aside')).toHaveLength(0); // the drawer no longer covers the page
    const mini = tree.root.findByProps({ 'aria-label': 'FastQue Assistant (minimized)' });
    expect(textOf(mini)).toContain('Opening Bookings.');
    await act(async () => button(tree, 'Expand').props.onClick());
    expect(tree.root.findAllByType('aside')).toHaveLength(1);
  });

  it.each([
    ['another shop', '/dashboard/salons/OTHER/bookings'],
    ['an external host', '//evil.example/x'],
    ['an absolute URL', 'https://evil.example/'],
    ['an unknown area', '/dashboard/salons/s1/../../admin'],
  ])('a route to %s is never followed', async (_why, path) => {
    route([NAV('X', path)]);
    const tree = await open();
    await type(tree, 'x kholo');
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(textOf(tree.root)).toContain("I can't open that page from here.");
  });

  it('"go back" only returns along pages the assistant opened', async () => {
    route([turn({ action: { id: 'app.navigateBack', title: 'Go back', kind: 'READ' }, message: 'Going back to the previous page.' })]);
    let tree = await open();
    await type(tree, 'wapas jao');
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(textOf(tree.root)).toContain('nowhere to go back to');

    route([NAV('Staff', '/dashboard/salons/s1/staff'), turn({ action: { id: 'app.navigateBack', title: 'Go back', kind: 'READ' }, message: 'Going back.' })]);
    tree = await open();
    await type(tree, 'staff page kholo');
    await act(async () => button(tree, 'Expand').props.onClick());
    await type(tree, 'wapas jao');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('a read answer with a page offers "Open page" (same shop only) and docks when used', async () => {
    route([turn({ navigateTo: '/dashboard/salons/s1/staff' })]);
    const tree = await open();
    await type(tree, 'staff dikhao');
    const link = tree.root.findAll((n) => n.type === 'a' && textOf(n) === 'Open page');
    expect(link).toHaveLength(1);
    expect(link[0].props.href).toBe('/dashboard/salons/s1/staff');
    await act(async () => link[0].props.onClick());
    expect(tree.root.findAllByType('aside')).toHaveLength(0);
  });

  it('safeRoute', () => {
    expect(safeRoute('/dashboard/salons/s1', 's1')).toBe('/dashboard/salons/s1');
    expect(safeRoute('/dashboard/salons/s1/queue', 's1')).toBe('/dashboard/salons/s1/queue');
    expect(safeRoute('/dashboard/salons/s2/queue', 's1')).toBeNull();
    expect(safeRoute('/dashboard/salons/s1/queue?x=1', 's1')).toBeNull();
    // The Bookings period the assistant builds is the only query a shop page accepts.
    const period = '/dashboard/salons/s1/bookings?from=2026-10-31T18%3A30%3A00.000Z&to=2026-11-30T18%3A29%3A59.999Z&period=Last+month+%281+Nov%29&filter=all';
    expect(safeRoute(period, 's1')).toBe(period);
    expect(safeRoute('/dashboard/salons/s1/bookings?redirect=evil', 's1')).toBeNull();
    expect(safeRoute('/dashboard/salons/s2/bookings?from=x', 's1')).toBeNull();
    expect(safeRoute('/account/credits')).toBe('/account/credits');
    expect(safeRoute('javascript:alert(1)')).toBeNull();
  });
});

describe('hands-free voice conversation', () => {
  async function startConversation(tree) {
    await act(async () => button(tree, 'Start voice conversation').props.onClick());
    expect(textOf(tree.root)).toContain('Before you use the microphone');
    expect(textOf(tree.root)).toContain('until you press End conversation');
    expect(recs).toHaveLength(0); // nothing opens before consent
    await act(async () => button(tree, 'Allow microphone').props.onClick());
  }

  it('two consecutive spoken questions without touching the microphone, with spoken replies', async () => {
    jest.useFakeTimers();
    route([
      turn({ action: { id: 'chairs.list', title: 'Show chairs', kind: 'READ' }, message: '2 of 3 working chairs are free right now, 1 busy.' }),
      turn({ action: { id: 'queue.status', title: 'Queue', kind: 'READ' }, message: '3 people are waiting.' }),
    ]);
    const tree = await open();
    await startConversation(tree);
    expect(recs).toHaveLength(1);
    expect(lastRec()).toMatchObject({ continuous: true, maxAlternatives: 5 });
    expect(textOf(tree.root)).toContain('Starting microphone… wait'); // not yet capturing: do not speak yet
    await act(async () => lastRec().onaudiostart());
    expect(textOf(tree.root)).toContain('Listening… speak now');
    await hear('चेक करो कितनी चेयर्स अवेलेबल हैं', ['check karo kitni chairs available hain']);
    expect(sent[0].body).toMatchObject({ text: 'चेक करो कितनी चेयर्स अवेलेबल हैं', inputMode: 'voice', salonId: 's1', alternatives: ['check karo kitni chairs available hain'] });
    expect(spoken[0].text).toBe('2 of 3 working chairs are free right now, 1 busy.');
    expect(recs).toHaveLength(1); // the mic is not open while the reply is spoken
    expect(textOf(tree.root)).toContain('Speech → text');
    await finishSpeaking();
    expect(recs).toHaveLength(2); // listening again, no click
    await hear('Aaj queue mein kitne log hain?');
    expect(sent[1].body.text).toBe('Aaj queue mein kitne log hain?');
    expect(spoken[1].text).toBe('3 people are waiting.');
    // End: mic released, nothing reopens
    await act(async () => button(tree, 'End conversation').props.onClick());
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(recs).toHaveLength(2);
    expect(textOf(tree.root)).toContain('Start voice conversation');
  });

  it('voice navigation opens the page and the conversation continues in the small bar', async () => {
    jest.useFakeTimers();
    route([NAV('Services', '/dashboard/salons/s1/services'), turn({ message: 'You have 4 services.' })]);
    const tree = await open();
    await startConversation(tree);
    await hear('Services page kholo');
    expect(mockRouter.push).toHaveBeenCalledWith('/dashboard/salons/s1/services');
    const mini = () => tree.root.findByProps({ 'aria-label': 'FastQue Assistant (minimized)' });
    expect(textOf(mini())).toContain('Speaking…');
    await finishSpeaking();
    expect(textOf(mini())).toContain('Listening…');
    await hear('services kitni hain');
    expect(sent).toHaveLength(2);
    expect(textOf(mini())).toContain('End conversation');
  });

  it('writes stay off: a change request is answered as unavailable and nothing is confirmed by voice', async () => {
    jest.useFakeTimers();
    route([turn({ status: 'UNAVAILABLE', action: null, message: 'Changes are switched off for now. Nothing was changed.' })]);
    const tree = await open();
    await startConversation(tree);
    await hear('haircut ka price 150 karo');
    expect(sent.map((s) => s.path)).toEqual(['assistant/turns']);
    expect(spoken[0].text).toMatch(/switched off/);
  });

  it('a reply that needs confirmation pauses the conversation; voice never confirms', async () => {
    jest.useFakeTimers();
    route([turn({ status: 'NEEDS_CONFIRMATION', action: { id: 'services.setPrice', title: 'Price', kind: 'WRITE' }, message: 'Please confirm.', confirmation: { token: 't'.repeat(24), expiresAt: 'x' } })]);
    const tree = await open();
    await startConversation(tree);
    await hear('haircut 150 karo');
    await finishSpeaking();
    expect(textOf(tree.root)).toContain('Waiting for your decision on screen');
    expect(recs).toHaveLength(1);
    expect(sent.filter((s) => s.path === 'assistant/confirmations')).toHaveLength(0);
  });

  it('the assistant switched off for this account mid-conversation: it ends and disappears', async () => {
    jest.useFakeTimers();
    route([new ApiError('Not found', 404)]);
    const tree = await open();
    await startConversation(tree);
    await hear('staff dikhao');
    expect(tree.toJSON()).toBeNull();
    expect(lastRec().aborted).toBeGreaterThan(0);
  });

  it('Edit puts a misheard phrase in the box and pauses; nothing is sent until Send', async () => {
    jest.useFakeTimers();
    route([turn({ status: 'UNSUPPORTED', action: null, message: 'I heard "kitni chair fee hai" but didn\'t understand it.' })]);
    const tree = await open();
    await startConversation(tree);
    await hear('kitni chair fee hai');
    await finishSpeaking();
    await act(async () => tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Edit')[0].props.onClick());
    expect(tree.root.findByProps({ 'aria-label': 'Message to the assistant' }).props.value).toBe('kitni chair fee hai');
    expect(textOf(tree.root)).toContain('Paused while you edit');
    expect(sent).toHaveLength(1);
  });

  it('closing the assistant ends the conversation and releases the microphone', async () => {
    jest.useFakeTimers();
    route([]);
    const tree = await open();
    await startConversation(tree);
    await act(async () => tree.root.findByProps({ 'aria-label': 'Close assistant' }).props.onClick());
    expect(lastRec().aborted).toBeGreaterThan(0);
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(recs).toHaveLength(1);
  });

  it('unmounting (leaving the shop, signing out) releases the microphone', async () => {
    route([]);
    const tree = await open();
    await startConversation(tree);
    await act(async () => tree.unmount());
    expect(recs[0].aborted).toBeGreaterThan(0);
  });

  it('a browser without speech recognition says so and keeps typing', async () => {
    browser({ recognition: false });
    route([]);
    const tree = await open();
    expect(findText(tree, 'button', 'Start voice conversation')).toHaveLength(0);
    expect(textOf(tree.root)).toContain('no speech recognition');
    expect(tree.root.findByProps({ 'aria-label': 'Message to the assistant' })).toBeTruthy();
  });

  it('iPhone/iPad: honest push-to-talk fallback instead of claiming hands-free', async () => {
    browser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' });
    route([]);
    const tree = await open();
    expect(findText(tree, 'button', 'Start voice conversation')).toHaveLength(0);
    expect(textOf(tree.root)).toContain('need a tap for each question');
    expect(tree.root.findByProps({ 'aria-label': 'Speak one question' })).toBeTruthy();
  });

  it('spokenReply keeps long answers short', () => {
    expect(spokenReply(turn({ message: 'a'.repeat(400) }))).toMatch(/The rest is on screen\.$/);
  });
});

describe('spoken replies and voice tools (#371)', () => {
  it('Test speaker plays a sample with the Hindi voice and says which voice played', async () => {
    route([]);
    const tree = await open();
    await act(async () => button(tree, 'Voice settings').props.onClick());
    expect(textOf(tree.root)).toContain('Using: Google हिन्दी (hi-IN)');
    await act(async () => button(tree, 'Test speaker (Hindi)').props.onClick());
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
    expect(spoken[0].text).toMatch(/Namaste/);
    await act(async () => { spoken[0].onstart(); spoken[0].onend(); });
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
    expect(textOf(tree.root)).toContain('Played with Google हिन्दी (hi-IN)');
  });

  it('no Hindi voice installed: the settings say so instead of pretending', async () => {
    route([]);
    globalThis.window.speechSynthesis.getVoices = () => [{ name: 'Microsoft David', lang: 'en-US', localService: true }];
    const tree = await open();
    await act(async () => button(tree, 'Voice settings').props.onClick());
    expect(textOf(tree.root)).toContain('No Hindi voice is installed in this browser');
  });

  it('push-to-talk: a spoken question gets a spoken answer by default; a typed one does not', async () => {
    jest.useFakeTimers();
    route([turn({ message: 'You have 4 services.' }), turn({ message: 'Typed answer.' })]);
    storage['fastque.assistant.voiceConsent.v1'] = JSON.stringify(['browser']);
    const tree = await open();
    await act(async () => tree.root.findByProps({ 'aria-label': 'Speak one question' }).props.onClick());
    await act(async () => lastRec().onresult({ results: [Object.assign([{ transcript: 'services kitni hain' }], { isFinal: true })] }));
    for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
    expect(spoken.map((u) => u.text)).toEqual(['You have 4 services.']);
    await type(tree, 'staff dikhao');
    expect(spoken).toHaveLength(1);
  });

  it('a reply that did not play is shown with a Test speaker link (no silent failure)', async () => {
    jest.useFakeTimers();
    route([turn({ message: 'Queue mein 2 log hain.' })]);
    const tree = await open();
    await act(async () => button(tree, 'Start voice conversation').props.onClick());
    await act(async () => button(tree, 'Allow microphone').props.onClick());
    await hear('queue status');
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => { spoken[0].onend(); }); // "end" with no "start": nothing was heard
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(textOf(tree.root)).toContain('did not start playing');
    expect(findText(tree, 'button', 'Test speaker').length).toBeGreaterThan(0);
    expect(recs).toHaveLength(2); // still listening for the next question
  });

  it('when the server used a speech alternative, the card says what was understood', async () => {
    route([turn({ message: 'Opening Bookings.', understoodAs: 'bookings kholo' })]);
    const tree = await open();
    await type(tree, 'book in school');
    expect(textOf(tree.root)).toContain('Understood as: “bookings kholo”');
  });

  it('voice accuracy check: says each phrase once, uses only the dry-run endpoint, shows a first-try score', async () => {
    route([
      { action: 'app.help', kind: 'READ', usedText: 'What can you do?', usedAlternative: false, topAction: 'app.help' },
      { action: 'app.help', kind: 'READ', usedText: 'how can you help me', usedAlternative: true, topAction: null },
    ]);
    const tree = await open();
    await act(async () => button(tree, 'Check voice accuracy').props.onClick());
    expect(textOf(tree.root)).toContain('“What can you do?”');
    await act(async () => button(tree, 'Speak').props.onClick());
    expect(lastRec()).toMatchObject({ continuous: false, maxAlternatives: 5 });
    await act(async () => lastRec().onresult({ results: [Object.assign([{ transcript: 'what can you do' }], { isFinal: true })] }));
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => button(tree, 'Speak').props.onClick());
    await act(async () => lastRec().onresult({ results: [Object.assign([{ transcript: 'how can you yelp me' }, { transcript: 'how can you help me' }], { isFinal: true })] }));
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
    expect(sent.map((s) => s.path)).toEqual(['assistant/interpretations', 'assistant/interpretations']);
    expect(sent[1].body).toEqual({ text: 'how can you yelp me', alternatives: ['how can you help me'], surface: 'shop' });
    expect(textOf(tree.root)).toContain('heard: how can you yelp me (alternative used)');
  });
});

describe('surface scoping (#371 review)', () => {
  it('customers keep voice settings but do not see the shop-owner accuracy check', async () => {
    route([]);
    const tree = await open({ surface: 'customer' });
    expect(findText(tree, 'button', 'Voice settings').length).toBe(1);
    expect(findText(tree, 'button', 'Check voice accuracy')).toHaveLength(0);
  });
});
