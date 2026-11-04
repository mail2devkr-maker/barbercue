import { AssistantActionId, StaffMemberStatus } from '@barbercue/shared';
import {
  Reply,
  maskPhone,
  pick,
  rupees,
  staleReply,
  type HandlerMap,
  type PlanCtx,
  text,
} from './kit';

/** Staff and services: list, add, status, rename, price, duration, archive/restore. */

const staffList = (c: PlanCtx) => c.deps.staff.list(c.user.id, c.salonId);
const serviceList = (
  c: PlanCtx | { user: { id: string }; salonId: string; deps: PlanCtx['deps'] },
) => c.deps.services.list(c.user.id, c.salonId);

export const SHOP_CATALOG_HANDLERS: HandlerMap = {
  [AssistantActionId.STAFF_LIST]: {
    async plan(c) {
      const rows = await staffList(c);
      return {
        status: 'DONE',
        message: `${rows.length} staff member${rows.length === 1 ? '' : 's'}.`,
        result: {
          summary: `${rows.filter((s) => s.status === StaffMemberStatus.ACTIVE).length} active`,
          items: rows.map((s) => ({
            id: s.id,
            title: s.displayName,
            detail: s.status === 'ACTIVE' ? 'Active' : 'Inactive',
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/staff`,
      };
    },
  },

  [AssistantActionId.STAFF_ADD]: {
    async plan(c, p) {
      const name = p.name as string | null;
      const phone = p.phone as string | null;
      if (!name)
        return {
          status: 'NEEDS_INPUT',
          message:
            'What is the new staff member’s name? For example "Ravi ko staff mein add karo".',
        };
      const same = (await staffList(c)).filter(
        (s) => s.displayName.toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      return c.seal(
        { displayName: name, ...(phone ? { phone } : {}) },
        { same: same.map((s) => s.id) },
        [
          { label: 'Name', before: null, after: name },
          {
            label: 'Mobile',
            before: null,
            after: maskPhone(phone) ?? 'not given',
          },
          { label: 'Status', before: null, after: 'Active' },
        ],
        same.length
          ? `${name} is already on your staff list. Confirm only if this is a different person.`
          : undefined,
      );
    },
    async execute(c) {
      const name = String(c.payload.displayName);
      const same = (await c.deps.staff.list(c.user.id, c.salonId))
        .filter(
          (r) => r.displayName.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
        .map((r) => r.id);
      c.assertUnchanged({ same });
      const { staff } = await c.deps.staff.create(c.user.id, c.salonId, {
        displayName: name,
        ...(c.payload.phone ? { phone: text(c.payload.phone) } : {}),
      });
      return c.done(
        `${staff.displayName} was added to your staff.`,
        'staff',
        staff.id,
        [{ label: 'Name', before: null, after: staff.displayName }],
      );
    },
  },

  [AssistantActionId.STAFF_SET_STATUS]: {
    async plan(c, p) {
      const active = p.active === true;
      const target = pick(
        await staffList(c),
        c.text,
        (s) => s.displayName,
        'Which staff member?',
        (s) => `${active ? 'Activate' : 'Deactivate'} staff ${s.displayName}`,
      );
      const next = active
        ? StaffMemberStatus.ACTIVE
        : StaffMemberStatus.INACTIVE;
      if (target.status === next)
        return {
          status: 'DONE',
          message: `${target.displayName} is already ${active ? 'active' : 'inactive'}. Nothing was changed.`,
        };
      return c.seal(
        { staffId: target.id, status: next },
        { id: target.id, status: target.status },
        [
          {
            label: target.displayName,
            before: target.status === 'ACTIVE' ? 'Active' : 'Inactive',
            after: active ? 'Active' : 'Inactive',
          },
        ],
        active
          ? undefined
          : 'They will no longer be assigned new customers. Their history is kept and you can activate them again.',
      );
    },
    async execute(c) {
      const row = (await c.deps.staff.list(c.user.id, c.salonId)).find(
        (r) => r.id === c.payload.staffId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, status: row.status });
      const updated = await c.deps.staff.update(c.user.id, c.salonId, row.id, {
        status: c.payload.status as StaffMemberStatus,
      });
      const label = updated.status === 'ACTIVE' ? 'Active' : 'Inactive';
      return c.done(
        `${updated.displayName} is now ${label.toLowerCase()}.`,
        'staff',
        updated.id,
        [
          {
            label: updated.displayName,
            before: row.status === 'ACTIVE' ? 'Active' : 'Inactive',
            after: label,
          },
        ],
      );
    },
  },

  [AssistantActionId.STAFF_RENAME]: {
    async plan(c, p) {
      const newName = p.newName as string | null;
      const rows = await staffList(c);
      const target = pick(
        rows,
        text(p.target) || c.text,
        (s) => s.displayName,
        'Which staff member should I rename?',
        (s) => `Rename staff ${s.displayName} to ${newName ?? '...'}`,
      );
      if (!newName)
        return {
          status: 'NEEDS_INPUT',
          message: `What should ${target.displayName}'s new name be? For example "Rename staff ${target.displayName} to ${target.displayName} Kumar".`,
        };
      if (newName === target.displayName)
        return {
          status: 'DONE',
          message: 'That is already the name. Nothing was changed.',
        };
      return c.seal(
        { staffId: target.id, displayName: newName },
        { id: target.id, displayName: target.displayName },
        [{ label: 'Staff name', before: target.displayName, after: newName }],
      );
    },
    async execute(c) {
      const row = (await c.deps.staff.list(c.user.id, c.salonId)).find(
        (r) => r.id === c.payload.staffId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, displayName: row.displayName });
      const updated = await c.deps.staff.update(c.user.id, c.salonId, row.id, {
        displayName: String(c.payload.displayName),
      });
      return c.done(
        `${row.displayName} is now ${updated.displayName}.`,
        'staff',
        updated.id,
        [
          {
            label: 'Staff name',
            before: row.displayName,
            after: updated.displayName,
          },
        ],
      );
    },
  },

  [AssistantActionId.SERVICE_LIST]: {
    async plan(c) {
      const rows = await serviceList(c);
      return {
        status: 'DONE',
        message: `${rows.filter((s) => s.isActive).length} active services.`,
        result: {
          summary: `${rows.length} services in total`,
          items: rows.map((s) => ({
            id: s.id,
            title: s.name,
            detail: `${rupees(s.price)} · ${s.durationMinutes} min${s.isActive ? '' : ' · archived'}`,
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/services`,
      };
    },
  },

  [AssistantActionId.SERVICE_ADD]: {
    async plan(c, p) {
      const name = p.name as string | null;
      const price = p.price as number | null;
      if (!name || price === null) {
        return {
          status: 'NEEDS_INPUT',
          message:
            'Tell me the service name and price, for example "Beard trim service add karo ₹100 20 minute".',
        };
      }
      const duration = (p.durationMinutes as number | null) ?? 30;
      const rows = await serviceList(c);
      if (
        rows.some(
          (s) =>
            s.isActive &&
            s.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      ) {
        return {
          status: 'NEEDS_INPUT',
          message: `${name} already exists. To change its price say "${name} price ${price} karo".`,
        };
      }
      return c.seal(
        { name, price, durationMinutes: duration },
        { names: rows.map((s) => s.name).sort() },
        [
          { label: 'Service', before: null, after: name },
          { label: 'Price', before: null, after: rupees(price) },
          {
            label: 'Duration',
            before: null,
            after: `${duration} min${p.durationMinutes ? '' : ' (default)'}`,
          },
        ],
      );
    },
    async execute(c) {
      const rows = await c.deps.services.list(c.user.id, c.salonId);
      c.assertUnchanged({ names: rows.map((r) => r.name).sort() });
      const created = await c.deps.services.create(c.user.id, c.salonId, {
        name: String(c.payload.name),
        price: Number(c.payload.price),
        durationMinutes: Number(c.payload.durationMinutes),
      });
      return c.done(
        `${created.name} was added at ${rupees(created.price)}.`,
        'services',
        created.id,
        [
          {
            label: created.name,
            before: null,
            after: `${rupees(created.price)} · ${created.durationMinutes} min`,
          },
        ],
      );
    },
  },

  [AssistantActionId.SERVICE_SET_PRICE]: {
    async plan(c, p) {
      const to = p.to as number | null;
      const from = p.from as number | null;
      const percent = p.percent as number | null;
      const delta = p.delta as number | null;
      const direction = p.direction as 'up' | 'down' | null;
      const rows = (await serviceList(c)).filter((s) => s.isActive);
      const target = pick(
        rows,
        c.text,
        (s) => s.name,
        'Which service?',
        (s) =>
          `${s.name} price ${to ?? ''}${percent ? `${percent}% ${direction === 'down' ? 'ghata do' : 'badha do'}` : ''}`.trim(),
      );
      if (from !== null && Math.abs(from - target.price) > 0.001) {
        return {
          status: 'NEEDS_INPUT',
          message: `${target.name} is ${rupees(target.price)} right now, not ${rupees(from)}. Say the new price again to continue.`,
          options:
            to !== null
              ? [
                  {
                    label: `${target.name} → ${rupees(to)}`,
                    text: `${target.name} price ${to} karo`,
                  },
                ]
              : undefined,
        };
      }
      if (percent !== null && !direction) {
        return {
          status: 'NEEDS_INPUT',
          message: `Increase or decrease ${target.name} by ${percent}%?`,
          options: [
            {
              label: `Increase ${percent}%`,
              text: `${target.name} price ${percent}% badha do`,
            },
            {
              label: `Decrease ${percent}%`,
              text: `${target.name} price ${percent}% ghata do`,
            },
          ],
        };
      }
      let next: number | null = to;
      if (next === null && percent !== null && direction)
        next = Math.round(
          target.price * (1 + (direction === 'up' ? 1 : -1) * (percent / 100)),
        );
      else if (next === null && delta !== null && direction)
        next = target.price + (direction === 'up' ? 1 : -1) * delta;
      if (next === null)
        return {
          status: 'NEEDS_INPUT',
          message: `What should the new price of ${target.name} be? It is ${rupees(target.price)} now.`,
        };
      if (next < 0 || next > 1_000_000)
        return {
          status: 'FAILED',
          message:
            'That price is outside the allowed range. Nothing was changed.',
        };
      if (Math.abs(next - target.price) < 0.001)
        return {
          status: 'DONE',
          message: `${target.name} is already ${rupees(next)}. Nothing was changed.`,
        };
      return c.seal(
        { serviceId: target.id, price: next },
        { id: target.id, price: target.price, isActive: true },
        [
          {
            label: `${target.name} price`,
            before: rupees(target.price),
            after: rupees(next),
          },
        ],
        'New bookings use the new price. Existing bookings keep the price they were made at.',
      );
    },
    async execute(c) {
      const row = (await c.deps.services.list(c.user.id, c.salonId)).find(
        (r) => r.id === c.payload.serviceId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({
        id: row.id,
        price: row.price,
        isActive: row.isActive,
      });
      const updated = await c.deps.services.update(
        c.user.id,
        c.salonId,
        row.id,
        { price: Number(c.payload.price) },
      );
      return c.done(
        `${updated.name} now costs ${rupees(updated.price)}.`,
        'services',
        updated.id,
        [
          {
            label: `${updated.name} price`,
            before: rupees(row.price),
            after: rupees(updated.price),
          },
        ],
      );
    },
  },

  [AssistantActionId.SERVICE_SET_DURATION]: {
    async plan(c, p) {
      const minutes = p.minutes as number | null;
      const rows = (await serviceList(c)).filter((s) => s.isActive);
      const target = pick(
        rows,
        c.text,
        (s) => s.name,
        'Which service?',
        (s) => `${s.name} ${minutes ?? 30} minute karo`,
      );
      if (minutes === null || minutes < 5 || minutes > 480)
        return {
          status: 'NEEDS_INPUT',
          message: 'Give a duration between 5 and 480 minutes.',
        };
      if (minutes === target.durationMinutes)
        return {
          status: 'DONE',
          message: `${target.name} already takes ${minutes} min. Nothing was changed.`,
        };
      return c.seal(
        { serviceId: target.id, durationMinutes: minutes },
        { id: target.id, durationMinutes: target.durationMinutes },
        [
          {
            label: `${target.name} duration`,
            before: `${target.durationMinutes} min`,
            after: `${minutes} min`,
          },
        ],
        'New bookings use the new duration. Existing bookings keep their times.',
      );
    },
    async execute(c) {
      const row = (await c.deps.services.list(c.user.id, c.salonId)).find(
        (r) => r.id === c.payload.serviceId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, durationMinutes: row.durationMinutes });
      const updated = await c.deps.services.update(
        c.user.id,
        c.salonId,
        row.id,
        { durationMinutes: Number(c.payload.durationMinutes) },
      );
      return c.done(
        `${updated.name} now takes ${updated.durationMinutes} min.`,
        'services',
        updated.id,
        [
          {
            label: `${updated.name} duration`,
            before: `${row.durationMinutes} min`,
            after: `${updated.durationMinutes} min`,
          },
        ],
      );
    },
  },

  [AssistantActionId.SERVICE_RENAME]: {
    async plan(c, p) {
      const newName = p.newName as string | null;
      const rows = await serviceList(c);
      const target = pick(
        rows,
        text(p.target) || c.text,
        (s) => s.name,
        'Which service should I rename?',
        (s) => `Rename service ${s.name} to ${newName ?? '...'}`,
      );
      if (!newName)
        return {
          status: 'NEEDS_INPUT',
          message: `What should ${target.name} be called? For example "Rename service ${target.name} to Premium ${target.name}".`,
        };
      if (
        rows.some(
          (s) =>
            s.id !== target.id &&
            s.name.toLocaleLowerCase() === newName.toLocaleLowerCase(),
        )
      ) {
        return {
          status: 'NEEDS_INPUT',
          message: `Another service is already called ${newName}. Choose a different name.`,
        };
      }
      return c.seal(
        { serviceId: target.id, name: newName },
        { id: target.id, name: target.name },
        [{ label: 'Service name', before: target.name, after: newName }],
      );
    },
    async execute(c) {
      const row = (await c.deps.services.list(c.user.id, c.salonId)).find(
        (r) => r.id === c.payload.serviceId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, name: row.name });
      const updated = await c.deps.services.update(
        c.user.id,
        c.salonId,
        row.id,
        { name: String(c.payload.name) },
      );
      return c.done(
        `${row.name} is now called ${updated.name}.`,
        'services',
        updated.id,
        [{ label: 'Service name', before: row.name, after: updated.name }],
      );
    },
  },

  [AssistantActionId.SERVICE_ARCHIVE]: archiveHandler(true),
  [AssistantActionId.SERVICE_RESTORE]: archiveHandler(false),
};

function archiveHandler(
  archive: boolean,
): NonNullable<HandlerMap[typeof AssistantActionId.SERVICE_ARCHIVE]> {
  return {
    async plan(c) {
      const rows = (await serviceList(c)).filter((s) => s.isActive === archive);
      if (!rows.length)
        throw new Reply({
          status: 'NEEDS_INPUT',
          message: archive
            ? 'There are no active services to remove.'
            : 'There are no archived services to restore.',
        });
      const target = pick(
        rows,
        c.text,
        (s) => s.name,
        archive
          ? 'Which service should I remove?'
          : 'Which service should I restore?',
        (s) => `${s.name} service ${archive ? 'hata do' : 'wapas chalu karo'}`,
      );
      return c.seal(
        { serviceId: target.id, isActive: !archive },
        { id: target.id, isActive: target.isActive },
        [
          {
            label: target.name,
            before: archive ? 'Bookable' : 'Archived',
            after: archive ? 'Archived' : 'Bookable',
          },
        ],
        archive
          ? 'Customers can no longer book it. Past bookings are kept, and you can restore it any time.'
          : undefined,
      );
    },
    async execute(c) {
      const row = (await c.deps.services.list(c.user.id, c.salonId)).find(
        (r) => r.id === c.payload.serviceId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, isActive: row.isActive });
      const updated = await c.deps.services.update(
        c.user.id,
        c.salonId,
        row.id,
        { isActive: Boolean(c.payload.isActive) },
      );
      return c.done(
        `${updated.name} is now ${updated.isActive ? 'bookable again' : 'archived'}.`,
        'services',
        updated.id,
        [
          {
            label: updated.name,
            before: row.isActive ? 'Bookable' : 'Archived',
            after: updated.isActive ? 'Bookable' : 'Archived',
          },
        ],
      );
    },
  };
}
