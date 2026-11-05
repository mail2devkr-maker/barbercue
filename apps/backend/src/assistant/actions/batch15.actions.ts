import { AssistantActionId, Role, hasAdminPermission } from '@barbercue/shared';
import { type HandlerMap } from './kit';
import type { AdminNavPage, NavPage } from '../assistant-parser-phase8';

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
  paymentQr: { path: '/payment-qr', label: 'Payment QR' },
  location: { path: '/location', label: 'Shop location' },
  verification: { path: '/verification', label: 'Verification' },
  contacts: { path: '/contacts', label: 'Contacts' },
};

const ALL_ADMIN: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.HR_ADMIN,
  Role.SALES_ADMIN,
  Role.PLATFORM_VIEWER,
];
const LEADERSHIP: Role[] = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER];
const LEADERSHIP_VIEW: Role[] = [...LEADERSHIP, Role.PLATFORM_VIEWER];

/**
 * Admin screens by voice. Each page lists the roles that may open it, mirroring the web route rules
 * (lib/admin-route-access.ts) and the API behind it, so the assistant never sends someone to a page
 * that would refuse them. The page and its API still enforce access themselves.
 */
export const ADMIN_NAV_PAGES: Record<
  AdminNavPage,
  { path: string; label: string; roles: Role[] }
> = {
  adminHome: { path: '', label: 'Platform operations', roles: ALL_ADMIN },
  liveQueue: {
    path: '/live-queue',
    label: 'Live queue monitoring',
    roles: ALL_ADMIN,
  },
  allBookings: {
    path: '/bookings',
    label: 'All bookings',
    roles: LEADERSHIP_VIEW,
  },
  onboarding: {
    path: '/onboarding',
    label: 'New shop onboarding',
    roles: [...LEADERSHIP_VIEW, Role.SALES_ADMIN],
  },
  shopStatus: { path: '/shops/status', label: 'Shop status', roles: ALL_ADMIN },
  verification: {
    path: '/verification',
    label: 'Verification queue',
    roles: LEADERSHIP,
  },
  shopDeletions: {
    path: '/shop-deletions',
    label: 'Shop deletions',
    roles: [Role.PLATFORM_ADMIN],
  },
  employees: {
    path: '/employees',
    label: 'Employees',
    roles: [...LEADERSHIP, Role.HR_ADMIN],
  },
  crm: {
    path: '/crm',
    label: 'CRM',
    roles: [...LEADERSHIP, Role.HR_ADMIN, Role.SALES_ADMIN],
  },
  commandCenter: {
    path: '/command-center',
    label: 'Command center',
    roles: LEADERSHIP_VIEW,
  },
  customers: { path: '/customers', label: 'Customer analytics', roles: [] },
  salonStaff: { path: '/staff', label: 'Salon staff analytics', roles: [] },
  inventory: { path: '/inventory', label: 'Inventory', roles: LEADERSHIP_VIEW },
  adminUsers: {
    path: '/access',
    label: 'Admin users',
    roles: [Role.PLATFORM_ADMIN],
  },
  locationProposals: {
    path: '/location-proposals',
    label: 'Location proposals',
    roles: LEADERSHIP,
  },
};

export function mayOpenAdminPage(
  roles: readonly Role[],
  page: AdminNavPage,
): boolean {
  if (page === 'customers')
    return hasAdminPermission([...roles], 'viewCustomerAnalytics');
  if (page === 'salonStaff')
    return hasAdminPermission([...roles], 'viewStaffAnalytics');
  return ADMIN_NAV_PAGES[page].roles.some((r) => roles.includes(r));
}

const ADMIN_COMMON: AdminNavPage[] = [
  'adminHome',
  'liveQueue',
  'allBookings',
  'onboarding',
  'shopStatus',
];

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
  [AssistantActionId.ADMIN_NAVIGATE]: {
    plan(c, p) {
      const roles = c.user.roles as Role[];
      const page = p.page as AdminNavPage | null;
      if (!page || !ADMIN_NAV_PAGES[page]) {
        return Promise.resolve({
          status: 'NEEDS_INPUT',
          message: 'Which admin page should I open?',
          options: ADMIN_COMMON.filter((k) => mayOpenAdminPage(roles, k)).map(
            (k) => ({
              label: ADMIN_NAV_PAGES[k].label,
              text: `${ADMIN_NAV_PAGES[k].label} kholo`,
            }),
          ),
        });
      }
      const target = ADMIN_NAV_PAGES[page];
      if (!mayOpenAdminPage(roles, page)) {
        return Promise.resolve({
          status: 'DENIED',
          message: `${target.label} is not available for your role.`,
        });
      }
      return Promise.resolve({
        status: 'DONE',
        message: `Opening ${target.label}.`,
        result: { summary: target.label },
        navigateTo: `/dashboard/admin${target.path}`,
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
