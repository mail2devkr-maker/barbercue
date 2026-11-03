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

describe('ActionAssistant drawer', () => {
  let events;
  beforeEach(() => {
    apiFetch.mockReset();
    events = [];
    globalThis.window = {
      dispatchEvent: (e) => events.push(e),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
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

  async function openAndSay(text) {
    let tree;
    await act(async () => { tree = TestRenderer.create(<ActionAssistant salonId="s1" />); });
    await act(async () => byText(tree, 'button', '✦ Assistant').props.onClick());
    const input = tree.root.findByProps({ 'aria-label': 'Message to the assistant' });
    await act(async () => input.props.onChange({ target: { value: text } }));
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    return tree;
  }

  it('previews first, saves only on Confirm, then tells open pages to reload', async () => {
    apiFetch.mockResolvedValueOnce(preview);
    const tree = await openAndSay('Haircut ₹200 se ₹150 karo');
    expect(apiFetch).toHaveBeenCalledWith('assistant/turns', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ text: 'Haircut ₹200 se ₹150 karo', inputMode: 'text', salonId: 's1' });
    const card = tree.root.find((n) => n.props['data-status'] === 'NEEDS_CONFIRMATION');
    expect(textOf(card)).toContain('₹200');
    expect(textOf(card)).toContain('₹150');
    expect(events).toHaveLength(0);

    apiFetch.mockResolvedValueOnce(applied);
    await act(async () => byText(tree, 'button', 'Confirm').props.onClick());
    expect(apiFetch).toHaveBeenLastCalledWith('assistant/confirmations', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ token: 'sealed-token-1234567890', decision: 'confirm' });
    const done = tree.root.find((n) => n.props['data-status'] === 'DONE');
    expect(textOf(done)).toContain('Saved by FastQue');
    expect(events.map((e) => e.detail)).toEqual([['services', 'overview']]);
    expect(tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Confirm')).toHaveLength(0);
    expect(textOf(tree.root.find((n) => n.props['data-status'] === 'NEEDS_CONFIRMATION'))).toContain('Decision sent');
  });

  it('never shows success when the server refuses or is unreachable', async () => {
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    const tree = await openAndSay('Facial service hata do');
    const card = tree.root.find((n) => n.props['data-status'] === 'FAILED');
    expect(textOf(card)).toContain('Nothing was changed');
    expect(events).toHaveLength(0);
  });

  it('shows a denial plainly', async () => {
    apiFetch.mockResolvedValueOnce({ ...preview, status: 'DENIED', confirmation: undefined, preview: undefined, message: 'Your account is not allowed to do that here. Nothing was changed.' });
    const tree = await openAndSay('Facial service hata do');
    expect(textOf(tree.root.find((n) => n.props['data-status'] === 'DENIED'))).toContain('Not allowed');
  });

  it('works without voice: no microphone button when the browser has none', async () => {
    let tree;
    await act(async () => { tree = TestRenderer.create(<ActionAssistant salonId="s1" />); });
    await act(async () => byText(tree, 'button', '✦ Assistant').props.onClick());
    expect(tree.root.findAll((n) => n.props['aria-label'] === 'Speak')).toHaveLength(0);
    expect(tree.root.findByProps({ 'aria-label': 'Message to the assistant' })).toBeTruthy();
  });

  it('explains voice failures in plain words', () => {
    expect(speechErrorText('not-allowed')).toMatch(/permission/);
    expect(speechErrorText('no-speech')).toMatch(/didn't hear/);
    expect(speechErrorText('anything')).toMatch(/type instead/);
  });
});
