import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LocationPickerModal, __resetCityCacheForTests } from '../LocationPickerModal';
import { apiFetch } from '../../../lib/api';
import { resolveHomeLocation } from '../../../lib/home-location';
import {
  __resetLocationChoiceForTests,
  cityQueryParams,
  filterCities,
  getLocationChoice,
  locationChoiceLabel,
} from '../../../lib/location-choice';
import { buildDiscoveryQuery, DEFAULT_DISCOVERY_FILTERS } from '../../../lib/discovery-search';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/home-location', () => ({ resolveHomeLocation: jest.fn() }));
const fetchMock = apiFetch as jest.Mock;
const gpsMock = resolveHomeLocation as jest.Mock;

const cities = [
  { id: 'c1', name: 'Bengaluru', slug: 'bengaluru', countryCode: 'IN', regionCode: null, state: 'Karnataka', country: 'India' },
  { id: 'c2', name: 'Pune', slug: 'pune', countryCode: 'IN', regionCode: null, state: 'Maharashtra', country: 'India' },
];

beforeEach(() => {
  __resetLocationChoiceForTests();
  __resetCityCacheForTests();
  fetchMock.mockReset();
  gpsMock.mockReset();
  fetchMock.mockResolvedValue(cities);
});

it('lists the cities FastQue has shops in and picks one', async () => {
  const onChosen = jest.fn();
  const onClose = jest.fn();
  await render(<LocationPickerModal visible onClose={onClose} onChosen={onChosen} hindi={false} />);
  await fireEvent.press(await screen.findByLabelText('Pune, Maharashtra'));
  expect(fetchMock).toHaveBeenCalledWith('cities');
  expect(getLocationChoice()).toEqual({ kind: 'city', city: { id: 'c2', name: 'Pune', slug: 'pune', countryCode: 'IN', state: 'Maharashtra' } });
  expect(onChosen).toHaveBeenCalledWith(getLocationChoice());
  expect(onClose).toHaveBeenCalled();
});

it('filters the city list as the customer types', async () => {
  await render(<LocationPickerModal visible onClose={jest.fn()} hindi={false} />);
  await screen.findByLabelText('Bengaluru, Karnataka');
  await fireEvent.changeText(screen.getByLabelText('Search cities'), 'pun');
  expect(screen.queryByLabelText('Bengaluru, Karnataka')).toBeNull();
  expect(screen.getByLabelText('Pune, Maharashtra')).toBeTruthy();
});

it('uses the current location when asked, which enables distances', async () => {
  gpsMock.mockResolvedValue({ label: 'Indiranagar', coords: { lat: 12.97, lng: 77.64 } });
  await render(<LocationPickerModal visible onClose={jest.fn()} hindi={false} />);
  await fireEvent.press(screen.getByLabelText('Use my current location'));
  await waitFor(() => expect(getLocationChoice()).toEqual({ kind: 'gps', label: 'Indiranagar', coords: { lat: 12.97, lng: 77.64 } }));
  expect(gpsMock).toHaveBeenCalledWith(true, true);
});

it('keeps the picker open with a clear message when location is refused', async () => {
  gpsMock.mockResolvedValue(null);
  const onClose = jest.fn();
  await render(<LocationPickerModal visible onClose={onClose} hindi={false} />);
  await fireEvent.press(screen.getByLabelText('Use my current location'));
  expect(await screen.findByText(/Could not get your location/)).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(getLocationChoice()).toBeNull();
});

it('"All cities" clears the choice', async () => {
  await render(<LocationPickerModal visible onClose={jest.fn()} hindi={false} />);
  await fireEvent.press(await screen.findByLabelText('Pune, Maharashtra'));
  await render(<LocationPickerModal visible onClose={jest.fn()} hindi={false} />);
  await fireEvent.press(await screen.findByLabelText('All cities'));
  expect(getLocationChoice()).toBeNull();
});

describe('location choice helpers', () => {
  it('labels and turns a city into the website query keys', () => {
    const city = { kind: 'city' as const, city: { id: 'c1', name: 'Bengaluru', slug: 'bengaluru', countryCode: 'IN', state: 'Karnataka' } };
    expect(locationChoiceLabel(city)).toBe('Bengaluru');
    expect(cityQueryParams(city)).toEqual({ city: 'bengaluru', countryCode: 'IN' });
    expect(cityQueryParams({ kind: 'gps', label: 'x', coords: { lat: 1, lng: 2 } })).toBeNull();
    expect(filterCities(cities, 'KARNA').map((c) => c.id)).toEqual(['c1']);
  });

  it('sends city + countryCode when no GPS point is used, and never both', () => {
    const base = { text: 'Haircut', filters: DEFAULT_DISCOVERY_FILTERS, favoriteIds: null };
    const byCity = buildDiscoveryQuery({ ...base, coords: null, city: { city: 'pune', countryCode: 'IN' } });
    expect(byCity.kind === 'search' && new URLSearchParams(byCity.query).get('city')).toBe('pune');
    expect(byCity.kind === 'search' && new URLSearchParams(byCity.query).get('countryCode')).toBe('IN');
    const byGps = buildDiscoveryQuery({ ...base, coords: { lat: 1, lng: 2 }, city: { city: 'pune', countryCode: 'IN' } });
    expect(byGps.kind === 'search' && new URLSearchParams(byGps.query).has('city')).toBe(false);
    expect(byGps.kind === 'search' && new URLSearchParams(byGps.query).get('lat')).toBe('1');
  });
});
