import type {
  AssistantActionId,
  AssistantPreviewRow,
  AssistantResource,
  AssistantTurnDto,
  AuthenticatedUser,
  Role,
} from '@barbercue/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SalonServicesService } from '../../salon-setup/salon-services.service';
import type { SalonStaffService } from '../../salon-setup/salon-staff.service';
import type { SalonOperatingHoursService } from '../../salon-setup/salon-operating-hours.service';
import type { QueueService } from '../../queue/queue.service';
import type { OwnerAssistantService } from '../../owner-ops/owner-assistant.service';
import type { ShopBookingActionsService } from '../../owner-ops/shop-booking-actions.service';
import type { CustomerAssistantSearchService } from '../../salons/customer-assistant-search.service';
import type { BookingsService } from '../../bookings/bookings.service';
import type { AvailabilityService } from '../../bookings/availability.service';
import type { DashboardBookingsService } from '../../dashboard-bookings/dashboard-bookings.service';
import type { DashboardCustomersService } from '../../dashboard-customers/dashboard-customers.service';
import type { SealedWrite } from '../assistant-confirmation';
import { matchByName } from '../assistant-parser';

/**
 * Building blocks for Action Assistant handlers (issue #362). A handler is the ONLY place an action
 * touches FastQue, and it may only call the existing services in `Deps` as the session user. To add an
 * action: define it in catalog.ts, teach the interpreter its words, add `plan` (and `execute` for a
 * write) in a domain file, and add an e2e scenario.
 */

/** Who may ask, and which shop-level check runs before plan AND before execute. */
export type Access =
  'OWNER_OR_ADMIN' | 'STAFF_OR_ADMIN' | 'SELF' | 'ANY_SIGNED_IN';

export interface ActionDef {
  title: string;
  kind: 'READ' | 'WRITE';
  confirm: boolean;
  roles: Role[];
  access: Access;
  examples: string[];
}

export type Planned = Partial<AssistantTurnDto>;

export interface Deps {
  prisma: PrismaService;
  staff: SalonStaffService;
  services: SalonServicesService;
  hours: SalonOperatingHoursService;
  queue: QueueService;
  insights: OwnerAssistantService;
  search: CustomerAssistantSearchService;
  bookings: BookingsService;
  availability: AvailabilityService;
  shopBookings: ShopBookingActionsService;
  dashboardBookings: DashboardBookingsService;
  dashboardCustomers: DashboardCustomersService;
}

export interface PlanCtx {
  user: AuthenticatedUser;
  /** The authorized shop, or '' for self-service actions. */
  salonId: string;
  text: string;
  deps: Deps;
  /** Preview a write. Nothing changes until the user confirms the sealed token. */
  seal(
    payload: Record<string, unknown>,
    before: unknown,
    rows: AssistantPreviewRow[],
    warning?: string,
  ): Planned;
}

export interface ExecCtx {
  user: AuthenticatedUser;
  salonId: string;
  deps: Deps;
  payload: Record<string, unknown>;
  sealed: SealedWrite;
  /** Refuse unless the state now matches what the preview was made from. */
  assertUnchanged(before: unknown): void;
  done(
    message: string,
    resource: AssistantResource,
    id: string,
    rows: AssistantPreviewRow[],
    navigateTo?: string,
  ): Planned;
}

export interface Handler {
  plan(c: PlanCtx, intent: Record<string, unknown>): Promise<Planned>;
  execute?(c: ExecCtx): Promise<Planned>;
}

export type HandlerMap = Partial<Record<AssistantActionId, Handler>>;

/** A planned answer that is not an error (needs input, nothing to do, ...). */
export class Reply extends Error {
  constructor(readonly turn: Planned) {
    super(turn.message ?? '');
  }
}

export const staleReply = () =>
  new Reply({
    status: 'FAILED',
    message:
      'This changed since the preview, so nothing was applied. Ask again to see the current state.',
  });

export const rupees = (n: number) =>
  `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
export const maskPhone = (p: string | null | undefined) =>
  p ? `${p.slice(0, 3)}••••••${p.slice(-2)}` : null;

/** Resolve a row named in the text, or ask which one (offering the choices as tappable options). */
export function pick<T>(
  rows: T[],
  text: string,
  nameOf: (r: T) => string,
  question: string,
  optionText: (r: T) => string,
): T {
  const hits = matchByName(text, rows, nameOf);
  if (hits.length === 1) return hits[0];
  const choices = hits.length ? hits : rows;
  throw new Reply({
    status: 'NEEDS_INPUT',
    message: hits.length ? `More than one match. ${question}` : question,
    options: choices
      .slice(0, 8)
      .map((r) => ({ label: nameOf(r), text: optionText(r) })),
  });
}

/** A sealed payload or intent field as text; anything that is not a string or number becomes ''. */
export function text(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';
}
