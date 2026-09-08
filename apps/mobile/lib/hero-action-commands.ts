import type { SearchStackParamList } from '../navigation/types';

export type HeroAction = 'bookAhead' | 'joinLive' | 'greatOffers';
export type HeroCoordinates = { lat: number; lng: number } | null;

export type SignedOutHeroCommand =
  | { destination: 'guestSearch'; params: SearchStackParamList['SalonSearch'] }
  | { destination: 'customerLogin' };

export type AuthenticatedHeroCommand =
  | { destination: 'search'; params: SearchStackParamList['SalonSearch'] }
  | { destination: 'queue' }
  | { destination: 'credits' };

function salonSearchParams(locationCoords: HeroCoordinates): SearchStackParamList['SalonSearch'] {
  return locationCoords
    ? { initialLat: locationCoords.lat, initialLng: locationCoords.lng }
    : undefined;
}

export function createSignedOutHeroCommand(action: HeroAction, locationCoords: HeroCoordinates): SignedOutHeroCommand {
  if (action === 'greatOffers') return { destination: 'customerLogin' };
  return { destination: 'guestSearch', params: salonSearchParams(locationCoords) };
}

export function createAuthenticatedHeroCommand(action: HeroAction, locationCoords: HeroCoordinates): AuthenticatedHeroCommand {
  if (action === 'bookAhead') return { destination: 'search', params: salonSearchParams(locationCoords) };
  if (action === 'joinLive') return { destination: 'queue' };
  return { destination: 'credits' };
}
