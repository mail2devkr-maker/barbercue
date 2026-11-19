import { randomUUID } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SUPPORT_OPEN_STATUSES,
  SUPPORT_SLA_HOURS,
  SUPPORT_STATUS_LABEL,
  type CrmPageDto,
  type SupportTicketDto,
  type SupportTicketInput,
  type SupportTicketListQuery,
  type SupportTicketStatus,
  type SupportTicketUpdateInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { detectImageMimeType } from '../storage/image-signature';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service';
import {
  CrmAccessService,
  forbidden,
  notFound,
  type CrmActor,
} from './crm-access.service';
import { logLeadActivity, notifyCrm } from './crm-events';

const include = {
  createdBy: {
    select: {
      id: true,
      email: true,
      employeeProfile: { select: { fullName: true } },
    },
  },
  assignedTo: {
    select: {
      id: true,
      email: true,
      employeeProfile: { select: { fullName: true } },
    },
  },
  lead: { select: { id: true, shopName: true } },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      author: {
        select: {
          email: true,
          employeeProfile: { select: { fullName: true } },
        },
      },
    },
  },
  attachments: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.SupportTicketInclude;
type Row = Prisma.SupportTicketGetPayload<{ include: typeof include }>;
const name = (
  u: {
    email: string | null;
    employeeProfile: { fullName: string } | null;
  } | null,
) => u?.employeeProfile?.fullName ?? u?.email ?? null;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Allowed status moves (support staff), and what an employee may do on their own ticket. */
const STAFF_MOVES: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  OPEN: [
    'ASSIGNED',
    'IN_PROGRESS',
    'WAITING_EMPLOYEE',
    'WAITING_SALON',
    'RESOLVED',
    'CLOSED',
  ],
  ASSIGNED: [
    'IN_PROGRESS',
    'WAITING_EMPLOYEE',
    'WAITING_SALON',
    'RESOLVED',
    'CLOSED',
  ],
  IN_PROGRESS: ['WAITING_EMPLOYEE', 'WAITING_SALON', 'RESOLVED', 'CLOSED'],
  WAITING_EMPLOYEE: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  WAITING_SALON: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: [
    'ASSIGNED',
    'IN_PROGRESS',
    'WAITING_EMPLOYEE',
    'WAITING_SALON',
    'RESOLVED',
    'CLOSED',
  ],
};
const OWNER_MOVES: Partial<Record<SupportTicketStatus, SupportTicketStatus[]>> =
  {
    RESOLVED: ['CLOSED', 'REOPENED'],
    CLOSED: ['REOPENED'],
    WAITING_EMPLOYEE: ['IN_PROGRESS'],
  };

@Injectable()
export class CrmTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CrmAccessService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  private dto(t: Row, a: CrmActor): SupportTicketDto {
    return {
      id: t.id,
      number: t.number,
      code: `FQ-T-${String(t.number).padStart(5, '0')}`,
      category: t.category,
      subject: t.subject,
      description: t.description,
      priority: t.priority,
      status: t.status,
      createdBy: { id: t.createdBy.id, name: name(t.createdBy) },
      assignedTo: t.assignedTo
        ? { id: t.assignedTo.id, name: name(t.assignedTo) }
        : null,
      lead: t.lead,
      salonId: t.salonId,
      slaDueAt: t.slaDueAt.toISOString(),
      slaBreached:
        SUPPORT_OPEN_STATUSES.includes(t.status) && t.slaDueAt < new Date(),
      escalatedAt: t.escalatedAt?.toISOString() ?? null,
      resolutionNotes: t.resolutionNotes,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      // Internal notes are for support staff only.
      comments: t.comments
        .filter((c) => a.manage || !c.internal)
        .map((c) => ({
          id: c.id,
          author: name(c.author),
          body: c.body,
          internal: c.internal,
          createdAt: c.createdAt.toISOString(),
        })),
      attachments: t.attachments.map((x) => ({
        id: x.id,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        createdAt: x.createdAt.toISOString(),
      })),
    };
  }

  /** Employees see their own tickets; managers/admins (and viewers, read only) see all. */
  private scope(a: CrmActor): Prisma.SupportTicketWhereInput {
    return a.team ? {} : { createdByUserId: a.userId };
  }

  private async ticketFor(a: CrmActor, id: string) {
    const t = await this.prisma.supportTicket.findFirst({
      where: { id, ...this.scope(a) },
      include,
    });
    if (!t) throw notFound('Ticket');
    return t;
  }

  async list(
    a: CrmActor,
    q: SupportTicketListQuery,
  ): Promise<CrmPageDto<SupportTicketDto>> {
    const statuses = q.status
      ?.split(',')
      .filter((s) => s in SUPPORT_STATUS_LABEL) as
      SupportTicketStatus[] | undefined;
    const where: Prisma.SupportTicketWhereInput = {
      ...this.scope(a),
      ...(q.mine === 'true' ? { createdByUserId: a.userId } : {}),
      ...(statuses?.length ? { status: { in: statuses } } : {}),
      ...(q.category ? { category: q.category } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        include,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);
    return {
      items: rows.map((t) => this.dto(t, a)),
      total,
      page: q.page,
      pageSize: q.limit,
    };
  }

  async get(a: CrmActor, id: string): Promise<SupportTicketDto> {
    return this.dto(await this.ticketFor(a, id), a);
  }

  async create(
    a: CrmActor,
    input: SupportTicketInput,
  ): Promise<SupportTicketDto> {
    this.access.assertWrite(a);
    if (input.leadId) await this.access.lead(a, input.leadId);
    const row = await this.prisma.$transaction(async (tx) => {
      const t = await tx.supportTicket.create({
        data: {
          createdByUserId: a.userId,
          category: input.category,
          subject: input.subject.trim(),
          description: input.description.trim(),
          priority: input.priority,
          leadId: input.leadId ?? null,
          salonId: input.salonId ?? null,
          slaDueAt: new Date(
            Date.now() + SUPPORT_SLA_HOURS[input.priority] * 3600_000,
          ),
        },
        include,
      });
      if (t.leadId)
        await logLeadActivity(
          tx,
          t.leadId,
          a.userId,
          'TICKET',
          `Support ticket FQ-T-${String(t.number).padStart(5, '0')}: ${t.subject}`,
          { ticketId: t.id },
        );
      await tx.auditLog.create({
        data: {
          actorUserId: a.userId,
          action: 'CRM_TICKET_CREATED',
          entityType: 'SupportTicket',
          entityId: t.id,
          metadata: { category: t.category, priority: t.priority },
        },
      });
      return t;
    });
    return this.dto(row, a);
  }

  async update(
    a: CrmActor,
    id: string,
    input: SupportTicketUpdateInput,
  ): Promise<SupportTicketDto> {
    this.access.assertWrite(a);
    const t = await this.ticketFor(a, id);
    const isOwner = t.createdByUserId === a.userId;
    if (!a.manage) {
      const onlyStatus = Object.keys(input).every(
        (k) => k === 'status' || k === 'escalate',
      );
      if (!isOwner || !onlyStatus)
        throw forbidden('Only support staff can change this ticket.');
    }
    const now = new Date();
    const data: Prisma.SupportTicketUncheckedUpdateInput = {};
    if (input.status && input.status !== t.status) {
      const allowed = a.manage
        ? STAFF_MOVES[t.status]
        : (OWNER_MOVES[t.status] ?? []);
      if (!allowed.includes(input.status))
        throw new AppException(
          'CRM_TICKET_STATUS',
          `A ticket that is "${SUPPORT_STATUS_LABEL[t.status]}" cannot become "${SUPPORT_STATUS_LABEL[input.status]}".`,
          HttpStatus.CONFLICT,
        );
      if (
        input.status === 'RESOLVED' &&
        !(input.resolutionNotes ?? t.resolutionNotes)
      )
        throw new AppException(
          'CRM_TICKET_RESOLUTION',
          'Add resolution notes.',
          HttpStatus.BAD_REQUEST,
        );
      data.status = input.status;
      if (input.status === 'RESOLVED') data.resolvedAt = now;
      if (input.status === 'CLOSED') data.closedAt = now;
      if (input.status === 'REOPENED') {
        data.resolvedAt = null;
        data.closedAt = null;
        data.slaDueAt = new Date(
          now.getTime() + SUPPORT_SLA_HOURS[t.priority] * 3600_000,
        );
      }
      if (a.manage && !t.firstResponseAt) data.firstResponseAt = now;
    }
    if (input.priority && a.manage) {
      data.priority = input.priority;
      data.slaDueAt = new Date(
        t.createdAt.getTime() + SUPPORT_SLA_HOURS[input.priority] * 3600_000,
      );
    }
    if (input.assignedToUserId !== undefined && a.manage) {
      if (input.assignedToUserId) {
        const staff = await this.prisma.userRole.findFirst({
          where: {
            userId: input.assignedToUserId,
            salonId: null,
            role: {
              in: ['PLATFORM_ADMIN', 'CO_FOUNDER', 'SALES_ADMIN', 'HR_ADMIN'],
            },
          },
        });
        if (!staff)
          throw new AppException(
            'CRM_TICKET_ASSIGNEE',
            'Tickets can be assigned to FastQue support staff only.',
            HttpStatus.BAD_REQUEST,
          );
      }
      data.assignedToUserId = input.assignedToUserId;
      if (input.assignedToUserId && t.status === 'OPEN' && !input.status)
        data.status = 'ASSIGNED';
    }
    if (input.resolutionNotes !== undefined && a.manage)
      data.resolutionNotes = input.resolutionNotes?.trim() || null;
    if (input.escalate) {
      if (!SUPPORT_OPEN_STATUSES.includes(t.status))
        throw new AppException(
          'CRM_TICKET_CLOSED',
          'Only open tickets can be escalated.',
          HttpStatus.CONFLICT,
        );
      data.escalatedAt = now;
      data.priority =
        t.priority === 'URGENT'
          ? 'URGENT'
          : t.priority === 'HIGH'
            ? 'URGENT'
            : 'HIGH';
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportTicket.update({
        where: { id },
        data,
        include,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: a.userId,
          action: 'CRM_TICKET_UPDATED',
          entityType: 'SupportTicket',
          entityId: id,
          metadata: {
            changes: Object.keys(input),
            from: t.status,
            to: updated.status,
          },
        },
      });
      if (updated.createdByUserId !== a.userId)
        await notifyCrm(
          tx,
          updated.createdByUserId,
          'crm.ticket_update',
          `Ticket FQ-T-${String(updated.number).padStart(5, '0')}: ${SUPPORT_STATUS_LABEL[updated.status]}`,
          updated.subject,
          `/employee/support?ticket=${id}`,
          `ticket:${id}:${updated.status}:${updated.updatedAt.toISOString()}`,
        );
      return updated;
    });
    return this.dto(row, a);
  }

  async comment(
    a: CrmActor,
    id: string,
    body: string,
    internal: boolean,
  ): Promise<SupportTicketDto> {
    this.access.assertWrite(a);
    const t = await this.ticketFor(a, id);
    if (internal && !a.manage)
      throw forbidden('Only support staff can add internal notes.');
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketComment.create({
        data: {
          ticketId: id,
          authorUserId: a.userId,
          body: body.trim(),
          internal,
        },
      });
      const statusPatch: Prisma.SupportTicketUncheckedUpdateInput = {};
      if (a.manage && !t.firstResponseAt)
        statusPatch.firstResponseAt = new Date();
      if (!a.manage && t.status === 'WAITING_EMPLOYEE')
        statusPatch.status = 'IN_PROGRESS';
      const updated = await tx.supportTicket.update({
        where: { id },
        data: statusPatch,
        include,
      });
      if (!internal && t.createdByUserId !== a.userId)
        await notifyCrm(
          tx,
          t.createdByUserId,
          'crm.ticket_update',
          `New reply on FQ-T-${String(t.number).padStart(5, '0')}`,
          body.slice(0, 200),
          `/employee/support?ticket=${id}`,
          `ticketc:${id}:${Date.now()}`,
        );
      return updated;
    });
    return this.dto(row, a);
  }

  /** Screenshot/photo attachment (image types only, checked from the bytes; private storage). */
  async attach(
    a: CrmActor,
    id: string,
    file: Express.Multer.File | undefined,
  ): Promise<SupportTicketDto> {
    this.access.assertWrite(a);
    await this.ticketFor(a, id);
    if (!file?.buffer?.length)
      throw new AppException(
        'CRM_ATTACHMENT_EMPTY',
        'Choose a screenshot or photo.',
        HttpStatus.BAD_REQUEST,
      );
    if (file.size > ATTACHMENT_MAX_BYTES)
      throw new AppException(
        'CRM_ATTACHMENT_TOO_LARGE',
        'Attachments can be up to 5 MB.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    const mime = detectImageMimeType(file.buffer);
    if (!mime)
      throw new AppException(
        'CRM_ATTACHMENT_TYPE',
        'Attach a JPEG, PNG or WebP image.',
        HttpStatus.BAD_REQUEST,
      );
    const key = `crm/tickets/${id}/${randomUUID()}`;
    await this.storage.put(key, file.buffer, mime);
    await this.prisma.supportTicketAttachment.create({
      data: {
        ticketId: id,
        storageKey: key,
        mimeType: mime,
        sizeBytes: file.size,
        uploadedById: a.userId,
      },
    });
    return this.get(a, id);
  }

  async attachmentFile(
    a: CrmActor,
    id: string,
    attachmentId: string,
  ): Promise<{ body: Buffer; mimeType: string }> {
    await this.ticketFor(a, id);
    const att = await this.prisma.supportTicketAttachment.findFirst({
      where: { id: attachmentId, ticketId: id },
    });
    if (!att) throw notFound('Attachment');
    const body = await this.storage.get(att.storageKey);
    if (!body) throw notFound('Attachment');
    return { body, mimeType: att.mimeType };
  }

  /** Support staff who can take tickets (for the assignee picker). */
  async agents(a: CrmActor) {
    this.access.assertManage(a);
    const rows = await this.prisma.userRole.findMany({
      where: {
        salonId: null,
        role: {
          in: ['PLATFORM_ADMIN', 'CO_FOUNDER', 'SALES_ADMIN', 'HR_ADMIN'],
        },
        user: { status: 'ACTIVE' },
      },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            employeeProfile: { select: { fullName: true } },
          },
        },
      },
      distinct: ['userId'],
    });
    return rows.map((r) => ({ id: r.user.id, name: name(r.user) }));
  }
}
