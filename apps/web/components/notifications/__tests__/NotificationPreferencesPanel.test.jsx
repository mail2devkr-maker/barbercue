import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ALL_NOTIFICATION_CATEGORIES, uiStringsFor } from '@barbercue/shared';
import { NotificationPreferencesPanel } from '../NotificationPreferencesPanel';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/auth-context', () => ({ useAuth: jest.fn() }));

const t = uiStringsFor('EN');
const CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP'];

// A stand-in for the backend: stored rows record only what a user CHANGED; everything else is the
// default (ON) - the contract the real NotificationsService keeps.
let stored;
let failNextPut;
const dto = () => ({
  categories: ALL_NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    channels: CHANNELS.map((channel) => ({
      channel,
      enabled: category === 'ARRIVAL_ALERTS' && channel === 'PUSH' ? true : (stored.get(`${category}:${channel}`) ?? true),
      available: channel === 'IN_APP' || channel === 'PUSH',
      // The critical arrival prompt is mandatory: always ON and marked required by the server.
      ...(category === 'ARRIVAL_ALERTS' && channel === 'PUSH' ? { required: true } : {}),
    })),
  })),
});

let tree;
const checkboxes = () => tree.root.findAll((n) => n.type === 'input' && n.props.type === 'checkbox');
const checkbox = (category, channel) =>
  checkboxes().find((c) => c.props['data-testid'] === `pref-${category}:${channel}`);
const text = () => JSON.stringify(tree.toJSON());
const putCalls = () => apiFetch.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(init.body));
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
async function mount() {
  await act(async () => {
    tree = TestRenderer.create(<NotificationPreferencesPanel />);
  });
  await flush();
  await flush();
}
async function unmount() {
  await act(async () => tree.unmount());
  tree = undefined;
}
const asOwner = () => useAuth.mockReturnValue({ user: { roles: ['SALON_OWNER'], preferredLanguage: 'EN' } });
const asCustomer = () => useAuth.mockReturnValue({ user: { roles: ['CUSTOMER'], preferredLanguage: 'EN' } });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  stored = new Map();
  failNextPut = false;
  asOwner();
  apiFetch.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') {
      if (failNextPut) {
        failNextPut = false;
        throw new Error('offline');
      }
      const { category, channel, enabled } = JSON.parse(init.body);
      stored.set(`${category}:${channel}`, enabled);
    }
    return dto();
  });
});
afterEach(async () => {
  if (tree) await unmount();
});

it('shows every category ON for an owner who never configured anything (default ON)', async () => {
  await mount();
  // push + in-app each, except the mandatory arrival push which has no checkbox
  expect(checkboxes()).toHaveLength(ALL_NOTIFICATION_CATEGORIES.length * 2 - 1);
  for (const c of checkboxes()) expect(c.props.checked).toBe(true);
});

it('lists the four operational categories, with Offers as its own separate section', async () => {
  await mount();
  for (const title of [
    t.notificationCategoryBookingTitle,
    t.notificationCategoryQueueTitle,
    t.notificationCategoryArrivalTitle,
    t.notificationCategoryRemindersTitle,
    t.notificationCategoryPromoTitle,
  ]) {
    expect(text()).toContain(title);
  }
  expect(text().indexOf(t.notificationSettingsPromoHeading)).toBeGreaterThan(text().indexOf(t.notificationCategoryRemindersTitle));
});

it('toggling one checkbox OFF saves exactly that category+channel', async () => {
  await mount();
  await act(async () => checkbox('BOOKING_UPDATES', 'PUSH').props.onChange({ target: { checked: false } }));
  await flush();
  expect(putCalls()).toEqual([{ category: 'BOOKING_UPDATES', channel: 'PUSH', enabled: false }]);
  expect(checkbox('BOOKING_UPDATES', 'PUSH').props.checked).toBe(false);
  expect(checkboxes().filter((c) => !c.props.checked)).toHaveLength(1);
});

it('PERSISTS and RELOADS: an OFF choice is still OFF after the page is reopened', async () => {
  await mount();
  await act(async () => checkbox('QUEUE_UPDATES', 'IN_APP').props.onChange({ target: { checked: false } }));
  await flush();
  await unmount();

  await mount(); // a fresh mount re-reads from the server
  expect(checkbox('QUEUE_UPDATES', 'IN_APP').props.checked).toBe(false);
  expect(checkbox('QUEUE_UPDATES', 'PUSH').props.checked).toBe(true);
  expect(checkbox('BOOKING_UPDATES', 'IN_APP').props.checked).toBe(true);
});

it('turning it back ON persists and reloads ON', async () => {
  await mount();
  await act(async () => checkbox('REMINDERS', 'PUSH').props.onChange({ target: { checked: false } }));
  await flush();
  await act(async () => checkbox('REMINDERS', 'PUSH').props.onChange({ target: { checked: true } }));
  await flush();
  await unmount();
  await mount();
  expect(checkbox('REMINDERS', 'PUSH').props.checked).toBe(true);
});

it('promotional is independent of the operational alerts', async () => {
  await mount();
  await act(async () => checkbox('PROMOTIONAL', 'PUSH').props.onChange({ target: { checked: false } }));
  await flush();
  expect(checkboxes().filter((c) => !c.props.checked).map((c) => c.props['data-testid'])).toEqual(['pref-PROMOTIONAL:PUSH']);
});

it('reverts the checkbox and says so when the save fails - never showing a state the server did not store', async () => {
  await mount();
  failNextPut = true;
  await act(async () => checkbox('ARRIVAL_ALERTS', 'IN_APP').props.onChange({ target: { checked: false } }));
  await flush();
  expect(checkbox('ARRIVAL_ALERTS', 'IN_APP').props.checked).toBe(true);
  expect(text()).toContain(t.notificationSettingsSaveFailed);
  expect(stored.size).toBe(0);
});

it('a customer is not shown operator-only arrival alerts, but keeps booking/queue/reminder/offer toggles', async () => {
  asCustomer();
  await mount();
  expect(text()).not.toContain(t.notificationCategoryArrivalTitle);
  expect(checkbox('ARRIVAL_ALERTS', 'PUSH')).toBeUndefined();
  expect(checkbox('BOOKING_UPDATES', 'PUSH')).toBeDefined();
  expect(checkbox('PROMOTIONAL', 'IN_APP')).toBeDefined();
});

it('states that the device notification permission, mute and Do Not Disturb still apply, and where push is delivered', async () => {
  await mount();
  expect(text()).toContain(t.notificationSettingsOsNote);
  expect(text()).toContain(t.notificationSettingsPushNote);
});

it('shows a retry when the settings cannot be loaded', async () => {
  apiFetch.mockRejectedValueOnce(new Error('offline'));
  await mount();
  expect(text()).toContain(t.notificationSettingsLoadFailed);
  expect(checkboxes()).toHaveLength(0);
  const retry = tree.root.findAll((n) => n.type === 'button' && n.props.onClick)[0];
  await act(async () => retry.props.onClick());
  await flush();
  expect(checkboxes()).toHaveLength(ALL_NOTIFICATION_CATEGORIES.length * 2 - 1);
});

it('renders Hindi copy for a Hindi-language user', async () => {
  useAuth.mockReturnValue({ user: { roles: ['SALON_OWNER'], preferredLanguage: 'HI' } });
  await mount();
  expect(text()).toContain(uiStringsFor('HI').notificationCategoryArrivalTitle);
});

it('shows the arrival push as Required with no checkbox, and states the arrival screen cannot be switched off', async () => {
  await mount();
  expect(checkbox('ARRIVAL_ALERTS', 'PUSH')).toBeUndefined();
  expect(text()).toContain('required-ARRIVAL_ALERTS:PUSH');
  expect(text()).toContain(t.notificationRequiredBadge);
  expect(text()).toContain('Arrival confirmation screens are required for shop operations');
  expect(putCalls()).toHaveLength(0);
});

it('still lets an owner turn the supplemental arrival in-app entry off', async () => {
  await mount();
  await act(async () => checkbox('ARRIVAL_ALERTS', 'IN_APP').props.onChange({ target: { checked: false } }));
  await flush();
  expect(putCalls()).toEqual([{ category: 'ARRIVAL_ALERTS', channel: 'IN_APP', enabled: false }]);
});
