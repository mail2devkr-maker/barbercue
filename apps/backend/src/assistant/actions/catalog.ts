import { AssistantActionId, Role } from '@barbercue/shared';
import type { ActionDef } from './kit';

const SHOP_MANAGERS: Role[] = [Role.SALON_OWNER, Role.PLATFORM_ADMIN];
const SHOP_TEAM: Role[] = [
  Role.SALON_OWNER,
  Role.SALON_STAFF,
  Role.PLATFORM_ADMIN,
];
const CUSTOMERS: Role[] = [Role.CUSTOMER];
const OWNERS: Role[] = [Role.SALON_OWNER];
const PLATFORM_READERS: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.PLATFORM_VIEWER,
];
const EVERYONE: Role[] = Object.values(Role);

const read = (
  title: string,
  roles: Role[],
  access: ActionDef['access'],
  examples: string[],
): ActionDef => ({
  title,
  kind: 'READ',
  confirm: false,
  roles,
  access,
  examples,
});
const write = (
  title: string,
  roles: Role[],
  access: ActionDef['access'],
  examples: string[],
): ActionDef => ({
  title,
  kind: 'WRITE',
  confirm: true,
  roles,
  access,
  examples,
});

/**
 * The allowlist. Anything not here cannot be executed, whatever the words say. Every write needs an
 * on-screen confirmation. `roles` is only the first filter; the shop-level check and the existing
 * service's own rules decide.
 */
export const ASSISTANT_ACTIONS: Record<AssistantActionId, ActionDef> = {
  // ---- staff
  [AssistantActionId.STAFF_LIST]: read(
    'Show staff',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Staff dikhao', 'Show my staff'],
  ),
  [AssistantActionId.STAFF_ADD]: write(
    'Add a staff member',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Ravi ko staff mein add karo', 'Add Ravi as staff 9876543210'],
  ),
  [AssistantActionId.STAFF_SET_STATUS]: write(
    'Activate or deactivate staff',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Ravi staff ko deactivate karo', 'Activate staff Ravi'],
  ),
  [AssistantActionId.STAFF_RENAME]: write(
    'Rename a staff member',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Ravi staff ka naam Ravi Kumar karo', 'Rename staff Ravi to Ravi Kumar'],
  ),
  // ---- services
  [AssistantActionId.SERVICE_LIST]: read(
    'Show services',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Services dikhao', 'List my services'],
  ),
  [AssistantActionId.SERVICE_ADD]: write(
    'Add a service',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Beard trim service add karo ₹100 20 minute'],
  ),
  [AssistantActionId.SERVICE_SET_PRICE]: write(
    'Change a service price',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Haircut ₹200 se ₹150 karo', 'Massage price 10% badha do'],
  ),
  [AssistantActionId.SERVICE_SET_DURATION]: write(
    'Change a service duration',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Haircut 45 minute karo'],
  ),
  [AssistantActionId.SERVICE_RENAME]: write(
    'Rename a service',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Rename service Facial to Gold Facial'],
  ),
  [AssistantActionId.SERVICE_ARCHIVE]: write(
    'Remove (archive) a service',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Facial service hata do'],
  ),
  [AssistantActionId.SERVICE_RESTORE]: write(
    'Restore an archived service',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Facial service wapas chalu karo'],
  ),
  // ---- opening hours
  [AssistantActionId.HOURS_VIEW]: read(
    'Show opening hours',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Dukan ki timing dikhao', 'Show opening hours'],
  ),
  [AssistantActionId.HOURS_SET]: write(
    'Change opening hours',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Sunday band rakho', 'Monday 10 se 8 baje khulega', 'Har din 9 se 9'],
  ),
  // ---- live queue
  [AssistantActionId.QUEUE_STATUS]: read(
    'Show the live queue',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Aaj ki queue dikhao'],
  ),
  [AssistantActionId.QUEUE_CALL_NEXT]: write(
    'Call the next customer',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Agla customer bulao', 'Call next'],
  ),
  [AssistantActionId.QUEUE_MARK_ARRIVED]: write(
    'Mark a customer arrived',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Token 12 aa gaya'],
  ),
  [AssistantActionId.QUEUE_NO_SHOW]: write(
    'Mark a no-show',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Token 12 no show'],
  ),
  [AssistantActionId.QUEUE_CANCEL]: write(
    'Cancel a queue entry',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Token 12 cancel karo'],
  ),
  [AssistantActionId.QUEUE_COMPLETE]: write(
    'Complete a service',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Token 12 ho gaya'],
  ),
  [AssistantActionId.QUEUE_ADD_WALK_IN]: write(
    'Add a walk-in to the queue',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Walk-in add karo Amit haircut'],
  ),
  // ---- schedule and customers (the shop bookings list is owner/admin only in FastQue, so these are too;
  //      barbers keep using the Live Queue)
  [AssistantActionId.SCHEDULE_VIEW]: read(
    'Show appointments',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Aaj ke appointments dikhao', 'Kal ki bookings'],
  ),
  [AssistantActionId.BOOKING_CANCEL_BY_SHOP]: write(
    'Cancel an appointment',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Aaj 5 baje ka appointment cancel karo'],
  ),
  [AssistantActionId.BOOKING_RESCHEDULE_BY_SHOP]: write(
    'Reschedule an appointment',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Kal 5 baje wala appointment 6 baje kar do'],
  ),
  [AssistantActionId.CUSTOMERS_FIND]: read(
    'Find customers',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Customer Amit dhundo', 'Customers dikhao'],
  ),
  [AssistantActionId.TODAY_INSIGHTS]: read(
    "Today's sales and summary",
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Aaj ki sales batao', "Today's summary"],
  ),
  // ---- customers (self-service)
  [AssistantActionId.SALON_SEARCH]: read(
    'Find a salon',
    Object.values(Role),
    'ANY_SIGNED_IN',
    ['Haircut salon dhoondo'],
  ),
  [AssistantActionId.MY_BOOKINGS]: read('Show my bookings', CUSTOMERS, 'SELF', [
    'Meri bookings dikhao',
  ]),
  [AssistantActionId.MY_BOOKING_CANCEL]: write(
    'Cancel my appointment',
    CUSTOMERS,
    'SELF',
    ['Mera appointment cancel karo'],
  ),
  [AssistantActionId.MY_BOOKING_RESCHEDULE]: write(
    'Reschedule my appointment',
    CUSTOMERS,
    'SELF',
    ['Mera appointment kal 6 baje kar do'],
  ),
  [AssistantActionId.MY_QUEUE_STATUS]: read(
    'My queue status',
    CUSTOMERS,
    'SELF',
    ['Meri queue ka status batao'],
  ),
  [AssistantActionId.MY_QUEUE_LEAVE]: write(
    'Leave the queue',
    CUSTOMERS,
    'SELF',
    ['Queue chhod do'],
  ),
  [AssistantActionId.BOOK_APPOINTMENT]: write(
    'Book an appointment',
    CUSTOMERS,
    'SELF',
    ['Kal shaam 5 baje haircut book karo'],
  ),
  // ---- batch 3: shop
  [AssistantActionId.CHAIRS_LIST]: read(
    'Show chairs',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Chairs dikhao'],
  ),
  [AssistantActionId.CHAIRS_ADD]: write(
    'Add a chair',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Naya chair add karo Chair 3'],
  ),
  [AssistantActionId.CHAIRS_SET_STATUS]: write(
    'Activate, deactivate or repair a chair',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Chair 2 maintenance mein daalo', 'Chair 2 band karo'],
  ),
  [AssistantActionId.STAFF_HOURS_VIEW]: read(
    'Show a staff member’s weekly hours',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Ravi staff ki timing dikhao'],
  ),
  [AssistantActionId.STAFF_HOURS_SET]: write(
    'Change a staff member’s weekly hours',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Ravi staff ka Sunday off karo', 'Barber Ravi Monday 10 se 6 kaam karega'],
  ),
  [AssistantActionId.BOOKING_NO_SHOW]: write(
    'Mark an appointment as no-show',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Aaj 5 baje wala appointment no show'],
  ),
  [AssistantActionId.OFFERS_LIST]: read('Show offers', OWNERS, 'OWNER_ONLY', [
    'Offers dikhao',
  ]),
  [AssistantActionId.OFFERS_PAUSE]: write(
    'Pause an offer',
    OWNERS,
    'OWNER_ONLY',
    ['Diwali offer pause karo'],
  ),
  [AssistantActionId.OFFERS_PUBLISH]: write(
    'Publish an offer',
    OWNERS,
    'OWNER_ONLY',
    ['Diwali offer live karo'],
  ),
  [AssistantActionId.REVIEWS_LIST]: read(
    'Show reviews',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Reviews dikhao'],
  ),
  [AssistantActionId.REVIEWS_REPLY]: write(
    'Reply to a review',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Review ka jawab do: Thank you, phir aaiye!'],
  ),
  [AssistantActionId.INVOICES_LIST]: read(
    'Show invoices',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Invoices dikhao'],
  ),
  [AssistantActionId.REVENUE_REPORT]: read(
    'Revenue report',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Is hafte ki sales report', 'Is mahine ki kamai report'],
  ),
  // ---- batch 3: everyone
  [AssistantActionId.NOTIFICATIONS_LIST]: read(
    'Show my notifications',
    EVERYONE,
    'ANY_SIGNED_IN',
    ['Notifications dikhao'],
  ),
  [AssistantActionId.NOTIFICATIONS_READ_ALL]: write(
    'Mark all notifications read',
    EVERYONE,
    'ANY_SIGNED_IN',
    ['Sab notifications read karo'],
  ),
  // ---- batch 3: customer
  [AssistantActionId.MY_QUEUE_JOIN]: write(
    'Join this salon’s queue',
    CUSTOMERS,
    'SELF',
    ['Mujhe queue mein lagao haircut'],
  ),
  [AssistantActionId.MY_FAVORITES]: read(
    'Show my favorite salons',
    CUSTOMERS,
    'SELF',
    ['Meri favorite salons dikhao'],
  ),
  [AssistantActionId.MY_FAVORITE_ADD]: write(
    'Save this salon as a favorite',
    CUSTOMERS,
    'SELF',
    ['Is salon ko favorite karo'],
  ),
  [AssistantActionId.MY_FAVORITE_REMOVE]: write(
    'Remove a favorite salon',
    CUSTOMERS,
    'SELF',
    ['Favorite se hatao'],
  ),
  [AssistantActionId.MY_INVOICES]: read('Show my bills', CUSTOMERS, 'SELF', [
    'Mere bills dikhao',
  ]),
  // ---- batch 3: platform (read-only; the platform viewer included)
  [AssistantActionId.ADMIN_OVERVIEW]: read(
    'Platform overview (last 30 days)',
    PLATFORM_READERS,
    'PLATFORM',
    ['Platform overview dikhao'],
  ),
  [AssistantActionId.ADMIN_SHOP_STATUS]: read(
    'Which shops are open now',
    PLATFORM_READERS,
    'PLATFORM',
    ['Kitni shops open hain'],
  ),
  // ---- batch 4: explicit choices and stronger confirmations
  [AssistantActionId.QUEUE_ASSIGN]: write(
    'Seat a customer with a barber and chair',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Token 5 Ravi Chair 1 assign karo'],
  ),
  [AssistantActionId.QUEUE_START]: write(
    'Start a service',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Token 5 start karo'],
  ),
  [AssistantActionId.BOOKING_IN_SHOP]: write(
    'Book an appointment for a walk-up caller',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['Amit ke liye kal 5 baje haircut appointment book karo'],
  ),
  [AssistantActionId.BOOKING_CORRECT_COMPLETED]: write(
    'Correct a no-show to completed',
    SHOP_TEAM,
    'STAFF_OR_ADMIN',
    ['5 baje wala appointment no show galat tha, completed karo'],
  ),
  // ---- batch 5: offers, shop profile, customer review, language
  [AssistantActionId.OFFERS_CREATE]: write(
    'Create an offer (as a draft)',
    OWNERS,
    'OWNER_ONLY',
    ['Diwali offer banao 20% off 10 din ke liye'],
  ),
  [AssistantActionId.OFFERS_EDIT]: write(
    'Change an offer’s discount or end date',
    OWNERS,
    'OWNER_ONLY',
    ['Diwali offer 25% karo', 'Diwali offer 30 nov tak badhao'],
  ),
  [AssistantActionId.SALON_PROFILE_VIEW]: read(
    'Show my shop profile',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Dukaan ki profile dikhao'],
  ),
  [AssistantActionId.SALON_PROFILE_SET]: write(
    'Change shop description, phone, email or address',
    SHOP_MANAGERS,
    'OWNER_OR_ADMIN',
    ['Dukaan ka description badlo: Best haircuts in town'],
  ),
  [AssistantActionId.REVIEW_WRITE]: write(
    'Review a completed visit',
    CUSTOMERS,
    'SELF',
    ['Haircut ko 5 star review do: bahut badiya'],
  ),
  [AssistantActionId.LANGUAGE_SET]: write(
    'Change my app language',
    EVERYONE,
    'ANY_SIGNED_IN',
    ['Meri language Hindi karo'],
  ),
};
