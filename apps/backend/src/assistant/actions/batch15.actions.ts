import { AssistantActionId } from '@barbercue/shared';
import { type HandlerMap } from './kit';
import type { NavPage } from '../assistant-parser-phase8';

/**
 * Batch 15 (issue #368): opening a FastQue page on the MAIN screen, and going back.
 *
 * The route is built here from a fixed page key and the AUTHORIZED shop id (the action requires
 * owner-or-admin access to that shop, checked before plan runs), so neither the user's words nor a
 * model can produce an arbitrary URL. The page itself still enforces its own access when it loads.
 * Nothing is changed by either action.
 */
export const NAV_PAGES: Record<NavPage, { path: string; label: string }> = {
  dashboard: { path: '', label: 'Dashboard' },
  queue: { path: '/queue', label: 'Live Queue' },
  bookings: { path: '/bookings', label: 'Bookings' },
  schedule: { path: '/schedule', label: 'Schedule' },
  staff: { path: '/staff', label: 'Staff' },
  team: { path: '/team', label: 'Team' },
  services: { path: '/services', label: 'Services' },
  chairs: { path: '/chairs', label: 'Chairs' },
  settings: { path: '/settings', label: 'Settings' },
  hours: { path: '/hours', label: 'Opening hours' },
  offers: { path: '/offers', label: 'Offers' },
  reviews: { path: '/reviews', label: 'Reviews' },
  invoices: { path: '/invoices', label: 'Invoices' },
  revenue: { path: '/revenue', label: 'Revenue' },
  customers: { path: '/customers', label: 'Customers' },
  analytics: { path: '/analytics', label: 'Analytics' },
  cancellations: { path: '/cancellations', label: 'Cancellations' },
  inventory: { path: '/inventory', label: 'Inventory' },
  notifications: { path: '/notifications', label: 'Notifications' },
  payments: { path: '/payments', label: 'Payments' },
  photos: { path: '/photos', label: 'Photos' },
  marketing: { path: '/marketing', label: 'Marketing' },
  bookingSources: { path: '/booking-sources', label: 'Booking sources' },
};

const COMMON: NavPage[] = [
  'dashboard',
  'queue',
  'bookings',
  'services',
  'staff',
  'chairs',
];

export const BATCH15_HANDLERS: HandlerMap = {
  [AssistantActionId.NAVIGATE]: {
    plan(c, p) {
      const page = p.page as NavPage | null;
      const target = page ? NAV_PAGES[page] : undefined;
      if (!target) {
        return Promise.resolve({
          status: 'NEEDS_INPUT',
          message: 'Which page should I open?',
          options: COMMON.map((k) => ({
            label: NAV_PAGES[k].label,
            text: `${NAV_PAGES[k].label} kholo`,
          })),
        });
      }
      return Promise.resolve({
        status: 'DONE',
        message: `Opening ${target.label}.`,
        result: { summary: target.label },
        navigateTo: `/dashboard/salons/${c.salonId}${target.path}`,
      });
    },
  },
  [AssistantActionId.NAVIGATE_BACK]: {
    // The client goes back only to a page the assistant itself opened in this conversation.
    plan() {
      return Promise.resolve({
        status: 'DONE',
        message: 'Going back to the previous page.',
        result: { summary: 'Back' },
      });
    },
  },
  // Answered by AssistantService.turn from this user's own capabilities (role, screen, release
  // gate) before any handler runs; registered so the capability list shows it as supported.
  [AssistantActionId.HELP]: {
    plan() {
      return Promise.resolve({
        status: 'DONE',
        message: 'Ask me "What can you do?" to see what I can help with here.',
      });
    },
  },
};
