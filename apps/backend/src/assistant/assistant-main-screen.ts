import {
  AssistantActionId as A,
  type AssistantActionId,
  type AssistantTurnDto,
} from '@barbercue/shared';

/**
 * Main-screen synchronisation (owner directive, 5 Nov 2026): the page each shop action is about. When
 * the assistant answers, asks which record, previews a change or completes one, the MAIN dashboard opens
 * that page of the AUTHORIZED shop (the salon id comes from the access-checked request, never from the
 * user's words), so the owner sees the real record the preview names and the real result afterwards.
 * Nothing is opened for refusals or unsupported requests. Pages still enforce their own access.
 */
const PAGE: Partial<Record<AssistantActionId, string>> = {
  [A.CHAIRS_LIST]: 'chairs',
  [A.CHAIRS_ADD]: 'chairs',
  [A.CHAIRS_SET_STATUS]: 'chairs',
  [A.STAFF_LIST]: 'staff',
  [A.STAFF_ADD]: 'staff',
  [A.STAFF_SET_STATUS]: 'staff',
  [A.STAFF_RENAME]: 'staff',
  [A.STAFF_HOURS_VIEW]: 'staff',
  [A.STAFF_HOURS_SET]: 'staff',
  [A.SERVICE_LIST]: 'services',
  [A.SERVICE_ADD]: 'services',
  [A.SERVICE_SET_PRICE]: 'services',
  [A.SERVICE_SET_DURATION]: 'services',
  [A.SERVICE_RENAME]: 'services',
  [A.SERVICE_ARCHIVE]: 'services',
  [A.SERVICE_RESTORE]: 'services',
  [A.HOURS_VIEW]: 'hours',
  [A.HOURS_SET]: 'hours',
  [A.QUEUE_STATUS]: 'queue',
  [A.QUEUE_CALL_NEXT]: 'queue',
  [A.QUEUE_MARK_ARRIVED]: 'queue',
  [A.QUEUE_NO_SHOW]: 'queue',
  [A.QUEUE_CANCEL]: 'queue',
  [A.QUEUE_COMPLETE]: 'queue',
  [A.QUEUE_ADD_WALK_IN]: 'queue',
  [A.QUEUE_ASSIGN]: 'queue',
  [A.QUEUE_START]: 'queue',
  [A.STAFF_TAKE_NEXT]: 'queue',
  [A.AUTO_ASSIGN_VIEW]: 'queue',
  [A.AUTO_ASSIGN_SET]: 'queue',
  [A.SCHEDULE_VIEW]: 'bookings',
  [A.BOOKING_CANCEL_BY_SHOP]: 'bookings',
  [A.BOOKING_RESCHEDULE_BY_SHOP]: 'bookings',
  [A.BOOKING_NO_SHOW]: 'bookings',
  [A.BOOKING_IN_SHOP]: 'bookings',
  [A.BOOKING_CORRECT_COMPLETED]: 'bookings',
  [A.BOOKINGS_REPORT]: 'bookings',
  [A.REVENUE_REPORT]: 'revenue',
  [A.INVOICES_LIST]: 'invoices',
  [A.CUSTOMERS_FIND]: 'customers',
  [A.REVIEWS_LIST]: 'reviews',
  [A.REVIEWS_REPLY]: 'reviews',
  [A.OFFERS_LIST]: 'offers',
  [A.OFFERS_PAUSE]: 'offers',
  [A.OFFERS_PUBLISH]: 'offers',
  [A.OFFERS_CREATE]: 'offers',
  [A.OFFERS_EDIT]: 'offers',
  [A.NOTIFICATIONS_LIST]: 'notifications',
  [A.NOTIFICATIONS_READ_ALL]: 'notifications',
  [A.CANCELLATION_ANALYTICS]: 'cancellations',
  [A.BOOKING_SOURCES]: 'booking-sources',
  [A.SALON_PROFILE_VIEW]: 'settings',
  [A.SALON_PROFILE_SET]: 'settings',
};

const SHOWN = new Set(['DONE', 'NEEDS_CONFIRMATION', 'NEEDS_INPUT']);

export function pageFor(actionId: AssistantActionId): string | null {
  // "Aaj ki revenue dikhao" is today's insights about revenue: the Revenue page.
  if (actionId === A.TODAY_INSIGHTS) return 'revenue';
  return PAGE[actionId] ?? null;
}

/** Adds the main-screen page to a shop answer (keeps a more specific link a handler already set). */
export function onMainScreen(
  turn: AssistantTurnDto,
  surface: string | undefined,
  salonId: string | null | undefined,
): AssistantTurnDto {
  if (
    (surface ?? 'shop') !== 'shop' ||
    !salonId ||
    !turn.action ||
    !SHOWN.has(turn.status)
  )
    return turn;
  const id = turn.action.id;
  if (id === A.NAVIGATE) return { ...turn, mainScreen: true };
  const page = pageFor(id);
  if (!page) return turn;
  const base = `/dashboard/salons/${salonId}/${page}`;
  const keep =
    turn.navigateTo && turn.navigateTo.startsWith(`${base}?`)
      ? turn.navigateTo
      : base;
  return { ...turn, navigateTo: keep, mainScreen: true };
}

/** Admin screens: admin.navigate already carries its fixed admin route. */
export function onAdminMainScreen(turn: AssistantTurnDto): AssistantTurnDto {
  return turn.action?.id === A.ADMIN_NAVIGATE &&
    turn.status === 'DONE' &&
    turn.navigateTo
    ? { ...turn, mainScreen: true }
    : turn;
}
