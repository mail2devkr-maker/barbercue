/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Language, Role, type MeResponse, type UiStrings } from '@barbercue/shared';
import { LanguageProvider, useLanguage } from '../language-context';

// The exact scenario a Build 9 physical-device test raised: an owner switches language, then
// immediately (same tick) triggers a booking. This proves the fix — OwnerBookingsScreen now reads
// this same `language` state instead of `user.preferredLanguage` — actually closes the race,
// rather than merely asserting the architecture "should" work. Drives react-test-renderer
// directly (skipping @testing-library/react-native's renderHook) since that wrapper's act-
// environment auto-configuration doesn't bridge cleanly with this project's React 19 + jest-expo
// combination; react-test-renderer's own `act` is the primitive both are built on.

jest.mock('../api', () => ({ apiFetch: jest.fn() }));
jest.mock('../secure-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

const mockRefreshMe = jest.fn().mockResolvedValue(undefined);
const mockUser: MeResponse = {
  id: 'owner-1',
  roles: [Role.SALON_OWNER],
  phone: '+919876543210',
  email: null,
  preferredLanguage: Language.EN,
  passwordConfigured: true,
};

jest.mock('../auth-context', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: mockUser,
    refreshMe: mockRefreshMe,
  }),
}));

import { apiFetch } from '../api';

interface Captured {
  language: Language;
  t: UiStrings;
  setLanguage: (language: Language) => void;
}

function Probe({ onValue }: { onValue: (v: Captured) => void }) {
  const value = useLanguage();
  onValue(value);
  return null;
}

async function renderProbe(): Promise<{ latest: () => Captured }> {
  let latest: Captured | undefined;
  await act(async () => {
    TestRenderer.create(
      createElement(LanguageProvider, null, createElement(Probe, { onValue: (v) => { latest = v; } })),
    );
    // Flushes the hydration effect's getItem() microtask (mocked to resolve null) so tests start
    // from the settled, hydrated EN state rather than a mid-flight one.
    await Promise.resolve();
    await Promise.resolve();
  });
  if (!latest) throw new Error('Probe never rendered');
  return { latest: () => latest as Captured };
}

describe('LanguageProvider — effective runtime locale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiFetch as jest.Mock).mockResolvedValue(undefined);
  });

  it('authenticated owner: English -> Hindi is reflected in `language` synchronously, before the PATCH/refreshMe round-trip settles', async () => {
    const { latest } = await renderProbe();
    expect(latest().language).toBe(Language.EN);

    // Never awaited — a real component's voice code reads `language` for the NEXT
    // booking/cancellation event, which can arrive before this promise chain finishes.
    act(() => {
      latest().setLanguage(Language.HI);
    });

    // This is the actual guarantee OwnerBookingsScreen's preferredLanguageRef now depends on:
    // `language` (and therefore SPEECH_LOCALE[language] / voiceAnnouncementsFor(language)) is
    // already Hindi here, in the same synchronous update — not after apiFetch/refreshMe resolve.
    expect(latest().language).toBe(Language.HI);
    expect(latest().t.book).toBe('अपॉइंटमेंट बुक करें');

    // The PATCH does still fire, asynchronously, to persist the choice server-side.
    await act(async () => {
      await Promise.resolve();
    });
    expect(apiFetch).toHaveBeenCalledWith('auth/language', expect.objectContaining({ method: 'PATCH' }));
  });

  it('authenticated owner: Hindi -> English is reflected in `language` synchronously', async () => {
    const { latest } = await renderProbe();
    expect(latest().language).toBe(Language.EN);

    act(() => {
      latest().setLanguage(Language.HI);
    });
    expect(latest().language).toBe(Language.HI);

    act(() => {
      latest().setLanguage(Language.EN);
    });
    expect(latest().language).toBe(Language.EN);
    expect(latest().t.book).toBe('Book an appointment');
  });

  it('does not wait for refreshMe to resolve before the new language takes effect — the race that reproduced the physical failure', async () => {
    // A refreshMe/PATCH that never resolves within this test simulates the exact vulnerable
    // window: if any consumer read user.preferredLanguage instead of this provider's own
    // `language`, it would stay stuck on the pre-switch value for as long as this stays pending.
    mockRefreshMe.mockReturnValue(new Promise(() => {}));
    (apiFetch as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { latest } = await renderProbe();
    expect(latest().language).toBe(Language.EN);

    act(() => {
      latest().setLanguage(Language.HI);
    });

    expect(latest().language).toBe(Language.HI);
  });
});
