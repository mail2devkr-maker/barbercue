/// <reference types="jest" />
import { act, createElement } from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { OwnerReviewDto, OwnerReviewsResponseDto } from '@barbercue/shared';
import OwnerReviewsScreen from '../OwnerReviewsScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 'salon-1', selectedSalon: { id: 'salon-1', name: 'Synthetic shop' } }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));
jest.mock('../../../lib/date-locale', () => ({ dateLocaleFor: () => 'en-IN' }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../../../components/ui', () => {
  const { createElement: el } = require('react');
  const { Text: NativeText, View: NativeView } = require('react-native');
  return {
    EmptyState: ({ title, message }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, message)),
    InlineError: ({ message }: any) => el(NativeText, null, message),
    PremiumCard: ({ children }: any) => el(NativeView, null, children),
    PremiumScreen: ({ children }: any) => el(NativeView, null, children),
    PremiumSectionHeader: ({ title, subtitle }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, subtitle)),
    Skeleton: () => null,
  };
});

const review: OwnerReviewDto = {
  id: 'review-1', bookingId: 'booking-1', salonId: 'salon-1', rating: 5,
  comment: 'Excellent service', ownerResponse: null, createdAt: '2026-10-27T09:00:00.000Z', updatedAt: '2026-10-27T09:00:00.000Z',
  source: 'FASTQUE', customerPhone: '+911111111111', customerEmail: 'private@example.test', serviceName: 'Haircut',
};

function response(overrides: Partial<OwnerReviewsResponseDto> = {}): OwnerReviewsResponseDto {
  return { source: 'FASTQUE', sources: [{ source: 'FASTQUE', state: 'CONNECTED', profileUrl: null }], items: [review], nextCursor: null, ...overrides };
}

let tree: ReturnType<typeof TestRenderer.create>;

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

function renderedText(): string {
  return tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ');
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('loads only the selected salon review route and does not render contact PII', async () => {
  (apiFetch as jest.Mock).mockResolvedValue(response());
  await act(async () => { tree = TestRenderer.create(createElement(OwnerReviewsScreen, {} as never)); });

  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/reviews?limit=20');
  expect(renderedText()).toContain('Excellent service');
  expect(renderedText()).toContain('Haircut');
  expect(renderedText()).not.toContain('+911111111111');
  expect(renderedText()).not.toContain('private@example.test');
});

it('passes the selected external source and clearly labels link-only providers', async () => {
  (apiFetch as jest.Mock)
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response({
      source: 'GOOGLE', items: [],
      sources: [{ source: 'GOOGLE', state: 'LINK_ONLY', profileUrl: 'https://g.page/example' }],
    }));
  await act(async () => { tree = TestRenderer.create(createElement(OwnerReviewsScreen, {} as never)); });
  const google = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node).includes('Google'))[0];
  await act(async () => google.props.onPress());

  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/reviews?limit=20&source=GOOGLE');
  expect(renderedText()).toContain('FastQue stores this profile link only; reviews are not imported from this provider.');
});

it('loads the next cursor page without showing duplicate reviews', async () => {
  (apiFetch as jest.Mock)
    .mockResolvedValueOnce(response({ nextCursor: 'review-cursor' }))
    .mockResolvedValueOnce(response({ items: [review, { ...review, id: 'review-2', comment: 'Another visit' }], nextCursor: null }));
  await act(async () => { tree = TestRenderer.create(createElement(OwnerReviewsScreen, {} as never)); });
  const more = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Load more'))[0];
  await act(async () => more.props.onPress());

  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/reviews?limit=20&cursor=review-cursor');
  expect(tree.root.findAll((node: any) => node.type === Text && textOf(node) === 'Excellent service')).toHaveLength(1);
  expect(renderedText()).toContain('Another visit');
});

it('posts a non-empty public owner response through the salon-scoped endpoint', async () => {
  const saved = { ...review, ownerResponse: 'Thank you for visiting.' };
  (apiFetch as jest.Mock).mockResolvedValueOnce(response()).mockResolvedValueOnce(saved);
  await act(async () => { tree = TestRenderer.create(createElement(OwnerReviewsScreen, {} as never)); });
  const input = tree.root.findByType(TextInput);
  await act(async () => input.props.onChangeText('  Thank you for visiting.  '));
  const post = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Post response'))[0];
  await act(async () => post.props.onPress());

  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/reviews/review-1/response', {
    method: 'PUT', body: JSON.stringify({ ownerResponse: 'Thank you for visiting.' }),
  });
  expect(renderedText()).toContain('Thank you for visiting.');
});

it('shows errors without fabricating an empty review list', async () => {
  (apiFetch as jest.Mock).mockRejectedValue(new Error('network unavailable'));
  await act(async () => { tree = TestRenderer.create(createElement(OwnerReviewsScreen, {} as never)); });

  expect(renderedText()).toContain('Could not load reviews. Please try again.');
  expect(renderedText()).not.toContain('Excellent service');
});
