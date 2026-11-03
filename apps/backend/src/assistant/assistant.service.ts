import { ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AssistantActionId,
  Role,
  StaffMemberStatus,
  type AssistantCapabilityDto,
  type AssistantConfirmationInput,
  type AssistantPreviewRow,
  type AssistantResource,
  type AssistantTurnDto,
  type AssistantTurnInput,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { utcToZonedDateStr } from '../common/timezone/timezone';
import { SalonServicesService } from '../salon-setup/salon-services.service';
import { SalonStaffService } from '../salon-setup/salon-staff.service';
import { QueueService } from '../queue/queue.service';
import { OwnerAssistantService } from '../owner-ops/owner-assistant.service';
import { CustomerAssistantSearchService } from '../salons/customer-assistant-search.service';
import { matchByName, type ParsedIntent } from './assistant-parser';
import { ASSISTANT_INTERPRETER, type IntentInterpreter } from './assistant-interpreter.token';
import { ConfirmationLedger, fingerprint, type SealedWrite } from './assistant-confirmation';

type Access = 'OWNER_OR_ADMIN' | 'STAFF_OR_ADMIN' | 'ANY_SIGNED_IN';

interface ActionDef {
  title: string;
  kind: 'READ' | 'WRITE';
  confirm: boolean;
  // Session roles that may even ask for it; the shop-level check below is the real gate.
  roles: Role[];
  access: Access;
  examples: string[];
}

const SHOP_MANAGERS: Role[] = [Role.SALON_OWNER, Role.PLATFORM_ADMIN];
const SHOP_TEAM: Role[] = [Role.SALON_OWNER, Role.SALON_STAFF, Role.PLATFORM_ADMIN];

/** The allowlist. Anything not here cannot be executed, whatever the words say. */
export const ASSISTANT_ACTIONS: Record<AssistantActionId, ActionDef> = {
  [AssistantActionId.STAFF_LIST]: {
    title: 'Show staff', kind: 'READ', confirm: false, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Staff dikhao', 'Show my staff'],
  },
  [AssistantActionId.STAFF_ADD]: {
    title: 'Add a staff member', kind: 'WRITE', confirm: true, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Ravi ko staff mein add karo', 'Add Ravi as staff 9876543210'],
  },
  [AssistantActionId.STAFF_SET_STATUS]: {
    title: 'Activate or deactivate staff', kind: 'WRITE', confirm: true, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Ravi staff ko deactivate karo', 'Activate staff Ravi'],
  },
  [AssistantActionId.SERVICE_LIST]: {
    title: 'Show services', kind: 'READ', confirm: false, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Services dikhao', 'List my services'],
  },
  [AssistantActionId.SERVICE_ADD]: {
    title: 'Add a service', kind: 'WRITE', confirm: true, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Beard trim service add karo ₹100 20 minute', 'Add service Head massage 250 rupees 30 minutes'],
  },
  [AssistantActionId.SERVICE_SET_PRICE]: {
    title: 'Change a service price', kind: 'WRITE', confirm: true, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Haircut ₹200 se ₹150 karo', 'Massage price 10% badha do', 'Set facial price to 500'],
  },
  [AssistantActionId.SERVICE_ARCHIVE]: {
    title: 'Remove (archive) a service', kind: 'WRITE', confirm: true, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Facial service hata do', 'Remove facial'],
  },
  [AssistantActionId.SERVICE_RESTORE]: {
    title: 'Restore an archived service', kind: 'WRITE', confirm: true, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Facial service wapas chalu karo'],
  },
  [AssistantActionId.QUEUE_STATUS]: {
    title: 'Show the live queue', kind: 'READ', confirm: false, roles: SHOP_TEAM, access: 'STAFF_OR_ADMIN',
    examples: ['Aaj ki queue dikhao', 'Who is waiting?'],
  },
  [AssistantActionId.TODAY_INSIGHTS]: {
    title: "Today's sales and summary", kind: 'READ', confirm: false, roles: SHOP_MANAGERS, access: 'OWNER_OR_ADMIN',
    examples: ['Aaj ki sales batao', "Today's summary"],
  },
  [AssistantActionId.SALON_SEARCH]: {
    title: 'Find a salon', kind: 'READ', confirm: false, roles: Object.values(Role), access: 'ANY_SIGNED_IN',
    examples: ['Haircut salon dhoondo', 'Find salons for facial in Ghaziabad'],
  },
};

const UNRELEASED: Record<'inventory' | 'onboarding', string> = {
  inventory: 'Inventory actions will be available after the Inventory release is live. Nothing was changed.',
  onboarding: 'Salon onboarding actions will be available after the Onboarding release is live. Nothing was changed.',
};

const rupees = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}••••••${p.slice(-2)}` : null);

class Reply extends Error {
  constructor(readonly turn: Partial<AssistantTurnDto>) {
    super(turn.message ?? '');
  }
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  readonly ledger = new ConfirmationLedger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalonAccessService,
    private readonly services: SalonServicesService,
    private readonly staff: SalonStaffService,
    private readonly queue: QueueService,
    private readonly insights: OwnerAssistantService,
    private readonly search: CustomerAssistantSearchService,
    @Inject(ASSISTANT_INTERPRETER) private readonly interpreter: IntentInterpreter,
  ) {}

  capabilities(user: AuthenticatedUser): AssistantCapabilityDto[] {
    return (Object.entries(ASSISTANT_ACTIONS) as Array<[AssistantActionId, ActionDef]>).map(([id, def]) => ({
      id,
      title: def.title,
      kind: def.kind,
      confirmation: def.confirm,
      state: def.roles.some((r) => user.roles.includes(r)) ? 'SUPPORTED' : 'DENIED',
      examples: def.examples,
    }));
  }

  async turn(user: AuthenticatedUser, input: AssistantTurnInput): Promise<AssistantTurnDto> {
    const requestId = randomUUID();
    const parsed = await this.interpreter.interpret(input.text);
    if (!parsed) {
      return this.finish(requestId, null, {
        status: 'UNSUPPORTED',
        message: "I didn't understand that as a FastQue action. Try one of these.",
        options: this.capabilities(user)
          .filter((c) => c.state === 'SUPPORTED')
          .slice(0, 6)
          .map((c) => ({ label: c.examples[0], text: c.examples[0] })),
      });
    }
    if (parsed.action === 'unreleased') {
      return this.finish(requestId, null, { status: 'UNAVAILABLE', message: UNRELEASED[parsed.feature] });
    }
    const actionId = parsed.action;
    const def = ASSISTANT_ACTIONS[actionId];
    const salonId = input.salonId ?? null;
    try {
      await this.authorize(user, actionId, salonId);
      const turn = await this.plan(user, parsed, salonId, input.text);
      await this.audit(user.id, salonId, requestId, actionId, def.kind === 'READ' ? 'READ' : 'PREVIEW', turn.status ?? 'DONE', {
        inputMode: input.inputMode,
        interpreter: this.interpreter.name,
      });
      return this.finish(requestId, actionId, turn);
    } catch (err) {
      return this.failure(user.id, salonId, requestId, actionId, err);
    }
  }

  async confirm(user: AuthenticatedUser, input: AssistantConfirmationInput): Promise<AssistantTurnDto> {
    const requestId = randomUUID();
    const sealed = this.ledger.open(input.token, user.id);
    if (typeof sealed === 'string') {
      const why =
        sealed === 'EXPIRED'
          ? 'That confirmation expired. Ask again to see a fresh preview.'
          : sealed === 'USED'
            ? 'That confirmation was already used. Nothing was changed again.'
            : 'That confirmation is not valid for your account. Nothing was changed.';
      await this.audit(user.id, null, requestId, null, 'CONFIRM', `REFUSED_${sealed}`, {});
      return this.finish(requestId, null, { status: 'FAILED', message: why });
    }
    const actionId = sealed.actionId as AssistantActionId;
    if (!(actionId in ASSISTANT_ACTIONS) || ASSISTANT_ACTIONS[actionId].kind !== 'WRITE') {
      return this.finish(requestId, null, { status: 'FAILED', message: 'That confirmation is not valid. Nothing was changed.' });
    }
    if (input.decision === 'cancel') {
      await this.audit(user.id, sealed.salonId, requestId, actionId, 'CANCEL', 'CANCELLED', {});
      return this.finish(requestId, actionId, { status: 'CANCELLED', message: 'Cancelled. Nothing was changed.' });
    }
    try {
      // Re-check now, for this session: roles or shop membership may have changed since the preview.
      await this.authorize(user, actionId, sealed.salonId);
      const turn = await this.execute(user, sealed);
      await this.audit(user.id, sealed.salonId, requestId, actionId, 'EXECUTE', 'APPLIED', {
        changed: turn.result?.changed,
        rows: turn.preview?.rows,
      });
      return this.finish(requestId, actionId, turn);
    } catch (err) {
      return this.failure(user.id, sealed.salonId, requestId, actionId, err);
    }
  }

  // ---------------------------------------------------------------- authorization

  private async authorize(user: AuthenticatedUser, actionId: AssistantActionId, salonId: string | null) {
    const def = ASSISTANT_ACTIONS[actionId];
    if (!def.roles.some((r) => user.roles.includes(r))) throw new ForbiddenException('role');
    if (def.access === 'ANY_SIGNED_IN') return;
    if (!salonId) {
      throw new Reply({ status: 'NEEDS_INPUT', message: 'Open the shop you want to work on first, then ask again.' });
    }
    if (def.access === 'OWNER_OR_ADMIN') await this.access.assertOwnerOrAdminAccess(user.id, salonId);
    else await this.access.assertAccessOrAdminAccess(user.id, salonId);
  }

  // ---------------------------------------------------------------- planning (reads run, writes preview)

  private async plan(
    user: AuthenticatedUser,
    p: Exclude<ParsedIntent, { action: 'unreleased' }>,
    salonId: string | null,
    text: string,
  ): Promise<Partial<AssistantTurnDto>> {
    const sid = salonId as string;
    switch (p.action) {
      case AssistantActionId.STAFF_LIST: {
        const rows = await this.staff.list(user.id, sid);
        return {
          status: 'DONE',
          message: `${rows.length} staff member${rows.length === 1 ? '' : 's'}.`,
          result: {
            summary: `${rows.filter((s) => s.status === StaffMemberStatus.ACTIVE).length} active`,
            items: rows.map((s) => ({ id: s.id, title: s.displayName, detail: s.status === 'ACTIVE' ? 'Active' : 'Inactive' })),
          },
          navigateTo: `/dashboard/salons/${sid}/staff`,
        };
      }
      case AssistantActionId.SERVICE_LIST: {
        const rows = await this.services.list(user.id, sid);
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
          navigateTo: `/dashboard/salons/${sid}/services`,
        };
      }
      case AssistantActionId.QUEUE_STATUS: {
        const q = await this.queue.getDashboardQueue(user.id, sid);
        const waiting = q.entries
          .filter((e) => e.position !== null)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const c = q.counts;
        return {
          status: 'DONE',
          message: c
            ? `${c.waiting} waiting, ${c.inService} in service, ${c.completedToday} completed today.`
            : `${waiting.length} waiting.`,
          result: {
            summary: `${waiting.length} waiting now`,
            items: waiting.slice(0, 10).map((e) => ({
              id: e.id,
              title: `#${e.position} ${e.customerName ?? 'Guest'}`,
              detail: e.serviceName ?? undefined,
            })),
          },
          navigateTo: `/dashboard/salons/${sid}/queue`,
        };
      }
      case AssistantActionId.TODAY_INSIGHTS: {
        const r = await this.insights.query(user.id, sid, {
          question: p.topic === 'revenue' ? "today's revenue" : 'today summary',
        });
        return {
          status: 'DONE',
          message: r.answer,
          result: { summary: r.answer, items: r.figures.map((f) => ({ title: String(f.metric), detail: String((f as { value?: unknown }).value ?? '') })) },
          navigateTo: `/dashboard/salons/${sid}`,
        };
      }
      case AssistantActionId.SALON_SEARCH: {
        if (!p.serviceQuery) {
          return { status: 'NEEDS_INPUT', message: 'Which service are you looking for? For example "haircut salon dhoondo".' };
        }
        const today = utcToZonedDateStr(new Date(), 'Asia/Kolkata');
        const r = await this.search.search({ serviceQuery: p.serviceQuery, date: today, ...(p.city ? { city: p.city } : {}) } as never);
        return {
          status: 'DONE',
          message: r.candidates.length ? `${r.candidates.length} matching salons.` : 'No matching salons found.',
          result: {
            summary: `Salons offering “${p.serviceQuery}”`,
            items: r.candidates.slice(0, 10).map((c) => ({
              id: c.salon.id,
              title: c.salon.name,
              detail: `${c.service.name} · ${rupees(c.service.price)}${c.salon.distanceKm !== null ? ` · ${c.salon.distanceKm} km` : ''}`,
            })),
          },
          navigateTo: '/search',
        };
      }
      case AssistantActionId.STAFF_ADD: {
        if (!p.name) return { status: 'NEEDS_INPUT', message: 'What is the new staff member’s name? For example "Ravi ko staff mein add karo".' };
        const existing = await this.staff.list(user.id, sid);
        const same = existing.filter((s) => s.displayName.toLocaleLowerCase() === p.name!.toLocaleLowerCase());
        const payload = { displayName: p.name, ...(p.phone ? { phone: p.phone } : {}) };
        return this.sealWrite(user, sid, AssistantActionId.STAFF_ADD, payload, { same: same.map((s) => s.id) }, [
          { label: 'Name', before: null, after: p.name },
          { label: 'Mobile', before: null, after: maskPhone(p.phone) ?? 'not given' },
          { label: 'Status', before: null, after: 'Active' },
        ], same.length ? `${p.name} is already on your staff list. Confirm only if this is a different person.` : undefined);
      }
      case AssistantActionId.STAFF_SET_STATUS: {
        const rows = await this.staff.list(user.id, sid);
        const target = await this.pick(rows, text, (s) => s.displayName, 'Which staff member?', (s) => `${p.active ? 'Activate' : 'Deactivate'} staff ${s.displayName}`);
        const next = p.active ? StaffMemberStatus.ACTIVE : StaffMemberStatus.INACTIVE;
        if (target.status === next) {
          return { status: 'DONE', message: `${target.displayName} is already ${p.active ? 'active' : 'inactive'}. Nothing was changed.` };
        }
        return this.sealWrite(user, sid, AssistantActionId.STAFF_SET_STATUS, { staffId: target.id, status: next }, { id: target.id, status: target.status }, [
          { label: target.displayName, before: target.status === 'ACTIVE' ? 'Active' : 'Inactive', after: p.active ? 'Active' : 'Inactive' },
        ], p.active ? undefined : 'They will no longer be assigned new customers. Their history is kept and you can activate them again.');
      }
      case AssistantActionId.SERVICE_ADD: {
        if (!p.name || p.price === null) {
          return { status: 'NEEDS_INPUT', message: 'Tell me the service name and price, for example "Beard trim service add karo ₹100 20 minute".' };
        }
        const duration = p.durationMinutes ?? 30;
        const rows = await this.services.list(user.id, sid);
        if (rows.some((s) => s.isActive && s.name.toLocaleLowerCase() === p.name!.toLocaleLowerCase())) {
          return { status: 'NEEDS_INPUT', message: `${p.name} already exists. To change its price say "${p.name} price ${p.price} karo".` };
        }
        return this.sealWrite(user, sid, AssistantActionId.SERVICE_ADD, { name: p.name, price: p.price, durationMinutes: duration }, { names: rows.map((s) => s.name).sort() }, [
          { label: 'Service', before: null, after: p.name },
          { label: 'Price', before: null, after: rupees(p.price) },
          { label: 'Duration', before: null, after: `${duration} min${p.durationMinutes ? '' : ' (default)'}` },
        ]);
      }
      case AssistantActionId.SERVICE_SET_PRICE: {
        const rows = (await this.services.list(user.id, sid)).filter((s) => s.isActive);
        const target = await this.pick(rows, text, (s) => s.name, 'Which service?', (s) => `${s.name} price ${p.to ?? ''}${p.percent ? `${p.percent}% ${p.direction === 'down' ? 'ghata do' : 'badha do'}` : ''}`.trim());
        if (p.from !== null && Math.abs(p.from - target.price) > 0.001) {
          return {
            status: 'NEEDS_INPUT',
            message: `${target.name} is ${rupees(target.price)} right now, not ${rupees(p.from)}. Say the new price again to continue.`,
            options: p.to !== null ? [{ label: `${target.name} → ${rupees(p.to)}`, text: `${target.name} price ${p.to} karo` }] : undefined,
          };
        }
        let next: number | null = p.to;
        if (next === null && p.percent !== null && p.direction) {
          next = Math.round(target.price * (1 + (p.direction === 'up' ? 1 : -1) * (p.percent / 100)));
        } else if (next === null && p.delta !== null && p.direction) {
          next = target.price + (p.direction === 'up' ? 1 : -1) * p.delta;
        }
        if (next === null) {
          return { status: 'NEEDS_INPUT', message: `What should the new price of ${target.name} be? It is ${rupees(target.price)} now.` };
        }
        if (p.percent !== null && !p.direction) {
          return { status: 'NEEDS_INPUT', message: `Increase or decrease ${target.name} by ${p.percent}%?`, options: [
            { label: `Increase ${p.percent}%`, text: `${target.name} price ${p.percent}% badha do` },
            { label: `Decrease ${p.percent}%`, text: `${target.name} price ${p.percent}% ghata do` },
          ] };
        }
        if (next < 0 || next > 1_000_000) return { status: 'FAILED', message: 'That price is outside the allowed range. Nothing was changed.' };
        if (Math.abs(next - target.price) < 0.001) return { status: 'DONE', message: `${target.name} is already ${rupees(next)}. Nothing was changed.` };
        return this.sealWrite(user, sid, AssistantActionId.SERVICE_SET_PRICE, { serviceId: target.id, price: next }, { id: target.id, price: target.price, isActive: true }, [
          { label: `${target.name} price`, before: rupees(target.price), after: rupees(next) },
        ], 'New bookings use the new price. Existing bookings keep the price they were made at.');
      }
      case AssistantActionId.SERVICE_ARCHIVE:
      case AssistantActionId.SERVICE_RESTORE: {
        const archive = p.action === AssistantActionId.SERVICE_ARCHIVE;
        const rows = (await this.services.list(user.id, sid)).filter((s) => s.isActive === archive);
        if (!rows.length) return { status: 'NEEDS_INPUT', message: archive ? 'There are no active services to remove.' : 'There are no archived services to restore.' };
        const target = await this.pick(rows, text, (s) => s.name, archive ? 'Which service should I remove?' : 'Which service should I restore?', (s) => `${s.name} service ${archive ? 'hata do' : 'wapas chalu karo'}`);
        return this.sealWrite(user, sid, p.action, { serviceId: target.id, isActive: !archive }, { id: target.id, isActive: target.isActive }, [
          { label: target.name, before: archive ? 'Bookable' : 'Archived', after: archive ? 'Archived' : 'Bookable' },
        ], archive ? 'Customers can no longer book it. Past bookings are kept, and you can restore it any time.' : undefined);
      }
    }
  }

  private async pick<T>(rows: T[], text: string, nameOf: (r: T) => string, question: string, optionText: (r: T) => string): Promise<T> {
    const hits = matchByName(text, rows, nameOf);
    if (hits.length === 1) return hits[0];
    const choices = hits.length ? hits : rows;
    throw new Reply({
      status: 'NEEDS_INPUT',
      message: hits.length ? `More than one match. ${question}` : question,
      options: choices.slice(0, 8).map((r) => ({ label: nameOf(r), text: optionText(r) })),
    });
  }

  private sealWrite(
    user: AuthenticatedUser,
    salonId: string,
    actionId: AssistantActionId,
    payload: Record<string, unknown>,
    before: unknown,
    rows: AssistantPreviewRow[],
    warning?: string,
  ): Partial<AssistantTurnDto> {
    const confirmation = this.ledger.seal({ userId: user.id, salonId, actionId, payload, beforeFingerprint: fingerprint(before) });
    return {
      status: 'NEEDS_CONFIRMATION',
      message: 'Please check and confirm. Nothing has changed yet.',
      preview: { rows, ...(warning ? { warning } : {}) },
      confirmation,
    };
  }

  // ---------------------------------------------------------------- execution (only after confirmation)

  private async execute(user: AuthenticatedUser, s: SealedWrite): Promise<Partial<AssistantTurnDto>> {
    const sid = s.salonId;
    const stale = () =>
      new Reply({ status: 'FAILED', message: 'This changed since the preview, so nothing was applied. Ask again to see the current state.' });
    const done = (message: string, resource: AssistantResource, id: string, rows: AssistantPreviewRow[]): Partial<AssistantTurnDto> => ({
      status: 'DONE',
      message,
      preview: { rows },
      result: { summary: message, changed: [{ resource, id }] },
      refresh: [resource, 'overview'],
      navigateTo: `/dashboard/salons/${sid}/${resource}`,
    });
    const payload = s.payload;
    switch (s.actionId) {
      case AssistantActionId.STAFF_ADD: {
        const existing = await this.staff.list(user.id, sid);
        const name = String(payload.displayName);
        const same = existing.filter((r) => r.displayName.toLocaleLowerCase() === name.toLocaleLowerCase()).map((r) => r.id);
        if (fingerprint({ same }) !== s.beforeFingerprint) throw stale();
        const { staff: created } = await this.staff.create(user.id, sid, {
          displayName: String(payload.displayName),
          ...(payload.phone ? { phone: String(payload.phone) } : {}),
        });
        return done(`${created.displayName} was added to your staff.`, 'staff', created.id, [{ label: 'Name', before: null, after: created.displayName }]);
      }
      case AssistantActionId.STAFF_SET_STATUS: {
        const row = (await this.staff.list(user.id, sid)).find((r) => r.id === payload.staffId);
        if (!row || fingerprint({ id: row.id, status: row.status }) !== s.beforeFingerprint) throw stale();
        const updated = await this.staff.update(user.id, sid, row.id, { status: payload.status as StaffMemberStatus });
        const label = updated.status === 'ACTIVE' ? 'Active' : 'Inactive';
        return done(`${updated.displayName} is now ${label.toLowerCase()}.`, 'staff', updated.id, [
          { label: updated.displayName, before: row.status === 'ACTIVE' ? 'Active' : 'Inactive', after: label },
        ]);
      }
      case AssistantActionId.SERVICE_ADD: {
        const rows = await this.services.list(user.id, sid);
        if (fingerprint({ names: rows.map((r) => r.name).sort() }) !== s.beforeFingerprint) throw stale();
        const created = await this.services.create(user.id, sid, {
          name: String(payload.name),
          price: Number(payload.price),
          durationMinutes: Number(payload.durationMinutes),
        });
        return done(`${created.name} was added at ${rupees(created.price)}.`, 'services', created.id, [
          { label: created.name, before: null, after: `${rupees(created.price)} · ${created.durationMinutes} min` },
        ]);
      }
      case AssistantActionId.SERVICE_SET_PRICE: {
        const row = (await this.services.list(user.id, sid)).find((r) => r.id === payload.serviceId);
        if (!row || fingerprint({ id: row.id, price: row.price, isActive: row.isActive }) !== s.beforeFingerprint) throw stale();
        const updated = await this.services.update(user.id, sid, row.id, { price: Number(payload.price) });
        return done(`${updated.name} now costs ${rupees(updated.price)}.`, 'services', updated.id, [
          { label: `${updated.name} price`, before: rupees(row.price), after: rupees(updated.price) },
        ]);
      }
      case AssistantActionId.SERVICE_ARCHIVE:
      case AssistantActionId.SERVICE_RESTORE: {
        const row = (await this.services.list(user.id, sid)).find((r) => r.id === payload.serviceId);
        if (!row || fingerprint({ id: row.id, isActive: row.isActive }) !== s.beforeFingerprint) throw stale();
        const updated = await this.services.update(user.id, sid, row.id, { isActive: Boolean(payload.isActive) });
        return done(`${updated.name} is now ${updated.isActive ? 'bookable again' : 'archived'}.`, 'services', updated.id, [
          { label: updated.name, before: row.isActive ? 'Bookable' : 'Archived', after: updated.isActive ? 'Bookable' : 'Archived' },
        ]);
      }
      default:
        throw new Reply({ status: 'FAILED', message: 'That confirmation is not valid. Nothing was changed.' });
    }
  }

  // ---------------------------------------------------------------- results, failures, audit

  private async failure(
    userId: string,
    salonId: string | null,
    requestId: string,
    actionId: AssistantActionId,
    err: unknown,
  ): Promise<AssistantTurnDto> {
    if (err instanceof Reply) {
      await this.audit(userId, salonId, requestId, actionId, 'PREVIEW', err.turn.status ?? 'NEEDS_INPUT', {});
      return this.finish(requestId, actionId, err.turn);
    }
    const denied =
      err instanceof ForbiddenException ||
      err instanceof UnauthorizedException ||
      err instanceof NotFoundException ||
      (err instanceof HttpException && [401, 403, 404].includes(err.getStatus()));
    if (denied) {
      await this.audit(userId, salonId, requestId, actionId, 'DENIED', 'DENIED', {});
      return this.finish(requestId, actionId, {
        status: 'DENIED',
        message: 'Your account is not allowed to do that here. Nothing was changed.',
      });
    }
    const message =
      err instanceof HttpException && err.getStatus() < 500
        ? `FastQue refused this: ${(err.getResponse() as { message?: string })?.message ?? err.message}. Nothing was changed.`
        : 'Something went wrong on the server. Nothing was changed by the assistant.';
    if (!(err instanceof HttpException)) this.logger.error(`assistant ${actionId} failed: ${err instanceof Error ? err.message : 'unknown'}`);
    await this.audit(userId, salonId, requestId, actionId, 'FAILED', 'FAILED', {});
    return this.finish(requestId, actionId, { status: 'FAILED', message });
  }

  private finish(requestId: string, actionId: AssistantActionId | null, turn: Partial<AssistantTurnDto>): AssistantTurnDto {
    const def = actionId ? ASSISTANT_ACTIONS[actionId] : null;
    return {
      requestId,
      status: turn.status ?? 'DONE',
      action: actionId && def ? { id: actionId, title: def.title, kind: def.kind } : null,
      message: turn.message ?? '',
      ...(turn.preview ? { preview: turn.preview } : {}),
      ...(turn.confirmation ? { confirmation: turn.confirmation } : {}),
      ...(turn.options ? { options: turn.options } : {}),
      ...(turn.result ? { result: turn.result } : {}),
      ...(turn.refresh ? { refresh: turn.refresh } : {}),
      ...(turn.navigateTo ? { navigateTo: turn.navigateTo } : {}),
      completedAt: new Date().toISOString(),
    };
  }

  /** Append-only record of every assistant step. No transcript text, no full phone numbers. */
  private async audit(
    userId: string,
    salonId: string | null,
    requestId: string,
    actionId: AssistantActionId | null,
    stage: 'READ' | 'PREVIEW' | 'CONFIRM' | 'EXECUTE' | 'CANCEL' | 'DENIED' | 'FAILED',
    outcome: string,
    extra: Record<string, unknown>,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ASSISTANT_ACTION',
          entityType: salonId ? 'Salon' : 'Assistant',
          entityId: salonId ?? requestId,
          metadata: { requestId, actionId, stage, outcome, ...extra } as never,
        },
      });
    } catch (e) {
      this.logger.warn(`assistant audit write failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
