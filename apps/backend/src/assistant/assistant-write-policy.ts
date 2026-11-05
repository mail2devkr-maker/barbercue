import { AssistantActionId, type AssistantPreviewRow } from '@barbercue/shared';

/**
 * Issue #372: the single policy every Assistant WRITE goes through, for current and future actions.
 *
 *  1. The first command NEVER changes data. While a write is being previewed, the handler gets a
 *     READ-ONLY view of the services (`readOnly`): any data-changing call throws, and nothing is written.
 *     The only way to change data is the sealed, single-use confirmation, which re-checks the release
 *     gate, the shop/action allowlist, roles and shop ownership, and the record's before-state.
 *  2. Every preview asks a plain question: "Kya aap sach mein ... chahte hain?" plus Before → After.
 *  3. HIGH-RISK actions (deactivate, remove, cancel, price and hours changes...) carry a consequence
 *     warning and need an extra on-screen acknowledgement, enforced on the server at confirmation.
 *  4. Voice never confirms: "haan / yes / ok" is never a confirmation; only the Confirm button is.
 */
const A = AssistantActionId;

export const HIGH_RISK = new Set<string>([
  A.STAFF_SET_STATUS,
  A.SERVICE_ARCHIVE,
  A.SERVICE_SET_PRICE,
  A.CHAIRS_SET_STATUS,
  A.HOURS_SET,
  A.STAFF_HOURS_SET,
  A.QUEUE_NO_SHOW,
  A.QUEUE_CANCEL,
  A.BOOKING_CANCEL_BY_SHOP,
  A.BOOKING_RESCHEDULE_BY_SHOP,
  A.BOOKING_NO_SHOW,
  A.BOOKING_CORRECT_COMPLETED,
  A.MY_BOOKING_CANCEL,
  A.MY_BOOKING_RESCHEDULE,
  A.MY_QUEUE_LEAVE,
  A.OFFERS_PAUSE,
  A.SALON_PROFILE_SET,
  A.AUTO_ASSIGN_SET,
]);

/** What a high-risk change does beyond the row itself, in plain words (Hinglish + English). */
const CONSEQUENCE: Record<string, string> = {
  [A.STAFF_SET_STATUS]:
    'Inactive staff ko nayi bookings aur queue mein assign nahi kiya jayega. (Their existing records stay; this is not a permanent delete.)',
  [A.SERVICE_ARCHIVE]:
    'Customers yeh service book nahi kar payenge. (The service is hidden, not permanently deleted; it can be restored.)',
  [A.SERVICE_SET_PRICE]:
    'Nayi bookings is nayi price par hongi. (New bookings use the new price.)',
  [A.CHAIRS_SET_STATUS]:
    'Shop ki available chairs kam ya zyada ho jayengi. (This changes how many chairs can be used; it is not a permanent delete.)',
  [A.HOURS_SET]:
    'Customers ko naye timings dikhenge aur booking slots badal jayenge.',
  [A.STAFF_HOURS_SET]: 'Is staff ke booking slots badal jayenge.',
  [A.QUEUE_NO_SHOW]: 'Customer ko no-show mark kiya jayega.',
  [A.QUEUE_CANCEL]: 'Customer queue se hata diya jayega.',
  [A.BOOKING_CANCEL_BY_SHOP]:
    'Booking cancel ho jayegi aur customer ka slot chala jayega.',
  [A.BOOKING_RESCHEDULE_BY_SHOP]: 'Customer ki booking ka time badal jayega.',
  [A.BOOKING_NO_SHOW]: 'Booking no-show mark ho jayegi.',
  [A.BOOKING_CORRECT_COMPLETED]:
    'Ek complete ho chuki booking ka record badlega.',
  [A.MY_BOOKING_CANCEL]: 'Aapki booking cancel ho jayegi.',
  [A.MY_BOOKING_RESCHEDULE]: 'Aapki booking ka time badal jayega.',
  [A.MY_QUEUE_LEAVE]: 'Aap queue se bahar ho jayenge aur apni jagah kho denge.',
  [A.OFFERS_PAUSE]: 'Offer customers ko dikhna band ho jayega.',
  [A.SALON_PROFILE_SET]: 'Shop ki public jaankari badal jayegi.',
  [A.AUTO_ASSIGN_SET]: 'Queue mein staff assignment ka tarika badal jayega.',
};

export function isHighRisk(actionId: string): boolean {
  return HIGH_RISK.has(actionId);
}

export function consequenceFor(actionId: string): string | undefined {
  return CONSEQUENCE[actionId];
}

const clean = (v: string | null | undefined) => (v ?? '').toString().trim();

/**
 * The confirmation question shown on screen and spoken in a voice conversation. Built from the
 * exact preview rows, so it names the real target and values (never a guess).
 */
export function confirmationQuestion(
  actionId: string,
  title: string,
  rows: AssistantPreviewRow[],
): string {
  const r = rows[0];
  const label = clean(r?.label);
  const before = clean(r?.before);
  const after = clean(r?.after);
  const subject = label.replace(
    /\s+(status|price|name|duration|hours|timing|timings)$/i,
    '',
  );
  if (actionId === A.SERVICE_SET_PRICE && before && after)
    return `Kya aap ${subject} ki price ${before} se ${after} karna chahte hain?`;
  if (
    (actionId === A.CHAIRS_SET_STATUS || actionId === A.STAFF_SET_STATUS) &&
    after
  ) {
    const off = /off|inactive|band|repair|maintenance|removed|hata/i.test(
      after,
    );
    const what =
      actionId === A.CHAIRS_SET_STATUS
        ? subject || 'is chair'
        : subject || 'is staff member';
    return off
      ? `Kya aap sach mein ${what} ko hatana (${after}) chahte hain?`
      : `Kya aap sach mein ${what} ko wapas chalu (${after}) karna chahte hain?`;
  }
  if (actionId === A.SERVICE_ARCHIVE)
    return `Kya aap sach mein ${subject || 'yeh service'} hatana chahte hain?`;
  if (actionId === A.BOOKING_CANCEL_BY_SHOP || actionId === A.MY_BOOKING_CANCEL)
    return `Kya aap sach mein ${subject || 'yeh booking'} cancel karna chahte hain?`;
  if (label && after && before)
    return `Kya aap sach mein ${label} ko ${before} se ${after} karna chahte hain?`;
  if (label && after)
    return `Kya aap sach mein ${label}: ${after} karna chahte hain?`;
  return `Kya aap sach mein yeh badlav karna chahte hain: ${title}?`;
}

export const PREVIEW_FOOTER =
  'Neeche Before → After dekhiye aur screen par Confirm ya Cancel dabaiye. Abhi kuch bhi change nahi hua hai. (Nothing has changed yet.)';
export const CANCELLED_MESSAGE =
  'Cancelled, kuch bhi change nahi hua. (Nothing was changed.)';
export const EDIT_DISABLED_MESSAGE =
  'Editing is disabled for this testing account; nothing was changed. Is account par Assistant se badlav band hai; kuch bhi change nahi hua.';
export const ACK_REQUIRED_MESSAGE =
  'Yeh ek bada badlav hai. Pehle "Main samajhta/samajhti hoon" box tick kijiye, phir Confirm dabaiye. Nothing was changed.';
export const VOICE_YES_MESSAGE =
  'Badlav sirf screen par Confirm button dabane se hota hai, "haan" bolne se nahi. Kuch bhi change nahi hua. (Changes are confirmed only with the on-screen button.)';

/** "haan", "yes", "ok", "confirm"... alone: never a confirmation. */
export const BARE_YES =
  /^(?:haan|haa|han|ha|haan ji|ji haan|ji|yes|yeah|yep|ok|okay|okk|confirm|confirmed|kar do|kardo|kar dijiye|theek hai|thik hai|sure|done|go ahead|हाँ|हां|हा|जी हाँ|जी हां|ओके|ठीक है|कर दो)$/u;

export function isBareYes(text: string): boolean {
  const t = text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return BARE_YES.test(t);
}

// ---------------------------------------------------------------- read-only services for previews

export class PreviewMutationError extends Error {
  constructor(readonly method: string) {
    super(
      `A data-changing call (${method}) was attempted while previewing; refused.`,
    );
  }
}

// Method names that change data. Reads (get, list, find, count, summarize...) pass through.
const MUTATING =
  /^(create|update|upsert|delete|remove|set|add|archive|restore|rename|cancel|reschedule|mark|call|complete|take|assign|start|end|close|open|publish|pause|resume|reply|join|leave|approve|reject|toggle|record|issue|refund|book|correct|log|schedule|save|send|apply|confirm|execute|import|activate|deactivate|clear|reset|write|edit|insert|move|transfer)(?=[A-Z]|$)/;
const PRISMA_WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  '$executeRaw',
  '$executeRawUnsafe',
  '$transaction',
]);

function guard<T extends object>(
  target: T,
  path: string,
  prismaLike: boolean,
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver) as unknown;
      if (typeof prop !== 'string') return value;
      const name = `${path}.${prop}`;
      if (typeof value === 'function') {
        if (prismaLike ? PRISMA_WRITES.has(prop) : MUTATING.test(prop))
          return () => {
            throw new PreviewMutationError(name);
          };
        return (value as (...a: unknown[]) => unknown).bind(obj);
      }
      // Prisma model delegates (prisma.chair, prisma.salon...) are objects: guard their methods too.
      if (prismaLike && value && typeof value === 'object')
        return guard(value as object, name, true);
      return value;
    },
  });
}

/** The services a write PREVIEW may use: reads only. Any data-changing method throws. */
export function readOnly<D extends Record<string, unknown>>(deps: D): D {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(deps))
    out[k] =
      v && typeof v === 'object' ? guard(v as object, k, k === 'prisma') : v;
  return out as D;
}
