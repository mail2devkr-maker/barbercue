import { randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  type ConnectConversation,
  type ConnectMessage,
} from '@prisma/client';
import {
  CONNECT_TEMPLATES,
  detectConnectLanguage,
  type ConnectMessageDto,
  type ConnectSendInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service';
import {
  ConnectAccessService,
  type ConnectViewer,
} from './connect-access.service';
import {
  ConnectConfigService,
  connectError,
  connectFlag,
} from './connect-config';
import { ConnectLinksService } from './connect-links.service';
import {
  pdfLooksActive,
  safeFileName,
  sha256,
  signMediaUrl,
  sniffMedia,
} from './connect-media';
import { ConnectNotifyService } from './connect-notify.service';
import { detectIntent } from './ai/connect-intent';

const EDIT_WINDOW_MS = 15 * 60_000;
const LOCK_MS = 90_000;
const URL_RE = /\b(https?:\/\/|www\.)\S+/i;

type MessageRow = ConnectMessage & {
  reactions: { emoji: string; userId: string }[];
  attachments: {
    id: string;
    mimeType: string;
    sizeBytes: number;
    fileName: string | null;
    scanStatus: string;
  }[];
};

export type CustomerMessageHook = (
  conv: ConnectConversation,
  msg: ConnectMessage,
) => Promise<void>;

/**
 * Messages (spec section 3). Ordering: a per-conversation `seq` allocated under the conversation
 * row lock. Duplicates: (conversation, sender, clientMessageId) is unique, so a retried send
 * returns the original message. Every method takes a ConnectViewer produced by the access gate.
 */
@Injectable()
export class ConnectMessagesService {
  private readonly logger = new Logger(ConnectMessagesService.name);
  private readonly customerHooks: CustomerMessageHook[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ConnectAccessService,
    private readonly links: ConnectLinksService,
    private readonly notify: ConnectNotifyService,
    private readonly config: ConnectConfigService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  /** The AI pipeline subscribes here; hooks run after the send has committed and never block it. */
  onCustomerMessage(hook: CustomerMessageHook): void {
    this.customerHooks.push(hook);
  }

  // ---------- Send ----------

  async send(
    v: ConnectViewer,
    input: ConnectSendInput,
  ): Promise<ConnectMessageDto> {
    const dup = await this.prisma.connectMessage.findUnique({
      where: {
        conversationId_senderUserId_clientMessageId: {
          conversationId: v.conv.id,
          senderUserId: v.userId,
          clientMessageId: input.clientMessageId,
        },
      },
    });
    if (dup) return this.one(v, dup.id);

    const life = await this.links.lifecycle(v.conv);
    if (life.status === 'READ_ONLY')
      throw connectError(
        'CONNECT_READ_ONLY',
        life.reason ?? 'This conversation is read-only.',
        HttpStatus.CONFLICT,
      );
    if (v.side === 'CUSTOMER' && v.conv.salonBlockedAt)
      throw connectError(
        'CONNECT_BLOCKED',
        'The salon is not accepting messages in this conversation.',
        HttpStatus.FORBIDDEN,
      );
    if (v.side === 'SALON' && v.conv.customerBlockedAt)
      throw connectError(
        'CONNECT_BLOCKED',
        'The customer has blocked messages in this conversation.',
        HttpStatus.FORBIDDEN,
      );
    if (v.side === 'CUSTOMER' && v.conv.customerBlockedAt)
      throw connectError(
        'CONNECT_BLOCKED',
        'You blocked this salon. Unblock it to send messages.',
        HttpStatus.FORBIDDEN,
      );

    const cfg = await this.config.get();
    const template = input.templateKey
      ? CONNECT_TEMPLATES.find((t) => t.key === input.templateKey)
      : undefined;
    const body = (input.body ?? template?.text ?? '').trim() || null;
    if (body && body.length > cfg.limits.maxMessageChars)
      throw connectError(
        'CONNECT_TOO_LONG',
        `Messages can be up to ${cfg.limits.maxMessageChars} characters.`,
      );
    if (
      body &&
      v.side === 'CUSTOMER' &&
      cfg.moderation.blockLinksFromCustomers &&
      URL_RE.test(body)
    )
      throw connectError(
        'CONNECT_LINKS_BLOCKED',
        'Links cannot be sent in this chat.',
      );

    const recent = await this.prisma.connectMessage.count({
      where: {
        conversationId: v.conv.id,
        senderUserId: v.userId,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (recent >= cfg.limits.messagesPerMinute)
      throw connectError(
        'CONNECT_RATE_LIMITED',
        'You are sending messages too quickly. Please wait a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    // Collision prevention for salon staff (spec section 4).
    if (v.side === 'SALON') {
      const now = new Date();
      if (
        v.conv.lockUserId &&
        v.conv.lockUserId !== v.userId &&
        v.conv.lockExpiresAt &&
        v.conv.lockExpiresAt > now
      )
        throw connectError(
          'CONNECT_LOCKED',
          'A colleague is replying to this customer right now.',
          HttpStatus.CONFLICT,
          { lockUserId: v.conv.lockUserId },
        );
      if (
        input.lastSeenSeq !== undefined &&
        v.conv.lastSalonReplySeq > input.lastSeenSeq
      ) {
        const last = await this.prisma.connectMessage.findUnique({
          where: {
            conversationId_seq: {
              conversationId: v.conv.id,
              seq: v.conv.lastSalonReplySeq,
            },
          },
          select: { senderUserId: true },
        });
        if (last && last.senderUserId !== v.userId)
          throw connectError(
            'CONNECT_NEWER_REPLY',
            'A colleague already replied. Read their reply before sending yours.',
            HttpStatus.CONFLICT,
            { seq: v.conv.lastSalonReplySeq },
          );
      }
    }

    const attachmentIds = input.attachmentIds ?? [];
    const atts = attachmentIds.length
      ? await this.prisma.connectAttachment.findMany({
          where: {
            id: { in: attachmentIds },
            conversationId: v.conv.id,
            uploaderUserId: v.userId,
            messageId: null,
          },
        })
      : [];
    if (atts.length !== attachmentIds.length)
      throw connectError(
        'CONNECT_ATTACHMENT_INVALID',
        'An attachment is missing or was already sent.',
      );
    if (input.replyToId) {
      const r = await this.prisma.connectMessage.findFirst({
        where: { id: input.replyToId, conversationId: v.conv.id },
        select: { id: true },
      });
      if (!r)
        throw connectError(
          'CONNECT_REPLY_INVALID',
          'The message you replied to is not in this conversation.',
        );
    }
    const kind = atts[0]?.mimeType.startsWith('image/')
      ? 'IMAGE'
      : atts[0]?.mimeType.startsWith('audio/')
        ? 'VOICE'
        : atts[0]
          ? 'FILE'
          : 'TEXT';
    const intent =
      v.side === 'CUSTOMER' && body && connectFlag('CONNECT_AI_ENABLED')
        ? detectIntent(body).intent
        : null;

    let created: ConnectMessage;
    let conv: ConnectConversation;
    try {
      ({ created, conv } = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const bumped = await tx.connectConversation.update({
          where: { id: v.conv.id },
          data: { lastMessageSeq: { increment: 1 } },
        });
        const seq = bumped.lastMessageSeq;
        const m = await tx.connectMessage.create({
          data: {
            conversationId: v.conv.id,
            seq,
            senderUserId: v.userId,
            senderKind: v.side,
            kind,
            body,
            language: body ? detectConnectLanguage(body) : null,
            intent,
            replyToId: input.replyToId ?? null,
            clientMessageId: input.clientMessageId,
            meta: template
              ? { templateKey: template.key }
              : input.fromSuggestionId
                ? { fromSuggestionId: input.fromSuggestionId }
                : undefined,
          },
        });
        if (atts.length)
          await tx.connectAttachment.updateMany({
            where: { id: { in: atts.map((a) => a.id) } },
            data: { messageId: m.id },
          });
        const data: Prisma.ConnectConversationUpdateInput = {
          lastMessageAt: now,
          awaiting: v.side === 'CUSTOMER' ? 'SALON' : 'CUSTOMER',
        };
        if (v.side === 'CUSTOMER') {
          if (!bumped.firstCustomerMsgAt) data.firstCustomerMsgAt = now;
          data.resolvedAt = null;
        } else {
          data.lastSalonReplySeq = seq;
          data.lockUserId = null;
          data.lockExpiresAt = null;
          if (!bumped.firstSalonReplyAt) data.firstSalonReplyAt = now;
          // A person replied: the conversation is no longer only AI-handled.
          data.aiHandled = false;
        }
        const c = await tx.connectConversation.update({
          where: { id: v.conv.id },
          data,
        });
        await tx.connectParticipant.upsert({
          where: {
            conversationId_userId: {
              conversationId: v.conv.id,
              userId: v.userId,
            },
          },
          create: {
            conversationId: v.conv.id,
            userId: v.userId,
            side: v.side,
            lastReadSeq: seq,
            lastDeliveredSeq: seq,
            lastSeenAt: now,
          },
          update: {
            lastReadSeq: seq,
            lastDeliveredSeq: seq,
            lastSeenAt: now,
            archived: false,
          },
        });
        if (
          v.side === 'SALON' &&
          !bumped.firstSalonReplyAt &&
          bumped.firstCustomerMsgAt
        ) {
          await tx.connectAnalyticsEvent.create({
            data: {
              salonId: c.salonId,
              homeProviderId: c.homeProviderId,
              conversationId: c.id,
              type: 'FIRST_RESPONSE',
              actorUserId: v.userId,
              seconds: Math.round(
                (now.getTime() - bumped.firstCustomerMsgAt.getTime()) / 1000,
              ),
            },
          });
        }
        if (v.side === 'SALON') {
          await tx.connectAnalyticsEvent.create({
            data: {
              salonId: c.salonId,
              homeProviderId: c.homeProviderId,
              conversationId: c.id,
              type: input.fromSuggestionId
                ? 'STAFF_REPLY_FROM_AI'
                : 'STAFF_REPLY',
              actorUserId: v.userId,
            },
          });
        }
        return { created: m, conv: c };
      }));
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const again = await this.prisma.connectMessage.findUnique({
          where: {
            conversationId_senderUserId_clientMessageId: {
              conversationId: v.conv.id,
              senderUserId: v.userId,
              clientMessageId: input.clientMessageId,
            },
          },
        });
        if (again) return this.one(v, again.id);
      }
      throw err;
    }

    await this.notify.message(
      conv,
      { seq: created.seq, body: created.body, senderUserId: v.userId },
      v.side,
    );
    if (v.side === 'CUSTOMER') this.runHooks(conv, created);
    return this.one(v, created.id);
  }

  private runHooks(conv: ConnectConversation, msg: ConnectMessage) {
    for (const hook of this.customerHooks) {
      void hook(conv, msg).catch((err) =>
        this.logger.warn(
          `Connect pipeline failed for ${conv.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        ),
      );
    }
  }

  /**
   * A message from the system or Connect AI (section 5, 8). AI messages are labelled
   * (`aiGenerated`, sender AI) everywhere they are shown.
   */
  async post(
    convId: string,
    m: {
      body: string | null;
      senderKind: 'SYSTEM' | 'AI';
      kind?: ConnectMessage['kind'];
      meta?: Record<string, unknown>;
      intent?: string | null;
      notify?: 'CUSTOMER' | 'SALON' | 'BOTH' | 'NONE';
      urgent?: boolean;
    },
  ): Promise<ConnectMessage> {
    const { created, conv } = await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.connectConversation.update({
        where: { id: convId },
        data: { lastMessageSeq: { increment: 1 }, lastMessageAt: new Date() },
      });
      const created = await tx.connectMessage.create({
        data: {
          conversationId: convId,
          seq: bumped.lastMessageSeq,
          senderKind: m.senderKind,
          kind: m.kind ?? (m.senderKind === 'AI' ? 'TEXT' : 'SYSTEM'),
          body: m.body,
          aiGenerated: m.senderKind === 'AI',
          intent: m.intent ?? null,
          meta: (m.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      return { created, conv: bumped };
    });
    const to = m.notify ?? 'NONE';
    if (to === 'NONE') {
      const all = await this.notify.recipients(conv, null);
      this.notify.pulse(
        all.map((r) => r.userId),
        'connect.message',
        { conversationId: conv.id, seq: created.seq },
      );
    } else {
      // "from" is the opposite of who should be told.
      const from =
        to === 'CUSTOMER' ? 'SALON' : to === 'SALON' ? 'CUSTOMER' : null;
      await this.notify.message(
        conv,
        { seq: created.seq, body: created.body, senderUserId: null },
        from,
        { urgent: m.urgent },
      );
    }
    return created;
  }

  // ---------- Read ----------

  async list(
    v: ConnectViewer,
    q: { before?: number; after?: number; limit?: number },
  ): Promise<{ messages: ConnectMessageDto[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(q.limit ?? 40, 1), 100);
    const where: Prisma.ConnectMessageWhereInput = {
      conversationId: v.conv.id,
    };
    if (q.after !== undefined) where.seq = { gt: q.after };
    else if (q.before !== undefined) where.seq = { lt: q.before };
    const rows = await this.prisma.connectMessage.findMany({
      where,
      orderBy: { seq: q.after !== undefined ? 'asc' : 'desc' },
      take: limit + 1,
      include: {
        reactions: { select: { emoji: true, userId: true } },
        attachments: {
          select: {
            id: true,
            mimeType: true,
            sizeBytes: true,
            fileName: true,
            scanStatus: true,
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).sort((a, b) => a.seq - b.seq);
    await this.markDelivered(v, page.length ? page[page.length - 1].seq : 0);
    return { messages: await this.toDtos(v, page), hasMore };
  }

  async one(v: ConnectViewer, id: string): Promise<ConnectMessageDto> {
    const row = await this.prisma.connectMessage.findFirst({
      where: { id, conversationId: v.conv.id },
      include: {
        reactions: { select: { emoji: true, userId: true } },
        attachments: {
          select: {
            id: true,
            mimeType: true,
            sizeBytes: true,
            fileName: true,
            scanStatus: true,
          },
        },
      },
    });
    if (!row)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    return (await this.toDtos(v, [row]))[0];
  }

  private async toDtos(
    v: ConnectViewer,
    rows: MessageRow[],
  ): Promise<ConnectMessageDto[]> {
    if (!rows.length) return [];
    const replyIds = rows
      .map((r) => r.replyToId)
      .filter((x): x is string => !!x);
    const replies = replyIds.length
      ? await this.prisma.connectMessage.findMany({
          where: { id: { in: replyIds }, conversationId: v.conv.id },
          select: { id: true, seq: true, body: true, deletedAt: true },
        })
      : [];
    // Receipts: how far the OTHER side has delivered/read.
    const others = await this.prisma.connectParticipant.findMany({
      where: {
        conversationId: v.conv.id,
        side: v.side === 'CUSTOMER' ? 'SALON' : 'CUSTOMER',
      },
      select: { lastReadSeq: true, lastDeliveredSeq: true },
    });
    const read = Math.max(0, ...others.map((o) => o.lastReadSeq));
    const delivered = Math.max(0, ...others.map((o) => o.lastDeliveredSeq));
    const senderIds = [
      ...new Set(
        rows
          .map((r) => r.senderUserId)
          .filter((x): x is string => !!x && x !== v.conv.customerId),
      ),
    ];
    const staff =
      senderIds.length && v.conv.salonId
        ? await this.prisma.salonStaff.findMany({
            where: { salonId: v.conv.salonId, userId: { in: senderIds } },
            select: { userId: true, displayName: true },
          })
        : [];
    return rows.map((r) => {
      const mineSide =
        r.senderKind === v.side ||
        (v.side === 'SALON' && r.senderKind === 'AI');
      const reply = r.replyToId
        ? replies.find((x) => x.id === r.replyToId)
        : null;
      const counts = new Map<string, { count: number; mine: boolean }>();
      for (const x of r.reactions) {
        const c = counts.get(x.emoji) ?? { count: 0, mine: false };
        c.count += 1;
        c.mine ||= x.userId === v.userId;
        counts.set(x.emoji, c);
      }
      return {
        id: r.id,
        seq: r.seq,
        sender: r.senderKind,
        mine: r.senderUserId === v.userId,
        senderName:
          r.senderKind === 'AI'
            ? 'FastQue Connect AI'
            : r.senderKind === 'SYSTEM'
              ? null
              : r.senderKind === 'CUSTOMER'
                ? v.side === 'CUSTOMER'
                  ? 'You'
                  : 'Customer'
                : v.side === 'SALON'
                  ? (staff.find((s) => s.userId === r.senderUserId)
                      ?.displayName ?? 'Owner')
                  : 'Salon',
        kind: r.kind,
        body: r.deletedAt ? null : r.body,
        language: r.language,
        // The detected intent is an internal routing signal: staff see it, customers do not.
        intent: v.side === 'SALON' ? r.intent : null,
        replyTo: reply
          ? {
              id: reply.id,
              seq: reply.seq,
              body: reply.deletedAt
                ? null
                : (reply.body?.slice(0, 140) ?? null),
            }
          : null,
        aiGenerated: r.aiGenerated,
        meta: (r.meta as Record<string, unknown> | null) ?? null,
        edited: !!r.editedAt,
        deleted: !!r.deletedAt,
        reactions: [...counts.entries()].map(([emoji, c]) => ({ emoji, ...c })),
        attachments: r.deletedAt
          ? []
          : r.attachments.map((a) => ({
              ...a,
              url: signMediaUrl(a.id, v.userId),
            })),
        createdAt: r.createdAt.toISOString(),
        status:
          mineSide && r.senderKind !== 'SYSTEM'
            ? r.seq <= read
              ? 'read'
              : r.seq <= delivered
                ? 'delivered'
                : 'sent'
            : null,
      };
    });
  }

  private async markDelivered(v: ConnectViewer, seq: number) {
    await this.prisma.connectParticipant.upsert({
      where: {
        conversationId_userId: { conversationId: v.conv.id, userId: v.userId },
      },
      create: {
        conversationId: v.conv.id,
        userId: v.userId,
        side: v.side,
        lastDeliveredSeq: seq,
        lastSeenAt: new Date(),
      },
      update: { lastSeenAt: new Date() },
    });
    // Receipts only move forward (reading an older page never lowers them).
    await this.prisma.connectParticipant.updateMany({
      where: {
        conversationId: v.conv.id,
        userId: v.userId,
        lastDeliveredSeq: { lt: seq },
      },
      data: { lastDeliveredSeq: seq },
    });
  }

  async markRead(
    v: ConnectViewer,
    seq: number,
  ): Promise<{ lastReadSeq: number }> {
    const upto = Math.min(seq, v.conv.lastMessageSeq);
    const p = await this.prisma.connectParticipant.upsert({
      where: {
        conversationId_userId: { conversationId: v.conv.id, userId: v.userId },
      },
      create: {
        conversationId: v.conv.id,
        userId: v.userId,
        side: v.side,
        lastReadSeq: upto,
        lastDeliveredSeq: upto,
        lastSeenAt: new Date(),
      },
      update: { lastSeenAt: new Date() },
    });
    await this.prisma.connectParticipant.updateMany({
      where: { id: p.id, lastReadSeq: { lt: upto } },
      data: { lastReadSeq: upto },
    });
    await this.prisma.connectParticipant.updateMany({
      where: { id: p.id, lastDeliveredSeq: { lt: upto } },
      data: { lastDeliveredSeq: upto },
    });
    const all = await this.notify.recipients(v.conv, v.side);
    this.notify.pulse(
      all.map((r) => r.userId),
      'connect.read',
      { conversationId: v.conv.id, side: v.side, seq: upto },
    );
    return { lastReadSeq: Math.max(p.lastReadSeq, upto) };
  }

  // ---------- Edit, delete, react ----------

  async edit(
    v: ConnectViewer,
    messageId: string,
    body: string,
  ): Promise<ConnectMessageDto> {
    const m = await this.own(v, messageId);
    if (m.kind !== 'TEXT' || m.deletedAt)
      throw connectError(
        'CONNECT_NOT_EDITABLE',
        'This message cannot be edited.',
      );
    if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS)
      throw connectError(
        'CONNECT_EDIT_WINDOW',
        'Messages can only be edited for 15 minutes.',
      );
    if (body === m.body) return this.one(v, m.id);
    await this.prisma.$transaction([
      this.prisma.connectMessageEdit.create({
        data: {
          messageId: m.id,
          previousBody: m.body,
          editedByUserId: v.userId,
          action: 'EDIT',
        },
      }),
      this.prisma.connectMessage.update({
        where: { id: m.id },
        data: {
          body,
          editedAt: new Date(),
          language: detectConnectLanguage(body),
        },
      }),
    ]);
    await this.pulseChange(v);
    return this.one(v, m.id);
  }

  /** Senders delete their own messages; the text is kept only in the edit audit for moderation. */
  async remove(
    v: ConnectViewer,
    messageId: string,
  ): Promise<ConnectMessageDto> {
    const m = await this.own(v, messageId);
    if (!m.deletedAt) {
      await this.prisma.$transaction([
        this.prisma.connectMessageEdit.create({
          data: {
            messageId: m.id,
            previousBody: m.body,
            editedByUserId: v.userId,
            action: 'DELETE',
          },
        }),
        this.prisma.connectMessage.update({
          where: { id: m.id },
          data: { deletedAt: new Date(), body: null },
        }),
      ]);
      await this.pulseChange(v);
    }
    return this.one(v, m.id);
  }

  async history(v: ConnectViewer, messageId: string) {
    const m = await this.prisma.connectMessage.findFirst({
      where: { id: messageId, conversationId: v.conv.id },
      select: { id: true, senderUserId: true },
    });
    if (!m)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    // The sender, and salon managers/owners, may see what an edited message said before.
    if (m.senderUserId !== v.userId && !v.canAssign)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    const edits = await this.prisma.connectMessageEdit.findMany({
      where: { messageId, action: 'EDIT' },
      orderBy: { createdAt: 'asc' },
      select: { previousBody: true, createdAt: true },
    });
    return edits.map((e) => ({
      previousBody: e.previousBody,
      editedAt: e.createdAt.toISOString(),
    }));
  }

  async react(
    v: ConnectViewer,
    messageId: string,
    emoji: string,
  ): Promise<ConnectMessageDto> {
    const m = await this.prisma.connectMessage.findFirst({
      where: { id: messageId, conversationId: v.conv.id, deletedAt: null },
      select: { id: true },
    });
    if (!m)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    const key = {
      messageId_userId_emoji: { messageId, userId: v.userId, emoji },
    };
    const existing = await this.prisma.connectReaction.findUnique({
      where: key,
    });
    if (existing) await this.prisma.connectReaction.delete({ where: key });
    else {
      const mine = await this.prisma.connectReaction.count({
        where: { messageId, userId: v.userId },
      });
      if (mine >= 6)
        throw connectError(
          'CONNECT_REACTION_LIMIT',
          'Too many reactions on one message.',
        );
      await this.prisma.connectReaction.create({
        data: { messageId, userId: v.userId, emoji },
      });
    }
    await this.pulseChange(v);
    return this.one(v, messageId);
  }

  private async own(v: ConnectViewer, messageId: string) {
    const m = await this.prisma.connectMessage.findFirst({
      where: {
        id: messageId,
        conversationId: v.conv.id,
        senderUserId: v.userId,
      },
    });
    if (!m)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    return m;
  }

  private async pulseChange(v: ConnectViewer) {
    const all = await this.notify.recipients(v.conv, null);
    this.notify.pulse(
      all.map((r) => r.userId),
      'connect.updated',
      { conversationId: v.conv.id },
    );
  }

  // ---------- Typing, presence, replying lock ----------

  async typing(v: ConnectViewer): Promise<void> {
    const others = await this.notify.recipients(v.conv, v.side);
    this.notify.pulse(
      others.map((r) => r.userId),
      'connect.typing',
      { conversationId: v.conv.id, side: v.side },
    );
    if (v.side === 'SALON') {
      // Collision prevention: hold a short "replying" lock unless a colleague holds one.
      await this.prisma.connectConversation.updateMany({
        where: {
          id: v.conv.id,
          OR: [
            { lockUserId: null },
            { lockUserId: v.userId },
            { lockExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          lockUserId: v.userId,
          lockExpiresAt: new Date(Date.now() + LOCK_MS),
        },
      });
      const colleagues = (
        await this.notify.recipients(v.conv, 'CUSTOMER')
      ).filter((r) => r.userId !== v.userId);
      this.notify.pulse(
        colleagues.map((r) => r.userId),
        'connect.updated',
        { conversationId: v.conv.id },
      );
    }
    await this.touch(v);
  }

  async touch(v: ConnectViewer) {
    await this.prisma.connectParticipant.upsert({
      where: {
        conversationId_userId: { conversationId: v.conv.id, userId: v.userId },
      },
      create: {
        conversationId: v.conv.id,
        userId: v.userId,
        side: v.side,
        lastSeenAt: new Date(),
      },
      update: { lastSeenAt: new Date() },
    });
  }

  /** The other side's presence, only as far as their privacy settings allow (default: hidden). */
  async presence(
    v: ConnectViewer,
  ): Promise<{ online: boolean | null; lastActiveAt: string | null }> {
    const others = await this.prisma.connectParticipant.findMany({
      where: {
        conversationId: v.conv.id,
        side: v.side === 'CUSTOMER' ? 'SALON' : 'CUSTOMER',
      },
      select: { userId: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
      take: 5,
    });
    const prefs = await this.prisma.connectUserPrefs.findMany({
      where: { userId: { in: others.map((o) => o.userId) } },
    });
    let online: boolean | null = null;
    let last: Date | null = null;
    for (const o of others) {
      const p = prefs.find((x) => x.userId === o.userId);
      if (p?.showOnline)
        online =
          (online ?? false) ||
          (!!o.lastSeenAt && Date.now() - o.lastSeenAt.getTime() < 60_000);
      if (p?.showLastActive && o.lastSeenAt && (!last || o.lastSeenAt > last))
        last = o.lastSeenAt;
    }
    return { online, lastActiveAt: last?.toISOString() ?? null };
  }

  // ---------- Attachments ----------

  async upload(
    v: ConnectViewer,
    file: { buffer: Buffer; originalname?: string; size: number } | undefined,
  ) {
    if (!file?.buffer?.length)
      throw connectError(
        'CONNECT_ATTACHMENT_MISSING',
        'Choose a file to send.',
      );
    const life = await this.links.lifecycle(v.conv);
    if (life.status === 'READ_ONLY')
      throw connectError(
        'CONNECT_READ_ONLY',
        life.reason ?? 'This conversation is read-only.',
        HttpStatus.CONFLICT,
      );
    const sniffed = sniffMedia(file.buffer);
    if (!sniffed)
      throw connectError(
        'CONNECT_ATTACHMENT_TYPE',
        'Only photos (JPEG, PNG, WebP), PDF documents and voice notes can be sent.',
      );
    const cfg = await this.config.get();
    const max =
      sniffed.kind === 'VOICE'
        ? cfg.limits.maxVoiceBytes
        : cfg.limits.maxAttachmentBytes;
    if (file.buffer.length > max)
      throw connectError(
        'CONNECT_ATTACHMENT_SIZE',
        `This file is too large (limit ${Math.round(max / 1024 / 1024)} MB).`,
      );
    if (sniffed.mime === 'application/pdf' && pdfLooksActive(file.buffer))
      throw connectError(
        'CONNECT_ATTACHMENT_UNSAFE',
        'This PDF contains scripts or embedded files and cannot be sent.',
      );
    const today = await this.prisma.connectAttachment.count({
      where: {
        uploaderUserId: v.userId,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (today >= 60)
      throw connectError(
        'CONNECT_RATE_LIMITED',
        'Too many uploads. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const key = `connect/${v.conv.id}/${randomUUID()}.${sniffed.ext}`;
    await this.storage.put(key, file.buffer, sniffed.mime);
    const a = await this.prisma.connectAttachment.create({
      data: {
        conversationId: v.conv.id,
        uploaderUserId: v.userId,
        storageKey: key,
        mimeType: sniffed.mime,
        sizeBytes: file.buffer.length,
        sha256: sha256(file.buffer),
        fileName: safeFileName(file.originalname),
      },
    });
    return {
      id: a.id,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      fileName: a.fileName,
      url: signMediaUrl(a.id, v.userId),
      scanStatus: a.scanStatus,
    };
  }

  /** Signed-URL download. The route verified the signature; this re-checks participation. */
  async download(attachmentId: string, userId: string) {
    const a = await this.prisma.connectAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!a)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    await this.access.load(a.conversationId, userId);
    if (a.messageId) {
      const m = await this.prisma.connectMessage.findUnique({
        where: { id: a.messageId },
        select: { deletedAt: true },
      });
      if (m?.deletedAt)
        throw connectError(
          'CONNECT_NOT_FOUND',
          'Not found.',
          HttpStatus.NOT_FOUND,
        );
    } else if (a.uploaderUserId !== userId) {
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const body = await this.storage.get(a.storageKey);
    if (!body)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    return {
      body,
      mimeType: a.mimeType,
      fileName: a.fileName ?? `attachment-${a.id.slice(0, 8)}`,
    };
  }
}
