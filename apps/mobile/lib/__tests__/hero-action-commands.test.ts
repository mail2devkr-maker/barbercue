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
    process.env[CREDITS_ENV] = 'true';
    takePendingCustomerDestination();
  });

  afterEach(() => {
    if (originalCreditsEnv === undefined) {
      delete process.env[CREDITS_ENV];
    } else {
      process.env[CREDITS_ENV] = originalCreditsEnv;
    }
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

  it('opens public Great offers without forcing sign-in', () => {
    expect(createSignedOutHeroCommand('greatOffers', null)).toEqual({ destination: 'guestOffers' });
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

  it('opens public Great offers independently of the Credits release gate', () => {
    expect(createAuthenticatedHeroCommand('greatOffers', null)).toEqual({ destination: 'offers' });
  });

  it('keeps public offers discoverable when the Credits release flag is off', () => {
    process.env[CREDITS_ENV] = 'false';
    expect(createAuthenticatedHeroCommand('greatOffers', location)).toEqual({ destination: 'offers' });
  });

  it('leaves Book ahead and Join live unaffected by the release flag', () => {
    process.env[CREDITS_ENV] = 'false';
    expect(createAuthenticatedHeroCommand('bookAhead', location)).toEqual({
      destination: 'search',
      params: { initialLat: 12.9716, initialLng: 77.5946 },
    });
    expect(createAuthenticatedHeroCommand('joinLive', null)).toEqual({ destination: 'queue' });
  });

  it('does not create an authentication intent for public offer browsing', () => {
    expect(createSignedOutHeroCommand('greatOffers', null)).toEqual({ destination: 'guestOffers' });
    expect(takePendingCustomerDestination()).toBeNull();
    expect(takePendingShopRegistrationIntent()).toBe(false);
  });
});
