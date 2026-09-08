import {
  createAuthenticatedHeroCommand,
  createSignedOutHeroCommand,
  type HeroCoordinates,
} from '../hero-action-commands';

const location: HeroCoordinates = { lat: 12.9716, lng: 77.5946 };

describe('mobile Home hero actions', () => {
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
});
