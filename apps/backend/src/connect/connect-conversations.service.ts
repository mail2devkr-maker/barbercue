import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ConnectConversation } from '@prisma/client';
import { Role, type ConnectConversationSummaryDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConnectAccessService,
  type ConnectTenant,
  type ConnectViewer,
} from './connect-access.service';
import { connectError, connectFlag } from './connect-config';
import { bookingReference, ConnectLinksService } from './connect-links.service';
import { ConnectMessagesService } from './connect-messages.service';
import { ConnectNotifyService } from './connect-notify.service';

const PAGE = 30;

type Folder =
  | 'all'
  | 'unread'
  | 'new'
  | 'upcoming'
  | 'queue'
  | 'home'
  | 'awaiting_customer'
  | 'awaiting_salon'
  | 'urgent'
  | 'ai'
  | 'complaints'
  | 'completed'
  | 'archived'
  | 'mine';

@Injectable()
export class ConnectConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ConnectAccessService,
    private readonly links: ConnectLinksService,
    private readonly messages: ConnectMessagesService,
    private readonly notify: ConnectNotifyService,
  ) {}

  // ---------- Customer side ----------

  async customerList(userId: string, q: { q?: string; archived?: boolean }) {
    const where: Prisma.ConnectConversationWhereInput = { customerId: userId };
    const parts = await this.prisma.connectParticipant.findMany({
      where: { userId },
      select: {
        conversationId: true,
        archived: true,
        muted: true,
        lastReadSeq: true,
      },
    });
    const archivedIds = parts
      .filter((p) => p.archived)
      .map((p) => p.conversationId);
    where.id = q.archived ? { in: archivedIds } : { notIn: archivedIds };
    if (q.q) {
      where.OR = [
        { salon: { name: { contains: q.q, mode: 'insensitive' } } },
        {
          messages: {
            some: {
              body: { contains: q.q, mode: 'insensitive' },
              deletedAt: null,
            },
          },
        },
      ];
    }
    const rows = await this.prisma.connectConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }],
      take: 100,
    });
    return Promise.all(
      rows.map((c) =>
        this.summary(
          c,
          'CUSTOMER',
          parts.find((p) => p.conversationId === c.id),
        ),
      ),
    );
  }

  async unreadTotal(userId: string): Promise<number> {
    const parts = await this.prisma.connectParticipant.findMany({
      where: { userId, archived: false },
      select: {
        lastReadSeq: true,
        conversation: { select: { lastMessageSeq: true } },
      },
    });
    // Approximation over seq (system messages count): bounded, cheap, and never shows a negative.
    return parts.reduce(
      (n, p) => n + Math.max(0, p.conversation.lastMessageSeq - p.lastReadSeq),
      0,
    );
  }

  // ---------- Salon inbox ----------

  async inbox(
    userId: string,
    tenant: ConnectTenant,
    role: string,
    q: {
      folder: Folder;
      q?: string;
      from?: string;
      to?: string;
      cursor?: string;
    },
  ) {
    const base: Prisma.ConnectConversationWhereInput = tenant.salonId
      ? { salonId: tenant.salonId }
      : { homeProviderId: tenant.homeProviderId };
    const and: Prisma.ConnectConversationWhereInput[] = [base];
    if (role === 'STYLIST') and.push({ assignedToUserId: userId });
    const mine = await this.prisma.connectParticipant.findMany({
      where: { userId, conversation: base },
      select: {
        conversationId: true,
        archived: true,
        muted: true,
        lastReadSeq: true,
      },
    });
    const archivedIds = mine
      .filter((p) => p.archived)
      .map((p) => p.conversationId);
    const now = new Date();
    switch (q.folder) {
      case 'archived':
        and.push({ id: { in: archivedIds } });
        break;
      case 'unread':
        and.push({ id: { notIn: archivedIds }, awaiting: 'SALON' });
        break;
      case 'new':
        and.push({
          createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) },
        });
        break;
      case 'upcoming':
        and.push({
          kind: 'SALON_BOOKING',
          booking: { status: 'CONFIRMED', slotStart: { gte: now } },
        });
        break;
      case 'queue':
        and.push({
          OR: [
            {
              kind: 'LIVE_QUEUE',
              queueEntry: {
                status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] },
              },
            },
            {
              booking: {
                queueEntries: {
                  some: { status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } },
                },
              },
            },
          ],
        });
        break;
      case 'home':
        and.push({ kind: 'HOME_SERVICE' });
        break;
      case 'awaiting_customer':
        and.push({ awaiting: 'CUSTOMER', id: { notIn: archivedIds } });
        break;
      case 'awaiting_salon':
        and.push({ awaiting: 'SALON', id: { notIn: archivedIds } });
        break;
      case 'urgent':
        and.push({ priority: 'URGENT', resolvedAt: null });
        break;
      case 'ai':
        and.push({ aiHandled: true });
        break;
      case 'complaints':
        and.push({
          OR: [{ hasOpenComplaint: true }, { complaints: { some: {} } }],
        });
        break;
      case 'completed':
        and.push({
          OR: [
            { status: 'READ_ONLY' },
            { resolvedAt: { not: null } },
            { booking: { status: 'COMPLETED' } },
            { queueEntry: { status: 'COMPLETED' } },
          ],
        });
        break;
      case 'mine':
        and.push({ assignedToUserId: userId });
        break;
      default:
        and.push({ id: { notIn: archivedIds } });
    }
    if (q.from)
      and.push({
        lastMessageAt: { gte: new Date(`${q.from}T00:00:00+05:30`) },
      });
    if (q.to)
      and.push({ lastMessageAt: { lte: new Date(`${q.to}T23:59:59+05:30`) } });
    if (q.q) {
      const s = q.q.trim();
      const ref = s.replace(/^BK-/i, '').toLowerCase();
      const or: Prisma.ConnectConversationWhereInput[] = [
        {
          messages: {
            some: {
              body: { contains: s, mode: 'insensitive' },
              deletedAt: null,
            },
          },
        },
        { tags: { has: s.toLowerCase() } },
        { booking: { guestName: { contains: s, mode: 'insensitive' } } },
        { queueEntry: { contactName: { contains: s, mode: 'insensitive' } } },
        { homeBooking: { code: { equals: s.toUpperCase() } } },
      ];
      if (/^[0-9a-f]{4,8}$/.test(ref))
        or.push({ bookingId: { startsWith: ref } });
      if (/^\d{1,4}$/.test(s))
        or.push({ queueEntry: { tokenNumber: Number(s) } });
      and.push({ OR: or });
    }
    const rows = await this.prisma.connectConversation.findMany({
      where: { AND: and },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, PAGE);
    const counts = await this.counts(
      base,
      role === 'STYLIST' ? userId : null,
      archivedIds,
    );
    return {
      conversations: await Promise.all(
        page.map((c) =>
          this.summary(
            c,
            'SALON',
            mine.find((p) => p.conversationId === c.id),
          ),
        ),
      ),
      nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
      counts,
    };
  }

  private async counts(
    base: Prisma.ConnectConversationWhereInput,
    stylistId: string | null,
    archivedIds: string[],
  ) {
    const w = (
      x: Prisma.ConnectConversationWhereInput,
    ): Prisma.ConnectConversationWhereInput => ({
      AND: [base, stylistId ? { assignedToUserId: stylistId } : {}, x],
    });
    const [all, awaitingSalon, urgent, complaints, ai] = await Promise.all([
      this.prisma.connectConversation.count({
        where: w({ id: { notIn: archivedIds } }),
      }),
      this.prisma.connectConversation.count({
        where: w({ awaiting: 'SALON', id: { notIn: archivedIds } }),
      }),
      this.prisma.connectConversation.count({
        where: w({ priority: 'URGENT', resolvedAt: null }),
      }),
      this.prisma.connectConversation.count({
        where: w({ hasOpenComplaint: true }),
      }),
      this.prisma.connectConversation.count({ where: w({ aiHandled: true }) }),
    ]);
    return { all, awaitingSalon, urgent, complaints, ai };
  }

  private async summary(
    c: ConnectConversation,
    side: 'CUSTOMER' | 'SALON',
    p?: { archived: boolean; muted: boolean; lastReadSeq: number },
  ): Promise<ConnectConversationSummaryDto> {
    const last = await this.prisma.connectMessage.findFirst({
      where: { conversationId: c.id },
      orderBy: { seq: 'desc' },
      select: { body: true, deletedAt: true, kind: true, senderKind: true },
    });
    const card = await this.links.card(c);
    const unread = Math.max(0, c.lastMessageSeq - (p?.lastReadSeq ?? 0));
    const preview = last
      ? last.deletedAt
        ? 'Message deleted'
        : (last.body ??
          (last.kind === 'IMAGE'
            ? 'Photo'
            : last.kind === 'VOICE'
              ? 'Voice message'
              : last.kind === 'FILE'
                ? 'Document'
                : last.kind))
      : null;
    let title = card?.salonName ?? 'Conversation';
    if (side === 'SALON') title = await this.customerLabel(c);
    return {
      id: c.id,
      kind: c.kind,
      title,
      subtitle: card ? `${card.reference} · ${card.statusLabel}` : '',
      lastMessage: preview
        ? (last?.senderKind === 'AI' ? `AI: ${preview}` : preview).slice(0, 120)
        : null,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      unread,
      status: c.status,
      priority: c.priority,
      awaiting: c.awaiting,
      aiHandled: c.aiHandled,
      hasOpenComplaint: c.hasOpenComplaint,
      sentiment: side === 'SALON' ? c.sentiment : null,
      tags: side === 'SALON' ? c.tags : [],
      assignedToUserId: side === 'SALON' ? c.assignedToUserId : null,
      muted: !!p?.muted,
      archived: !!p?.archived,
    };
  }

  /** Staff see the name the customer gave at booking/queue join; never a phone number. */
  private async customerLabel(c: ConnectConversation): Promise<string> {
    if (c.queueEntryId) {
      const q = await this.prisma.queueEntry.findUnique({
        where: { id: c.queueEntryId },
        select: { contactName: true, tokenNumber: true },
      });
      if (q?.contactName) return q.contactName;
      if (q) return `Token #${q.tokenNumber}`;
    }
    if (c.homeBookingId) {
      const h = await this.prisma.homeBooking.findUnique({
        where: { id: c.homeBookingId },
        select: { address: { select: { contactName: true } } },
      });
      if (h?.address.contactName) return h.address.contactName;
    }
    if (c.bookingId) {
      const b = await this.prisma.booking.findUnique({
        where: { id: c.bookingId },
        select: { queueEntries: { select: { contactName: true }, take: 1 } },
      });
      if (b?.queueEntries[0]?.contactName) return b.queueEntries[0].contactName;
      return `Customer · ${bookingReference(c.bookingId)}`;
    }
    return 'Customer';
  }

  // ---------- Detail ----------

  async detail(v: ConnectViewer) {
    const c = v.conv;
    const [card, life, presence, part] = await Promise.all([
      this.links.card(c),
      this.links.lifecycle(c),
      this.messages.presence(v),
      this.prisma.connectParticipant.findUnique({
        where: {
          conversationId_userId: { conversationId: c.id, userId: v.userId },
        },
      }),
    ]);
    const base = {
      id: c.id,
      kind: c.kind,
      side: v.side,
      role: v.role,
      card,
      lifecycle: life,
      presence,
      lastMessageSeq: c.lastMessageSeq,
      muted: !!part?.muted,
      archived: !!part?.archived,
      blockedByMe:
        v.side === 'CUSTOMER' ? !!c.customerBlockedAt : !!c.salonBlockedAt,
      blockedByOther:
        v.side === 'CUSTOMER' ? !!c.salonBlockedAt : !!c.customerBlockedAt,
      hasOpenComplaint: c.hasOpenComplaint,
      flags: {
        ai: connectFlag('CONNECT_AI_ENABLED'),
        actions: connectFlag('CONNECT_BOOKING_ACTIONS_ENABLED'),
        quotations: connectFlag('CONNECT_QUOTATIONS_ENABLED'),
        translation: connectFlag('CONNECT_TRANSLATION_ENABLED'),
        location: connectFlag('CONNECT_LOCATION_SHARING_ENABLED'),
      },
    };
    if (v.side === 'CUSTOMER') return base;
    const lockActive =
      c.lockUserId &&
      c.lockExpiresAt &&
      c.lockExpiresAt > new Date() &&
      c.lockUserId !== v.userId;
    const staffNames = await this.staffDirectory(c);
    return {
      ...base,
      title: await this.customerLabel(c),
      priority: c.priority,
      awaiting: c.awaiting,
      tags: c.tags,
      sentiment: c.sentiment,
      sentimentReason: c.sentimentReason,
      aiHandled: c.aiHandled,
      summary: c.summary,
      summaryAt: c.summaryAt?.toISOString() ?? null,
      assignedToUserId: c.assignedToUserId,
      lastSalonReplySeq: c.lastSalonReplySeq,
      replyingNow: lockActive
        ? {
            userId: c.lockUserId,
            name:
              staffNames.find((s) => s.userId === c.lockUserId)?.name ??
              'A colleague',
          }
        : null,
      canAssign: v.canAssign,
      staff: staffNames,
    };
  }

  /** People this conversation can be assigned/transferred to. */
  async staffDirectory(
    c: Pick<ConnectConversation, 'salonId' | 'homeProviderId'>,
  ): Promise<{ userId: string; name: string; role: string }[]> {
    if (!c.salonId) return [];
    const [owners, grants] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { salonId: c.salonId, role: Role.SALON_OWNER },
        select: { userId: true },
      }),
      this.prisma.connectStaffGrant.findMany({ where: { salonId: c.salonId } }),
    ]);
    const staff = await this.prisma.salonStaff.findMany({
      where: { salonId: c.salonId, accessRevokedAt: null },
      select: { userId: true, displayName: true },
    });
    const name = (id: string, fallback: string) =>
      staff.find((s) => s.userId === id)?.displayName ?? fallback;
    return [
      ...owners.map((o) => ({
        userId: o.userId,
        name: name(o.userId, 'Owner'),
        role: 'OWNER',
      })),
      ...grants
        .filter((g) => staff.some((s) => s.userId === g.userId))
        .map((g) => ({
          userId: g.userId,
          name: name(g.userId, 'Staff'),
          role: g.role,
        })),
    ];
  }

  async history(v: ConnectViewer) {
    if (v.side !== 'SALON' || !v.canSeeHistory)
      throw connectError(
        'CONNECT_FORBIDDEN',
        'You do not have access to customer history.',
        HttpStatus.FORBIDDEN,
      );
    const c = v.conv;
    if (!c.salonId) return { visits: [], totalVisits: 0 };
    const visits = await this.prisma.booking.findMany({
      where: { salonId: c.salonId, customerId: c.customerId },
      orderBy: { slotStart: 'desc' },
      take: 10,
      select: {
        id: true,
        slotStart: true,
        status: true,
        services: { select: { serviceName: true, price: true } },
      },
    });
    const totalVisits = await this.prisma.booking.count({
      where: {
        salonId: c.salonId,
        customerId: c.customerId,
        status: 'COMPLETED',
      },
    });
    return {
      totalVisits,
      visits: visits.map((b) => ({
        reference: bookingReference(b.id),
        at: b.slotStart.toISOString(),
        status: b.status,
        services: b.services.map((s) => s.serviceName),
        totalPaise: b.services.reduce(
          (n, s) => n + Math.round(Number(s.price) * 100),
          0,
        ),
      })),
    };
  }

  // ---------- Salon actions on a conversation ----------

  async patch(
    v: ConnectViewer,
    p: {
      priority?: 'NORMAL' | 'HIGH' | 'URGENT';
      tags?: string[];
      resolved?: boolean;
    },
  ) {
    this.salonOnly(v);
    const data: Prisma.ConnectConversationUpdateInput = {};
    if (p.priority) data.priority = p.priority;
    if (p.tags) data.tags = [...new Set(p.tags.map((t) => t.toLowerCase()))];
    if (p.resolved !== undefined) {
      data.resolvedAt = p.resolved ? new Date() : null;
      if (p.resolved) data.awaiting = 'NONE';
    }
    await this.prisma.connectConversation.update({
      where: { id: v.conv.id },
      data,
    });
    if (p.resolved && v.conv.firstCustomerMsgAt)
      await this.prisma.connectAnalyticsEvent.create({
        data: {
          salonId: v.conv.salonId,
          homeProviderId: v.conv.homeProviderId,
          conversationId: v.conv.id,
          type: 'RESOLVED',
          actorUserId: v.userId,
          seconds: Math.round(
            (Date.now() - v.conv.firstCustomerMsgAt.getTime()) / 1000,
          ),
        },
      });
    await this.audit(v, 'CONVERSATION_UPDATED', p);
    return { ok: true };
  }

  async assign(v: ConnectViewer, toUserId: string | null) {
    this.salonOnly(v);
    if (!v.canAssign)
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the owner or a manager can assign conversations.',
        HttpStatus.FORBIDDEN,
      );
    if (toUserId) {
      const ok =
        (await this.staffDirectory(v.conv)).some(
          (s) => s.userId === toUserId,
        ) || (await this.access.tenantRole(toUserId, v.conv));
      if (!ok)
        throw connectError(
          'CONNECT_ASSIGNEE_INVALID',
          'That person cannot handle conversations for this salon.',
        );
    }
    await this.prisma.$transaction([
      this.prisma.connectConversation.update({
        where: { id: v.conv.id },
        data: {
          assignedToUserId: toUserId,
          assignedAt: toUserId ? new Date() : null,
        },
      }),
      this.prisma.connectAssignmentEvent.create({
        data: {
          conversationId: v.conv.id,
          fromUserId: v.conv.assignedToUserId,
          toUserId,
          byUserId: v.userId,
        },
      }),
    ]);
    if (toUserId && toUserId !== v.userId)
      await this.notify.update(
        { ...v.conv, assignedToUserId: toUserId },
        'SALON',
        `assign:${Date.now()}`,
        'A customer conversation was assigned to you.',
      );
    await this.audit(v, 'CONVERSATION_ASSIGNED', { toUserId });
    return { ok: true };
  }

  async notes(v: ConnectViewer) {
    this.salonOnly(v);
    const notes = await this.prisma.connectInternalNote.findMany({
      where: { conversationId: v.conv.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const dir = await this.staffDirectory(v.conv);
    return notes.map((n) => ({
      id: n.id,
      body: n.body,
      at: n.createdAt.toISOString(),
      author: dir.find((d) => d.userId === n.authorUserId)?.name ?? 'Staff',
      mine: n.authorUserId === v.userId,
    }));
  }

  async addNote(v: ConnectViewer, body: string) {
    this.salonOnly(v);
    await this.prisma.connectInternalNote.create({
      data: { conversationId: v.conv.id, authorUserId: v.userId, body },
    });
    const staff = await this.notify.recipients(v.conv, 'CUSTOMER');
    this.notify.pulse(
      staff.map((s) => s.userId),
      'connect.updated',
      { conversationId: v.conv.id },
    );
    return this.notes(v);
  }

  async setPrefs(
    v: ConnectViewer,
    p: { muted?: boolean; archived?: boolean; blocked?: boolean },
  ) {
    await this.prisma.connectParticipant.upsert({
      where: {
        conversationId_userId: { conversationId: v.conv.id, userId: v.userId },
      },
      create: {
        conversationId: v.conv.id,
        userId: v.userId,
        side: v.side,
        muted: p.muted ?? false,
        archived: p.archived ?? false,
      },
      update: {
        ...(p.muted !== undefined ? { muted: p.muted } : {}),
        ...(p.archived !== undefined ? { archived: p.archived } : {}),
      },
    });
    if (p.blocked !== undefined) {
      if (v.side === 'SALON' && !v.canAssign)
        throw connectError(
          'CONNECT_FORBIDDEN',
          'Only the owner or a manager can block a customer.',
          HttpStatus.FORBIDDEN,
        );
      await this.prisma.connectConversation.update({
        where: { id: v.conv.id },
        data:
          v.side === 'CUSTOMER'
            ? { customerBlockedAt: p.blocked ? new Date() : null }
            : { salonBlockedAt: p.blocked ? new Date() : null },
      });
      await this.audit(v, p.blocked ? 'BLOCKED' : 'UNBLOCKED', {
        side: v.side,
      });
    }
    return { ok: true };
  }

  // ---------- Saved replies, staff grants, salon settings ----------

  savedReplies(salonId: string) {
    return this.prisma.connectSavedReply.findMany({
      where: { salonId },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, body: true },
    });
  }

  async addSavedReply(
    salonId: string,
    userId: string,
    r: { title: string; body: string },
  ) {
    const n = await this.prisma.connectSavedReply.count({ where: { salonId } });
    if (n >= 100)
      throw connectError(
        'CONNECT_LIMIT',
        'A salon can keep up to 100 saved replies.',
      );
    await this.prisma.connectSavedReply.create({
      data: { salonId, title: r.title, body: r.body, createdById: userId },
    });
    return this.savedReplies(salonId);
  }

  async deleteSavedReply(salonId: string, id: string) {
    await this.prisma.connectSavedReply.deleteMany({ where: { id, salonId } });
    return this.savedReplies(salonId);
  }

  async grants(salonId: string) {
    const staff = await this.prisma.salonStaff.findMany({
      where: { salonId, accessRevokedAt: null },
      select: { userId: true, displayName: true, roleInSalon: true },
    });
    const grants = await this.prisma.connectStaffGrant.findMany({
      where: { salonId },
    });
    return staff.map((s) => ({
      userId: s.userId,
      name: s.displayName,
      salonRole: s.roleInSalon,
      connectRole: grants.find((g) => g.userId === s.userId)?.role ?? null,
    }));
  }

  async setGrant(
    salonId: string,
    ownerId: string,
    g: { userId: string; role: 'MANAGER' | 'RECEPTIONIST' | 'STYLIST' | null },
  ) {
    const staff = await this.prisma.salonStaff.findFirst({
      where: { salonId, userId: g.userId, accessRevokedAt: null },
    });
    if (!staff)
      throw connectError(
        'CONNECT_STAFF_INVALID',
        'That person is not active staff at this salon.',
      );
    if (g.role === null)
      await this.prisma.connectStaffGrant.deleteMany({
        where: { salonId, userId: g.userId },
      });
    else
      await this.prisma.connectStaffGrant.upsert({
        where: { salonId_userId: { salonId, userId: g.userId } },
        create: {
          salonId,
          userId: g.userId,
          role: g.role,
          grantedById: ownerId,
        },
        update: { role: g.role, grantedById: ownerId },
      });
    await this.prisma.connectAuditEvent.create({
      data: {
        salonId,
        actorUserId: ownerId,
        action: 'STAFF_GRANT_CHANGED',
        meta: g,
      },
    });
    return this.grants(salonId);
  }

  async salonSettings(tenant: ConnectTenant) {
    const s = await this.prisma.connectSalonSettings.findFirst({
      where: tenant.salonId
        ? { salonId: tenant.salonId }
        : { homeProviderId: tenant.homeProviderId },
    });
    return {
      aiMode: s?.aiMode ?? 'OFF',
      autoReplyIntents: s?.autoReplyIntents ?? [],
      translationEnabled: s?.translationEnabled ?? false,
      followUpsEnabled: s?.followUpsEnabled ?? false,
      faq: (s?.faq as { q: string; a: string }[] | null) ?? [],
      parkingInfo: s?.parkingInfo ?? null,
      directions: s?.directions ?? null,
      aftercare: s?.aftercare ?? null,
    };
  }

  async saveSalonSettings(
    tenant: ConnectTenant,
    userId: string,
    p: Record<string, unknown>,
  ) {
    const data: Prisma.ConnectSalonSettingsUncheckedCreateInput = {
      ...tenant,
      updatedById: userId,
    };
    for (const k of [
      'aiMode',
      'autoReplyIntents',
      'translationEnabled',
      'followUpsEnabled',
      'faq',
      'parkingInfo',
      'directions',
      'aftercare',
    ] as const) {
      if (p[k] !== undefined) (data as Record<string, unknown>)[k] = p[k];
    }
    const { salonId, homeProviderId, ...rest } = data;
    const existing = await this.prisma.connectSalonSettings.findFirst({
      where: salonId ? { salonId } : { homeProviderId },
    });
    if (existing)
      await this.prisma.connectSalonSettings.update({
        where: { id: existing.id },
        data: rest,
      });
    else
      await this.prisma.connectSalonSettings.create({
        data: {
          salonId,
          homeProviderId,
          ...(rest as object),
        },
      });
    await this.prisma.connectAuditEvent.create({
      data: {
        salonId: tenant.salonId,
        actorUserId: userId,
        action: 'SALON_SETTINGS_UPDATED',
        meta: p as Prisma.InputJsonValue,
      },
    });
    return this.salonSettings(tenant);
  }

  // ---------- User preferences (privacy, previews, language, promotions) ----------

  async userPrefs(userId: string) {
    const p = await this.prisma.connectUserPrefs.findUnique({
      where: { userId },
    });
    const promo = await this.prisma.connectConsentRecord.findFirst({
      where: { userId, purpose: 'PROMOTIONAL_MESSAGES', salonId: null },
      orderBy: { createdAt: 'desc' },
    });
    return {
      showOnline: p?.showOnline ?? false,
      showLastActive: p?.showLastActive ?? false,
      notificationPreviews: p?.notificationPreviews ?? false,
      preferredLanguage: p?.preferredLanguage ?? null,
      promotionalMessages: promo?.granted ?? false,
    };
  }

  async setUserPrefs(
    userId: string,
    p: {
      showOnline?: boolean;
      showLastActive?: boolean;
      notificationPreviews?: boolean;
      preferredLanguage?: string | null;
      promotionalMessages?: boolean;
    },
  ) {
    const { promotionalMessages, ...rest } = p;
    await this.prisma.connectUserPrefs.upsert({
      where: { userId },
      create: { userId, ...rest },
      update: rest,
    });
    if (promotionalMessages !== undefined)
      await this.prisma.connectConsentRecord.create({
        data: {
          userId,
          purpose: 'PROMOTIONAL_MESSAGES',
          granted: promotionalMessages,
          source: 'CONNECT_SETTINGS',
        },
      });
    if (p.notificationPreviews !== undefined)
      await this.prisma.connectConsentRecord.create({
        data: {
          userId,
          purpose: 'NOTIFICATION_PREVIEWS',
          granted: p.notificationPreviews,
          source: 'CONNECT_SETTINGS',
        },
      });
    return this.userPrefs(userId);
  }

  /** Data export (section 20): the customer's own conversations as JSON. */
  async exportMine(userId: string) {
    const convs = await this.prisma.connectConversation.findMany({
      where: { customerId: userId },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { seq: 'asc' },
          select: {
            seq: true,
            senderKind: true,
            body: true,
            kind: true,
            createdAt: true,
            aiGenerated: true,
          },
        },
      },
    });
    return {
      exportedAt: new Date().toISOString(),
      conversations: convs.map((c) => ({
        id: c.id,
        kind: c.kind,
        createdAt: c.createdAt,
        messages: c.messages,
      })),
    };
  }

  private salonOnly(v: ConnectViewer) {
    if (v.side !== 'SALON')
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
  }

  private audit(v: ConnectViewer, action: string, meta: unknown) {
    return this.prisma.connectAuditEvent.create({
      data: {
        salonId: v.conv.salonId,
        conversationId: v.conv.id,
        actorUserId: v.userId,
        action,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }
}
