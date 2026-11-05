import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ActionAssistant } from '../ActionAssistant';
import { apiFetch } from '../../../lib/api';
import { speechErrorText } from '../../../lib/use-speech';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), prefetch: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const byText = (tree, type, text) => tree.root.find((n) => n.type === type && textOf(n) === text);

const preview = {
  requestId: 'r1',
  status: 'NEEDS_CONFIRMATION',
  action: { id: 'services.setPrice', title: 'Change a service price', kind: 'WRITE' },
  message: 'Please check and confirm. Nothing has changed yet.',
  preview: { rows: [{ label: 'Haircut price', before: '₹200', after: '₹150' }] },
  confirmation: { token: 'sealed-token-1234567890', expiresAt: '2026-11-03T10:02:00.000Z' },
  completedAt: '2026-11-03T10:00:00.000Z',
};
const applied = {
  ...preview,
  requestId: 'r2',
  status: 'DONE',
  message: 'Haircut now costs ₹150.',
  confirmation: undefined,
  result: { summary: 'Haircut now costs ₹150.', changed: [{ resource: 'services', id: 'svc-1' }] },
  refresh: ['services', 'overview'],
  navigateTo: '/dashboard/salons/s1/services',
};

/** apiFetch by URL: capabilities answer from `voice`; turns/confirmations take the next queued reply. */
function route(replies, voice = { browser: true, local: false }) {
  const queue = [...replies];
  apiFetch.mockImplementation((path) => {
    if (path === 'assistant/access') return Promise.resolve({ enabled: true, writes: true });
    if (path === 'assistant/capabilities') return Promise.resolve({ interpreter: 'rules', voice, actions: [] });
    const next = queue.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}
const callsTo = (path) => apiFetch.mock.calls.filter(([p]) => p === path);

describe('ActionAssistant release gate', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });
  for (const [why, answer] of [
    ['the server says off', () => Promise.resolve({ enabled: false, writes: false })],
    ['the access check fails', () => Promise.reject(new Error('404'))],
    ['the answer is malformed', () => Promise.resolve({ enabled: 'true' })],
  ]) {
    it(`renders nothing when ${why}`, async () => {
      apiFetch.mockImplementation(answer);
      let tree;
      await act(async () => { tree = TestRenderer.create(<ActionAssistant salonId="s1" />); });
      expect(tree.toJSON()).toBeNull();
      expect(apiFetch.mock.calls.map(([p]) => p)).toEqual(['assistant/access']);
    });
  }
});

describe('ActionAssistant drawer', () => {
  let events;
  let storage;
  beforeEach(() => {
    apiFetch.mockReset();
    events = [];
    storage = {};
    globalThis.window = {
      dispatchEvent: (e) => events.push(e),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      localStorage: {
        getItem: (k) => storage[k] ?? null,
        setItem: (k, v) => {
          storage[k] = v;
        },
      },
    };
    globalThis.CustomEvent = class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  async function open(props = { salonId: 's1' }) {
    let tree;
    await act(async () => { tree = TestRenderer.create(<ActionAssistant {...props} />); });
    await act(async () => byText(tree, 'button', '✦ Assistant').props.onClick());
    return tree;
  }
  async function say(tree, text) {
    const input = tree.root.findByProps({ 'aria-label': 'Message to the assistant' });
    await act(async () => input.props.onChange({ target: { value: text } }));
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  }

  it('previews first, saves only on Confirm, then tells open pages to reload', async () => {
    route([preview, applied]);
    const tree = await open();
    await say(tree, 'Haircut ₹200 se ₹150 karo');
    expect(JSON.parse(callsTo('assistant/turns')[0][1].body)).toEqual({
      text: 'Haircut ₹200 se ₹150 karo',
      inputMode: 'text',
      surface: 'shop',
      salonId: 's1',
    });
    const card = tree.root.find((n) => n.props['data-status'] === 'NEEDS_CONFIRMATION');
    expect(textOf(card)).toContain('₹200');
    expect(textOf(card)).toContain('₹150');
    expect(events).toHaveLength(0);

    await act(async () => byText(tree, 'button', 'Confirm').props.onClick());
    expect(JSON.parse(callsTo('assistant/confirmations')[0][1].body)).toEqual({ token: 'sealed-token-1234567890', decision: 'confirm' });
    expect(textOf(tree.root.find((n) => n.props['data-status'] === 'DONE'))).toContain('Saved by FastQue');
    expect(events.map((e) => e.detail)).toEqual([['services', 'overview']]);
    expect(tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Confirm')).toHaveLength(0);
    expect(textOf(tree.root.find((n) => n.props['data-status'] === 'NEEDS_CONFIRMATION'))).toContain('Decision sent');
  });

  it('multi-turn: a short spoken/typed answer to "Which staff member?" sends the chosen option; a new request does not', async () => {
    const question = {
      requestId: 'q1',
      status: 'NEEDS_INPUT',
      action: { id: 'staff.setStatus', title: 'Activate or deactivate staff', kind: 'WRITE' },
      message: 'Which staff member?',
      options: [
        { label: 'Ramesh Kumar', text: 'Deactivate staff Ramesh Kumar' },
        { label: 'Suresh', text: 'Deactivate staff Suresh' },
      ],
      completedAt: '2026-11-05T10:00:00.000Z',
    };
    route([question, preview, question, preview]);
    const tree = await open();
    await say(tree, 'staff ko inactive karo');
    await say(tree, 'doosra wala');
    expect(JSON.parse(callsTo('assistant/turns')[1][1].body).text).toBe('Deactivate staff Suresh');
    // The user's own words stay in the transcript.
    expect(textOf(tree.root)).toContain('doosra wala');
    // After an answer the question is closed: the next short phrase goes as typed.
    await say(tree, 'staff ko inactive karo');
    await say(tree, 'staff list dikhao');
    expect(JSON.parse(callsTo('assistant/turns')[3][1].body).text).toBe('staff list dikhao');
  });

  it('keyboard: focus moves into the message box, Escape closes the notice then the drawer, focus returns', async () => {
    route([], { browser: true, local: false });
    globalThis.window.webkitSpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    };
    const focused = [];
    let tree;
    await act(async () => {
      tree = TestRenderer.create(<ActionAssistant salonId="s1" />, {
        createNodeMock: (el) => ({ focus: () => focused.push(el.props['aria-label'] ?? el.type), scrollIntoView() {} }),
      });
    });
    const fab = () => tree.root.findByProps({ 'aria-label': 'Open FastQue Assistant' });
    expect(fab().props['aria-expanded']).toBe(false);
    await act(async () => fab().props.onClick());
    expect(focused).toEqual(['Message to the assistant']);
    const drawer = () => tree.root.find((n) => n.props.role === 'complementary');
    expect(drawer().props['aria-labelledby']).toBe('fastque-assistant-title');

    // Open the microphone notice, then Escape closes only the notice.
    await act(async () => tree.root.findByProps({ 'aria-label': 'Speak one question' }).props.onClick());
    expect(textOf(tree.root)).toContain('Before you use the microphone');
    const esc = { key: 'Escape', stopPropagation() {} };
    await act(async () => drawer().props.onKeyDown(esc));
    expect(textOf(tree.root)).not.toContain('Before you use the microphone');
    expect(tree.root.findAll((n) => n.props.role === 'complementary')).toHaveLength(1);

    // A second Escape closes the drawer and returns focus to the Assistant button.
    await act(async () => drawer().props.onKeyDown(esc));
    expect(tree.root.findAll((n) => n.props.role === 'complementary')).toHaveLength(0);
    expect(focused.at(-1)).toBe('Open FastQue Assistant');
    // Other keys do nothing.
    await act(async () => fab().props.onClick());
    await act(async () => drawer().props.onKeyDown({ key: 'a', stopPropagation() {} }));
    expect(tree.root.findAll((n) => n.props.role === 'complementary')).toHaveLength(1);
  });

  it('sends the customer surface and shows customer examples on customer screens', async () => {
    route([{ ...applied, refresh: ['myBookings'], status: 'DONE', action: null, message: 'You have no upcoming appointments.' }]);
    const tree = await open({ surface: 'customer' });
    expect(textOf(tree.root)).toContain('Meri bookings dikhao');
    expect(textOf(tree.root)).not.toContain('Sunday band rakho');
    await say(tree, 'meri bookings dikhao');
    expect(JSON.parse(callsTo('assistant/turns')[0][1].body)).toEqual({ text: 'meri bookings dikhao', inputMode: 'text', surface: 'customer' });
  });

  it('never shows success when the server refuses or is unreachable', async () => {
    route([new Error('offline')]);
    const tree = await open();
    await say(tree, 'Facial service hata do');
    expect(textOf(tree.root.find((n) => n.props['data-status'] === 'FAILED'))).toContain('Nothing was changed');
    expect(events).toHaveLength(0);
  });

  it('shows a denial plainly', async () => {
    route([{ ...preview, status: 'DENIED', confirmation: undefined, preview: undefined, message: 'Your account is not allowed to do that here. Nothing was changed.' }]);
    const tree = await open();
    await say(tree, 'Facial service hata do');
    expect(textOf(tree.root.find((n) => n.props['data-status'] === 'DENIED'))).toContain('Not allowed');
  });

  it('works without voice: no microphone button when the browser has none and no private server', async () => {
    route([]);
    const tree = await open();
    expect(tree.root.findAll((n) => n.props['aria-label'] === 'Speak')).toHaveLength(0);
    expect(tree.root.findByProps({ 'aria-label': 'Message to the assistant' })).toBeTruthy();
  });

  describe('microphone consent', () => {
    let started;
    beforeEach(() => {
      started = [];
      class FakeRecognition {
        start() {
          started.push(this.lang);
        }
        stop() {}
        abort() {}
      }
      globalThis.window.webkitSpeechRecognition = FakeRecognition;
    });

    it('explains that the browser may send audio to Google and opens the mic only after Allow', async () => {
      route([]);
      const tree = await open();
      await act(async () => tree.root.findByProps({ 'aria-label': 'Speak one question' }).props.onClick());
      expect(started).toEqual([]);
      expect(textOf(tree.root)).toContain('sent to Google');

      await act(async () => byText(tree, 'button', 'Not now').props.onClick());
      expect(started).toEqual([]);
      expect(textOf(tree.root)).not.toContain('sent to Google');

      await act(async () => tree.root.findByProps({ 'aria-label': 'Speak one question' }).props.onClick());
      await act(async () => byText(tree, 'button', 'Allow microphone').props.onClick());
      expect(started).toEqual(['hi-IN']);
      expect(JSON.parse(storage['fastque.assistant.voiceConsent.v1'])).toEqual(['browser']);
    });

    it('does not ask again once this person has agreed', async () => {
      storage['fastque.assistant.voiceConsent.v1'] = JSON.stringify(['browser']);
      route([]);
      const tree = await open();
      await act(async () => tree.root.findByProps({ 'aria-label': 'Speak one question' }).props.onClick());
      expect(started).toEqual(['hi-IN']);
      expect(textOf(tree.root)).not.toContain('Before you use the microphone');
    });

    it('prefers the private FastQue server when it is set up, with its own notice', async () => {
      route([], { browser: true, local: true });
      const tree = await open();
      const mic = tree.root.findByProps({ 'aria-label': 'Speak one question' });
      expect(mic.props.title).toBe('Private voice (FastQue server)');
      await act(async () => mic.props.onClick());
      expect(textOf(tree.root)).toContain("FastQue's own private server");
      expect(textOf(tree.root)).not.toContain('sent to Google');
      expect(started).toEqual([]);
    });
  });

  it('explains voice failures in plain words', () => {
    expect(speechErrorText('not-allowed')).toMatch(/permission/);
    expect(speechErrorText('no-speech')).toMatch(/didn't hear/);
    expect(speechErrorText('anything')).toMatch(/type instead/);
  });
});

describe('mandatory confirmation UI (#372)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = { dispatchEvent: () => {}, addEventListener: jest.fn(), removeEventListener: jest.fn(), localStorage: { getItem: () => null, setItem: () => {} } };
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  });
  afterEach(() => { delete globalThis.window; });
  async function openAndAsk(reply) {
    route([reply]);
    let tree;
    await act(async () => { tree = TestRenderer.create(<ActionAssistant salonId="s1" />); });
    await act(async () => byText(tree, 'button', '✦ Assistant').props.onClick());
    const input = tree.root.findByProps({ 'aria-label': 'Message to the assistant' });
    await act(async () => input.props.onChange({ target: { value: 'Chair 2 band karo' } }));
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    return tree;
  }
  const question = 'Kya aap sach mein Chair 2 ko hatana (Off) chahte hain?';
  const highRisk = {
    ...preview,
    action: { id: 'chairs.setStatus', title: 'Change chair status', kind: 'WRITE' },
    message: `${question} Neeche Before → After dekhiye aur screen par Confirm ya Cancel dabaiye. Abhi kuch bhi change nahi hua hai.`,
    preview: { rows: [{ label: 'Chair 2', before: 'In use', after: 'Off' }], question, risk: 'high', warning: 'Shop ki available chairs kam ho jayengi. (not a permanent delete)' },
  };

  it('shows the plain question, the Before → After and the consequence; Confirm stays off until "I understand" is ticked', async () => {
    const tree = await openAndAsk(highRisk);
    expect(textOf(tree.root)).toContain(question);
    expect(textOf(tree.root)).toContain('not a permanent delete');
    const confirm = () => byText(tree, 'button', 'Confirm');
    expect(confirm().props.disabled).toBe(true);
    const ackBox = tree.root.find((n) => n.type === 'label' && textOf(n).includes('samajhta')).findByType('input');
    await act(async () => ackBox.props.onChange({ target: { checked: true } }));
    expect(confirm().props.disabled).toBe(false);
    route([{ ...applied, message: 'Chair 2 is now off.' }]);
    await act(async () => confirm().props.onClick());
    const body = JSON.parse(callsTo('assistant/confirmations')[0][1].body);
    expect(body).toEqual({ token: highRisk.confirmation.token, decision: 'confirm', acknowledged: true });
  });

  it('a normal (not high-risk) change confirms without the extra box and sends no acknowledgement', async () => {
    const tree = await openAndAsk({ ...preview, preview: { ...preview.preview, question: 'Kya aap sach mein ...?' } });
    expect(tree.root.findAll((n) => n.type === 'label' && textOf(n).includes('samajhta'))).toHaveLength(0);
    route([applied]);
    await act(async () => byText(tree, 'button', 'Confirm').props.onClick());
    expect(JSON.parse(callsTo('assistant/confirmations')[0][1].body)).toEqual({ token: preview.confirmation.token, decision: 'confirm' });
  });

  it('Cancel says nothing was changed', async () => {
    const tree = await openAndAsk(highRisk);
    route([{ requestId: 'c', status: 'CANCELLED', action: highRisk.action, message: 'Cancelled, kuch bhi change nahi hua. (Nothing was changed.)', completedAt: highRisk.completedAt }]);
    await act(async () => byText(tree, 'button', 'Cancel').props.onClick());
    expect(textOf(tree.root)).toContain('Cancelled, kuch bhi change nahi hua.');
  });

  it('if the server asks for the acknowledgement, the same preview stays usable', async () => {
    const tree = await openAndAsk({ ...highRisk, preview: { ...highRisk.preview, risk: undefined } });
    route([{ requestId: 'a', status: 'NEEDS_CONFIRMATION', action: highRisk.action, message: 'Pehle box tick kijiye.', completedAt: highRisk.completedAt }]);
    await act(async () => byText(tree, 'button', 'Confirm').props.onClick());
    expect(tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Confirm')).toHaveLength(1);
  });
});
