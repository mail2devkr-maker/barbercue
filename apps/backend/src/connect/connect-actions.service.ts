import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, type ConnectBookingAction } from '@prisma/client';
import { AvailabilityService } from '../bookings/availability.service';
import { BookingsService } from '../bookings/bookings.service';
import { CancellationPolicyService } from '../bookings/cancellation-policy.service';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { ConnectViewer } from './connect-access.service';
import { connectError, connectFlag } from './connect-config';
import { ConnectLinksService } from './connect-links.service';
import { ConnectMessagesService } from './connect-messages.service';
import { ConnectNotifyService } from './connect-notify.service';
import { fmtTime } from './ai/connect-knowledge.service';

type Kind = ConnectBookingAction['kind'];

const LABEL: Record<Kind, string> = {
  RESCHEDULE: 'Change appointment time',
  CANCEL: 'Cancel booking',
  ADD_SERVICE: 'Add a service',
  REMOVE_SERVICE: 'Remove a service',
  CHANGE_STYLIST: 'Change stylist',
  LATE_ARRIVAL: 'Running late',
  JOIN_QUEUE_SLOT: 'Join another queue slot',
  ADD_FAMILY_MEMBER: 'Book for a family member',
};

/**
 * Actionable messages (spec sections 7 and 9). Every change runs through the EXISTING booking and
 * queue engines (BookingsService.reschedule / cancel, QueueService.cancelByCustomer / addAddOn)
 * and only after the approvals each kind needs are recorded. AI can only suggest these buttons;
 * it never creates or approves an action. Each step is written to connect_audit_events.
 */
@Injectable()
export class ConnectActionsService {
  private readonly logger = new Logger(ConnectActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: ConnectLinksService,
    private readonly messages: ConnectMessagesService,
    private readonly notify: ConnectNotifyService,
    private readonly bookings: BookingsService,
    private readonly availability: AvailabilityService,
    private readonly policies: CancellationPolicyService,
    private readonly queue: QueueService,
  ) {}

  private on() {
    if (!connectFlag('CONNECT_BOOKING_ACTIONS_ENABLED'))
      throw connectError(
        'CONNECT_ACTIONS_OFF',
        'Booking changes in chat are not switched on.',
        HttpStatus.NOT_FOUND,
      );
  }

  list(v: ConnectViewer) {
    return this.prisma.connectBookingAction
      .findMany({
        where: { conversationId: v.conv.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
      })
      .then((rows) => rows.map((a) => this.dto(a)));
  }

  dto(a: ConnectBookingAction) {
    return {
      id: a.id,
      kind: a.kind,
      label: LABEL[a.kind],
      status: a.status,
      requestedBy: a.requestedBy,
      payload: a.payload,
      resultNote: a.resultNote,
      expiresAt: a.expiresAt.toISOString(),
      createdAt: a.createdAt.toISOString(),
    };
  }

  async request(
    v: ConnectViewer,
    input: {
      kind: Kind;
      date?: string;
      delayMinutes?: number;
      note?: string;
      serviceId?: string;
    },
  ) {
    this.on();
    const life = await this.links.lifecycle(v.conv);
    if (life.status === 'READ_ONLY')
      throw connectError(
        'CONNECT_READ_ONLY',
        'This conversation is read-only.',
        HttpStatus.CONFLICT,
      );
    const open = await this.prisma.connectBookingAction.findFirst({
      where: {
        conversationId: v.conv.id,
        kind: input.kind,
        status: { in: ['AWAITING_CUSTOMER', 'AWAITING_SALON'] },
        expiresAt: { gt: new Date() },
      },
    });
    if (open)
      throw connectError(
        'CONNECT_ACTION_OPEN',
        'There is already an open request of this kind in this chat.',
        HttpStatus.CONFLICT,
        { actionId: open.id },
      );
    const state = await this.links.linkState(v.conv);
    if (!state.active)
      throw connectError(
        'CONNECT_ACTION_NOT_ALLOWED',
        'This booking can no longer be changed from chat.',
        HttpStatus.CONFLICT,
      );
    const salonSide = v.side === 'SALON';
    let payload: Record<string, unknown> = { note: input.note ?? null };
    let status: ConnectBookingAction['status'] = salonSide
      ? 'AWAITING_CUSTOMER'
      : 'AWAITING_SALON';
    const expiresAt = new Date(Date.now() + 24 * 3_600_000);

    switch (input.kind) {
      case 'RESCHEDULE': {
        if (
          v.conv.kind !== 'SALON_BOOKING' ||
          !v.conv.bookingId ||
          !v.conv.salonId
        )
          throw connectError(
            'CONNECT_ACTION_NOT_ALLOWED',
            'Only appointments can be moved to a new time here.',
          );
        if (state.queueEntryId)
          throw connectError(
            'CONNECT_ACTION_NOT_ALLOWED',
            'You are already checked in, so the time cannot be changed.',
          );
        const date = input.date ?? state.startsAt!.toISOString().slice(0, 10);
        const slots = await this.availability.getAvailability(
          v.conv.salonId,
          state.serviceIds,
          date,
          state.preferredStaffId ?? undefined,
        );
        const current = state.startsAt?.toISOString();
        const options = slots
          .filter(
            (s) =>
              s.available &&
              s.slotStart !== current &&
              new Date(s.slotStart) > new Date(),
          )
          .slice(0, 8)
          .map((s) => s.slotStart);
        const tz =
          (
            await this.prisma.salon.findUnique({
              where: { id: v.conv.salonId },
              select: { timezone: true },
            })
          )?.timezone ?? 'Asia/Kolkata';
        payload = {
          ...payload,
          date,
          current,
          options,
          optionLabels: options.map((o) => fmtTime(o, tz)),
          source: 'AvailabilityService.getAvailability',
        };
        // The customer always picks the time; the salon's approval is recorded when it offered the
        // options (salon-side request) or after the customer picks (customer-side request).
        status = 'AWAITING_CUSTOMER';
        break;
      }
      case 'CANCEL': {
        if (salonSide)
          throw connectError(
            'CONNECT_ACTION_NOT_ALLOWED',
            'Use Bookings to cancel on the salon side, so the customer is told the reason.',
          );
        if (v.conv.salonId) {
          const p = await this.policies.getEffectivePolicy(v.conv.salonId);
          payload = {
            ...payload,
            policy: p,
            startsAt: state.startsAt?.toISOString() ?? null,
          };
        }
        if (v.conv.kind === 'HOME_SERVICE')
          throw connectError(
            'CONNECT_ACTION_NOT_ALLOWED',
            'Cancel a home visit from its booking page.',
          );
        status = 'AWAITING_CUSTOMER';
        await this.event(v, 'CANCEL_INTENT');
        break;
      }
      case 'LATE_ARRIVAL': {
        if (salonSide)
          throw connectError(
            'CONNECT_ACTION_NOT_ALLOWED',
            'Only the customer can report running late.',
          );
        const delay = input.delayMinutes ?? 10;
        let grace: number | null = null;
        if (v.conv.salonId)
          grace =
            (
              await this.prisma.cancellationPolicy.findUnique({
                where: { salonId: v.conv.salonId },
              })
            )?.appointmentArrivalGraceMinutes ??
            (
              await this.prisma.cancellationPolicy.findFirst({
                where: { salonId: null },
              })
            )?.appointmentArrivalGraceMinutes ??
            null;
        const eta = new Date(Date.now() + delay * 60_000);
        payload = {
          ...payload,
          delayMinutes: delay,
          expectedArrival: eta.toISOString(),
          startsAt: state.startsAt?.toISOString() ?? null,
          graceMinutes: grace,
          withinGrace:
            grace != null && state.startsAt
              ? eta.getTime() <= state.startsAt.getTime() + grace * 60_000
              : null,
          fairness:
            'Confirming does not move anyone else in the queue. If the delay is long, the salon may offer a new time instead.',
        };
        status = 'AWAITING_SALON';
        break;
      }
      case 'ADD_SERVICE': {
        if (!v.conv.salonId)
          throw connectError(
            'CONNECT_ACTION_NOT_ALLOWED',
            'Ask the professional directly in chat for home visits.',
          );
        const svc = input.serviceId
          ? await this.prisma.service.findFirst({
              where: {
                id: input.serviceId,
                salonId: v.conv.salonId,
                isActive: true,
              },
              select: {
                id: true,
                name: true,
                price: true,
                durationMinutes: true,
              },
            })
          : null;
        if (input.serviceId && !svc)
          throw connectError(
            'CONNECT_SERVICE_INVALID',
            "That service is not on this salon's menu.",
          );
        payload = {
          ...payload,
          service: svc
            ? {
                id: svc.id,
                name: svc.name,
                pricePaise: Math.round(Number(svc.price) * 100),
                durationMinutes: svc.durationMinutes,
              }
            : null,
        };
        status = salonSide ? 'AWAITING_CUSTOMER' : 'AWAITING_SALON';
        break;
      }
      default:
        // REMOVE_SERVICE, CHANGE_STYLIST, JOIN_QUEUE_SLOT, ADD_FAMILY_MEMBER: a structured request the
        // salon confirms; staff then make the change in Bookings/Live Queue (no chat shortcut).
        status = salonSide ? 'AWAITING_CUSTOMER' : 'AWAITING_SALON';
    }

    const action = await this.prisma.connectBookingAction.create({
      data: {
        conversationId: v.conv.id,
        kind: input.kind,
        status,
        requestedBy: v.side,
        requestedByUserId: v.userId,
        payload: payload as Prisma.InputJsonValue,
        salonApprovedAt: salonSide ? new Date() : null,
        salonApprovedById: salonSide ? v.userId : null,
        expiresAt,
      },
    });
    await this.audit(v, 'ACTION_REQUESTED', action);
    await this.messages.post(v.conv.id, {
      senderKind: 'SYSTEM',
      kind: 'ACTION',
      body: `${LABEL[input.kind]}: request ${v.side === 'CUSTOMER' ? 'sent by the customer' : 'sent by the salon'}.`,
      meta: { actionId: action.id },
      notify: status === 'AWAITING_SALON' ? 'SALON' : 'CUSTOMER',
    });
    await this.event(v, 'ACTION_REQUESTED', { kind: input.kind });
    return this.dto(action);
  }

  async decide(
    v: ConnectViewer,
    actionId: string,
    d: {
      decision: 'APPROVE' | 'DECLINE' | 'CANCEL';
      optionSlotStart?: string;
      note?: string;
    },
  ) {
    this.on();
    const a = await this.prisma.connectBookingAction.findFirst({
      where: { id: actionId, conversationId: v.conv.id },
    });
    if (!a)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    if (!['AWAITING_CUSTOMER', 'AWAITING_SALON'].includes(a.status))
      throw connectError(
        'CONNECT_ACTION_CLOSED',
        'This request was already answered.',
        HttpStatus.CONFLICT,
      );
    if (a.expiresAt < new Date()) {
      await this.prisma.connectBookingAction.update({
        where: { id: a.id },
        data: { status: 'EXPIRED' },
      });
      throw connectError(
        'CONNECT_ACTION_EXPIRED',
        'This request has expired. Please send a new one.',
        HttpStatus.CONFLICT,
      );
    }
    const p = a.payload as Record<string, unknown>;
    if (d.decision === 'CANCEL') {
      if (a.requestedByUserId !== v.userId)
        throw connectError(
          'CONNECT_FORBIDDEN',
          'Only the person who asked can withdraw this request.',
          HttpStatus.FORBIDDEN,
        );
      return this.close(v, a, 'CANCELLED', 'Request withdrawn.');
    }
    const turn = a.status === 'AWAITING_CUSTOMER' ? 'CUSTOMER' : 'SALON';
    if (v.side !== turn)
      throw connectError(
        'CONNECT_NOT_YOUR_TURN',
        turn === 'CUSTOMER'
          ? 'Waiting for the customer to answer.'
          : 'Waiting for the salon to answer.',
        HttpStatus.CONFLICT,
      );
    if (d.decision === 'DECLINE')
      return this.close(
        v,
        a,
        'DECLINED',
        d.note ? `Declined: ${d.note}` : 'Declined.',
      );

    // APPROVE
    if (a.kind === 'RESCHEDULE') {
      if (v.side === 'CUSTOMER') {
        const options = (p.options as string[] | undefined) ?? [];
        if (!d.optionSlotStart || !options.includes(d.optionSlotStart))
          throw connectError(
            'CONNECT_OPTION_INVALID',
            'Choose one of the offered times.',
          );
        const chosen = { ...p, chosen: d.optionSlotStart };
        if (a.salonApprovedAt)
          return this.applyReschedule(v, a, chosen, d.optionSlotStart);
        const upd = await this.prisma.connectBookingAction.update({
          where: { id: a.id },
          data: {
            status: 'AWAITING_SALON',
            customerApprovedAt: new Date(),
            payload: chosen,
          },
        });
        await this.audit(v, 'ACTION_CUSTOMER_APPROVED', upd);
        await this.messages.post(v.conv.id, {
          senderKind: 'SYSTEM',
          kind: 'ACTION',
          body: 'The customer picked a new time. Waiting for the salon to confirm.',
          meta: { actionId: a.id },
          notify: 'SALON',
        });
        return this.dto(upd);
      }
      return this.applyReschedule(
        v,
        { ...a, salonApprovedAt: new Date(), salonApprovedById: v.userId },
        p,
        String(p.chosen),
      );
    }
    if (a.kind === 'CANCEL') return this.applyCancel(v, a);
    if (a.kind === 'LATE_ARRIVAL') {
      const until =
        typeof p.startsAt === 'string' && p.graceMinutes != null
          ? new Date(
              new Date(p.startsAt).getTime() + Number(p.graceMinutes) * 60_000,
            )
          : null;
      return this.close(
        v,
        a,
        'ACKNOWLEDGED',
        d.note ??
          (until
            ? `The salon confirmed. Please arrive by ${fmtTime(until.toISOString(), 'Asia/Kolkata')}.`
            : 'The salon confirmed they will expect you a little later.'),
        { salonApprovedAt: new Date(), salonApprovedById: v.userId },
      );
    }
    if (a.kind === 'ADD_SERVICE') {
      const svc = p.service as { id: string; name: string } | null;
      const state = await this.links.linkState(v.conv);
      const approvals =
        v.side === 'SALON'
          ? {
              salonApprovedAt: new Date(),
              salonApprovedById: v.userId,
              customerApprovedAt: a.customerApprovedAt,
            }
          : { customerApprovedAt: new Date() };
      const salonUser = v.side === 'SALON' ? v.userId : a.salonApprovedById;
      // A checked-in visit gets the add-on through the Live Queue engine itself.
      if (
        svc &&
        state.queueEntryId &&
        ['WAITING', 'CALLED', 'IN_SERVICE'].includes(state.queueStatus ?? '') &&
        salonUser
      ) {
        try {
          await this.queue.addAddOn(salonUser, state.queueEntryId, svc.id);
          const value =
            (p.service as { pricePaise?: number } | null)?.pricePaise ?? null;
          await this.prisma.connectAnalyticsEvent.create({
            data: {
              salonId: v.conv.salonId,
              homeProviderId: v.conv.homeProviderId,
              conversationId: v.conv.id,
              type: 'SERVICE_ADDED',
              actorUserId: v.userId,
              valuePaise: value,
            },
          });
          return this.close(
            v,
            a,
            'APPLIED',
            `${svc.name} was added to this visit.`,
            { ...approvals, appliedAt: new Date() },
          );
        } catch (err) {
          return this.fail(v, a, err);
        }
      }
      return this.close(
        v,
        a,
        'ACKNOWLEDGED',
        `${svc?.name ?? 'The extra service'} is confirmed. The salon will add it when you check in.`,
        approvals,
      );
    }
    return this.close(
      v,
      a,
      'ACKNOWLEDGED',
      d.note ??
        'The salon confirmed this request and will update your booking.',
      v.side === 'SALON'
        ? { salonApprovedAt: new Date(), salonApprovedById: v.userId }
        : { customerApprovedAt: new Date() },
    );
  }

  private async applyReschedule(
    v: ConnectViewer,
    a: ConnectBookingAction,
    p: Record<string, unknown>,
    slotStart: string,
  ) {
    const conv = v.conv;
    try {
      await this.bookings.reschedule(conv.customerId, conv.bookingId!, {
        slotStart,
      });
    } catch (err) {
      return this.fail(v, a, err);
    }
    const tz = conv.salonId
      ? ((
          await this.prisma.salon.findUnique({
            where: { id: conv.salonId },
            select: { timezone: true },
          })
        )?.timezone ?? 'Asia/Kolkata')
      : 'Asia/Kolkata';
    const upd = await this.prisma.connectBookingAction.update({
      where: { id: a.id },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
        customerApprovedAt: a.customerApprovedAt ?? new Date(),
        salonApprovedAt: a.salonApprovedAt ?? new Date(),
        salonApprovedById:
          a.salonApprovedById ?? (v.side === 'SALON' ? v.userId : null),
        payload: { ...p, chosen: slotStart },
        resultNote: `Moved to ${fmtTime(slotStart, tz)}`,
      },
    });
    await this.audit(v, 'ACTION_APPLIED', upd);
    await this.messages.post(conv.id, {
      senderKind: 'SYSTEM',
      kind: 'ACTION',
      body: `Appointment moved to ${fmtTime(slotStart, tz)}. Confirmed by both of you.`,
      meta: { actionId: a.id },
      notify: 'BOTH',
    });
    const hadCancelIntent = await this.prisma.connectAnalyticsEvent.findFirst({
      where: { conversationId: conv.id, type: 'CANCEL_INTENT' },
    });
    await this.event(v, 'BOOKING_MODIFIED', { kind: 'RESCHEDULE' });
    if (hadCancelIntent) await this.event(v, 'CANCELLATION_PREVENTED');
    return this.dto(upd);
  }

  private async applyCancel(v: ConnectViewer, a: ConnectBookingAction) {
    const conv = v.conv;
    try {
      if (conv.bookingId)
        await this.bookings.cancel(conv.customerId, conv.bookingId);
      else if (conv.queueEntryId)
        await this.queue.cancelByCustomer(conv.customerId, conv.queueEntryId);
    } catch (err) {
      return this.fail(v, a, err);
    }
    await this.event(v, 'BOOKING_CANCELLED_IN_CHAT');
    return this.close(
      v,
      a,
      'APPLIED',
      'Booking cancelled by the customer.',
      { customerApprovedAt: new Date(), appliedAt: new Date() },
      null,
      'BOTH',
    );
  }

  private async fail(v: ConnectViewer, a: ConnectBookingAction, err: unknown) {
    const msg =
      err instanceof AppException
        ? err.message
        : 'The booking could not be changed.';
    this.logger.warn(
      `Connect action ${a.id} failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
    const upd = await this.prisma.connectBookingAction.update({
      where: { id: a.id },
      data: { status: 'FAILED', resultNote: msg.slice(0, 300) },
    });
    await this.audit(v, 'ACTION_FAILED', { id: a.id, error: msg });
    await this.messages.post(v.conv.id, {
      senderKind: 'SYSTEM',
      kind: 'ACTION',
      body: `The change could not be made: ${msg}`,
      meta: { actionId: a.id },
      notify: 'BOTH',
    });
    return this.dto(upd);
  }

  private async close(
    v: ConnectViewer,
    a: ConnectBookingAction,
    status: ConnectBookingAction['status'],
    note: string,
    extra: Prisma.ConnectBookingActionUpdateInput = {},
    analytics: string | null = null,
    notifyTo: 'CUSTOMER' | 'SALON' | 'BOTH' | null = null,
  ) {
    const upd = await this.prisma.connectBookingAction.update({
      where: { id: a.id },
      data: { status, resultNote: note.slice(0, 300), ...extra },
    });
    await this.audit(v, `ACTION_${status}`, upd);
    await this.messages.post(v.conv.id, {
      senderKind: 'SYSTEM',
      kind: 'ACTION',
      body: `${LABEL[a.kind]}: ${note}`,
      meta: { actionId: a.id },
      notify: notifyTo ?? (v.side === 'SALON' ? 'CUSTOMER' : 'SALON'),
    });
    if (analytics) await this.event(v, analytics);
    return this.dto(upd);
  }

  private audit(v: ConnectViewer, action: string, meta: unknown) {
    return this.prisma.connectAuditEvent.create({
      data: {
        salonId: v.conv.salonId,
        conversationId: v.conv.id,
        actorUserId: v.userId,
        action,
        meta: JSON.parse(JSON.stringify(meta)) as Prisma.InputJsonValue,
      },
    });
  }

  private event(
    v: ConnectViewer,
    type: string,
    meta?: Record<string, unknown>,
  ) {
    return this.prisma.connectAnalyticsEvent.create({
      data: {
        salonId: v.conv.salonId,
        homeProviderId: v.conv.homeProviderId,
        conversationId: v.conv.id,
        type,
        actorUserId: v.userId,
        meta: meta as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
