const mockStore = new Map<string, string>();
jest.mock('../secure-storage', () => ({
  getItem: jest.fn(async (key: string) => (mockStore.has(key) ? mockStore.get(key)! : null)),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('../api', () => ({ apiFetch: jest.fn(async () => ({})) }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { easConfig: { projectId: 'eas-project-id' }, expoConfig: { extra: { eas: { projectId: 'eas-project-id' } } } },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationCategoryAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
}));

import * as Notifications from 'expo-notifications';
import { Role } from '@barbercue/shared';
import { apiFetch } from '../api';
import {
  CUSTOMER_PUSH_PROMPTED_KEY,
  registerPushDeviceAtAuthentication,
  requestCustomerPushAfterBooking,
  shouldPromptForPushAtAuthentication,
} from '../push-notifications';

const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const getToken = Notifications.getExpoPushTokenAsync as jest.Mock;
const api = apiFetch as jest.Mock;

const customer = { id: 'customer-1', roles: [Role.CUSTOMER], preferredLanguage: 'en' } as never;
const owner = { id: 'owner-1', roles: [Role.SALON_OWNER], preferredLanguage: 'en' } as never;
const staff = { id: 'staff-1', roles: [Role.SALON_STAFF], preferredLanguage: 'en' } as never;
const ownerWhoIsAlsoCustomer = { id: 'owner-2', roles: [Role.CUSTOMER, Role.SALON_OWNER], preferredLanguage: 'en' } as never;

function permission(granted: boolean) {
  getPermissions.mockResolvedValue({ granted });
  requestPermissions.mockResolvedValue({ granted });
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('who is prompted at authentication', () => {
  it('prompts owners and staff, never a customer-only account', () => {
    expect(shouldPromptForPushAtAuthentication(owner)).toBe(true);
    expect(shouldPromptForPushAtAuthentication(staff)).toBe(true);
    expect(shouldPromptForPushAtAuthentication(ownerWhoIsAlsoCustomer)).toBe(true);
    expect(shouldPromptForPushAtAuthentication(customer)).toBe(false);
    expect(shouldPromptForPushAtAuthentication(null)).toBe(false);
  });
});

describe('notification permission at login', () => {
  it('does NOT show the system prompt to a customer at login', async () => {
    permission(false);
    await expect(registerPushDeviceAtAuthentication(customer)).resolves.toBe(false);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('silently registers a customer who already granted permission (reminders keep working, no prompt)', async () => {
    permission(true);
    await expect(registerPushDeviceAtAuthentication(customer)).resolves.toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('push-devices/register', expect.objectContaining({ method: 'POST' }));
  });

  it('asks owners and staff at the authenticated entry point and registers when granted', async () => {
    permission(false);
    requestPermissions.mockResolvedValue({ granted: true });
    await expect(registerPushDeviceAtAuthentication(owner)).resolves.toBe(true);
    expect(requestPermissions).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    requestPermissions.mockResolvedValue({ granted: true });
    getPermissions.mockResolvedValue({ granted: false });
    await expect(registerPushDeviceAtAuthentication(staff)).resolves.toBe(true);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('does not re-request permission that is already granted for an owner', async () => {
    permission(true);
    await expect(registerPushDeviceAtAuthentication(owner)).resolves.toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
  });
});

describe('customer prompt after the first booking', () => {
  it('asks once after the first booking and registers the token when granted', async () => {
    getPermissions.mockResolvedValue({ granted: false });
    requestPermissions.mockResolvedValue({ granted: true });
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBe(true);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockStore.get(CUSTOMER_PUSH_PROMPTED_KEY)!)).toEqual({ userId: 'customer-1' });
    expect(api).toHaveBeenCalledWith('push-devices/register', expect.anything());
  });

  it('never asks the same account a second time, whether the first answer was yes or no', async () => {
    getPermissions.mockResolvedValue({ granted: false });
    requestPermissions.mockResolvedValue({ granted: false });
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBe(false);
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBe(false);
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBe(false);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('records the question BEFORE the system prompt so a crash mid-prompt cannot cause a second one', async () => {
    getPermissions.mockResolvedValue({ granted: false });
    requestPermissions.mockImplementation(async () => {
      expect(mockStore.has(CUSTOMER_PUSH_PROMPTED_KEY)).toBe(true);
      throw new Error('activity destroyed');
    });
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBe(false);
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBe(false);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('does not show the prompt when permission is already granted, but still registers the device', async () => {
    permission(true);
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('a different account on the same phone is asked on its own first booking', async () => {
    getPermissions.mockResolvedValue({ granted: false });
    requestPermissions.mockResolvedValue({ granted: false });
    await requestCustomerPushAfterBooking(customer);
    await requestCustomerPushAfterBooking({ id: 'customer-2', roles: [Role.CUSTOMER] } as never);
    expect(requestPermissions).toHaveBeenCalledTimes(2);
  });

  it('never throws and never touches the booking when storage or the OS fail', async () => {
    const storage = jest.requireMock('../secure-storage') as { getItem: jest.Mock };
    storage.getItem.mockRejectedValueOnce(new Error('keystore locked'));
    await expect(requestCustomerPushAfterBooking(customer)).resolves.toBeDefined();
    await expect(requestCustomerPushAfterBooking(null)).resolves.toBe(false);
  });
});
