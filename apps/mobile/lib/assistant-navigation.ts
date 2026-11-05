import type { AssistantSurface } from '@barbercue/shared';

export type AssistantDestination =
  | 'customer-search'
  | 'customer-bookings'
  | 'customer-queue'
  | 'customer-account'
  | 'owner-dashboard'
  | 'owner-queue'
  | 'owner-bookings'
  | 'owner-shop'
  | 'owner-settings'
  | 'owner-analytics'
  | 'owner-cancellations'
  | 'owner-invoices'
  | 'owner-payments'
  | 'owner-reviews'
  | 'owner-offers'
  | 'owner-verification'
  | 'owner-inventory'
  | 'owner-customers'
  | 'owner-notifications'
  | 'staff-today'
  | 'staff-notifications';

/**
 * Translate only server-owned, known FastQue pages into native destinations. The server still
 * authorizes every Assistant action; this is a second client-side guard so an unexpected path or
 * another salon's navigation response cannot open a different workspace.
 */
export function resolveAssistantDestination(input: {
  navigateTo: string;
  surface: AssistantSurface;
  salonId?: string | null;
  isOwner?: boolean;
}): AssistantDestination | null {
  const { navigateTo, surface, salonId, isOwner = false } = input;

  if (surface === 'customer') {
    const customerPages: Record<string, AssistantDestination> = {
      '/search': 'customer-search',
      '/account/bookings': 'customer-bookings',
      '/account/queue': 'customer-queue',
      '/account/profile': 'customer-account',
    };
    return customerPages[navigateTo] ?? null;
  }

  if (surface === 'employee') return null;

  const shopRoute = navigateTo.match(/^\/dashboard\/salons\/([^/]+)(\/.*)?$/);
  if (!shopRoute || !salonId || shopRoute[1] !== salonId) return null;
  const page = shopRoute[2] ?? '';

  if (!isOwner) {
    if (page === '/queue' || page === '/bookings' || page === '/staff') return 'staff-today';
    if (page === '/notifications') return 'staff-notifications';
    return null;
  }

  const ownerPages: Record<string, AssistantDestination> = {
    '': 'owner-dashboard',
    '/queue': 'owner-queue',
    '/bookings': 'owner-bookings',
    '/services': 'owner-shop',
    '/staff': 'owner-shop',
    '/chairs': 'owner-shop',
    '/hours': 'owner-shop',
    '/photos': 'owner-shop',
    '/settings': 'owner-settings',
    '/inventory': 'owner-inventory',
    '/customers': 'owner-customers',
    '/revenue': 'owner-analytics',
    '/analytics': 'owner-analytics',
    '/cancellations': 'owner-cancellations',
    '/offers': 'owner-offers',
    '/reviews': 'owner-reviews',
    '/invoices': 'owner-invoices',
    '/payments': 'owner-payments',
    '/verification': 'owner-verification',
    '/notifications': 'owner-notifications',
  };
  return ownerPages[page] ?? null;
}
