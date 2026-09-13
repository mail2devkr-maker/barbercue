import {
  createAuthenticatedHeroCommand,
  createSignedOutHeroCommand,
  type HeroCoordinates,
} from '../hero-action-commands';
import {
  stashPendingCustomerDestination,
  takePendingCustomerDestination,
} from '../customer-navigation-intent';
import {
  stashPendingShopRegistrationIntent,
  takePendingShopRegistrationIntent,
} from '../shop-registration-intent';

const location: HeroCoordinates = { lat: 12.9716, lng: 77.5946 };
const CREDITS_ENV = 'EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED';

describe('mobile Home hero actions', () => {
  const originalCreditsEnv = process.env[CREDITS_ENV];

  beforeEach(() => {
    takePendingCustomerDestination();
  });

  afterEach(() => {
    process.env[CREDITS_ENV] = originalCreditsEnv;
  });

  it('opens guest discovery for Book ahead and preserves known location', () => {
    expect(createSignedOutHeroCommand('bookAhead', location)).toEqual({
      destination: 'guestSearch',
      params: { initialLat: 12.9716, initialLng: 77.5946 },
    });
  });

  it('opens guest discovery for Join live without inventing a guest queue tab', () => {
    expect(createSignedOutHeroCommand('joinLive', null)).toEqual({
      destination: 'guestSearch',
      params: undefined,
    });
  });

  it('hands signed-out Great offers to customer authentication', () => {
    expect(createSignedOutHeroCommand('greatOffers', null)).toEqual({ destination: 'customerLogin' });
  });

  it('opens authenticated Book ahead in Search and preserves known location', () => {
    expect(createAuthenticatedHeroCommand('bookAhead', location)).toEqual({
      destination: 'search',
      params: { initialLat: 12.9716, initialLng: 77.5946 },
    });
  });

  it('opens authenticated Join live in the existing Queue tab', () => {
    expect(createAuthenticatedHeroCommand('joinLive', null)).toEqual({ destination: 'queue' });
  });

  it('opens authenticated Great offers in the existing Credits experience', () => {
    expect(createAuthenticatedHeroCommand('greatOffers', null)).toEqual({ destination: 'credits' });
  });

  // Google Play release gate (lib/feature-flags.ts) — the first closed-testing submission was
  // rejected over the Financial Features declaration Credits triggers; the production build sets
  // this env var to "false" (eas.json), and Great offers must never resolve to Credits then.
  it('never resolves authenticated Great offers to Credits when the release flag is off', () => {
    process.env[CREDITS_ENV] = 'false';
    expect(createAuthenticatedHeroCommand('greatOffers', location)).toEqual({
      destination: 'search',
      params: { initialLat: 12.9716, initialLng: 77.5946 },
    });
  });

  it('leaves Book ahead and Join live unaffected by the release flag', () => {
    process.env[CREDITS_ENV] = 'false';
    expect(createAuthenticatedHeroCommand('bookAhead', location)).toEqual({
      destination: 'search',
      params: { initialLat: 12.9716, initialLng: 77.5946 },
    });
    expect(createAuthenticatedHeroCommand('joinLive', null)).toEqual({ destination: 'queue' });
  });

  it('supersedes Great offers when the cancelled login flow is replaced by Register Shop', () => {
    stashPendingCustomerDestination({ kind: 'credits' });
    stashPendingShopRegistrationIntent();

    expect(takePendingCustomerDestination()).toEqual({ kind: 'registerShop' });
    expect(takePendingShopRegistrationIntent()).toBe(false);
  });

  it('supersedes Register Shop when the later Great offers flow wins', () => {
    stashPendingShopRegistrationIntent();
    stashPendingCustomerDestination({ kind: 'credits' });

    expect(takePendingCustomerDestination()).toEqual({ kind: 'credits' });
    expect(takePendingShopRegistrationIntent()).toBe(false);
  });
});
