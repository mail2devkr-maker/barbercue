import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type EmployeeVoiceVisitLog } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import {
  CrmErrorCode,
  type CreateEmployeeVoiceVisitLogInput,
  type EmployeeVoiceVisitLogDto,
  type EmployeeVoiceVisitLogListQuery,
  type EmployeeVoiceVisitLogPageDto,
  type UpdateEmployeeVoiceVisitLogInput,
  type VoiceOnboardingDraft,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

const VOICE_LOG_NOT_FOUND = 'EMPLOYEE_VOICE_VISIT_LOG_NOT_FOUND';
const VOICE_LOG_CONFLICT = 'EMPLOYEE_VOICE_VISIT_LOG_CONFLICT';
const VOICE_LOG_INVALID_CURSOR = 'EMPLOYEE_VOICE_VISIT_LOG_INVALID_CURSOR';

@Injectable()
export class EmployeeVoiceVisitService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    leadId: string,
    query: EmployeeVoiceVisitLogListQuery,
  ): Promise<EmployeeVoiceVisitLogPageDto> {
    const { profile, lead } = await this.requireOwnedLead(userId, leadId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const rows = await this.prisma.employeeVoiceVisitLog.findMany({
      where: {
        employeeProfileId: profile.id,
        leadId: lead.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        employeeProfile: { select: { fullName: true, employeeCode: true } },
      },
    });
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      lead: { id: lead.id, shopName: lead.shopName },
      items: pageRows.map((row) => this.toDto(row)),
      nextCursor:
        hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async create(
    userId: string,
    leadId: string,
    input: CreateEmployeeVoiceVisitLogInput,
  ): Promise<EmployeeVoiceVisitLogDto> {
    const { profile, lead } = await this.requireOwnedLead(userId, leadId);
    const existing = await this.prisma.employeeVoiceVisitLog.findUnique({
      where: {
        employeeProfileId_submissionKey: {
          employeeProfileId: profile.id,
          submissionKey: input.submissionKey,
        },
      },
      include: {
        employeeProfile: { select: { fullName: true, employeeCode: true } },
      },
    });
    if (existing) return this.existingCreateResult(existing, lead.id, input);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.employeeVoiceVisitLog.create({
          data: {
            employeeProfileId: profile.id,
            leadId: lead.id,
            submissionKey: input.submissionKey,
            transcript: input.transcript,
            language: input.language,
            structuredDraft: input.structuredDraft,
          },
          include: {
            employeeProfile: { select: { fullName: true, employeeCode: true } },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'EMPLOYEE_VOICE_VISIT_DRAFT_SAVED',
            entityType: 'EmployeeVoiceVisitLog',
            entityId: row.id,
            metadata: {
              employeeCode: profile.employeeCode,
              leadId: lead.id,
              language: input.language,
            },
          },
        });
        return row;
      });
      return this.toDto(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.employeeVoiceVisitLog.findUnique({
          where: {
            employeeProfileId_submissionKey: {
              employeeProfileId: profile.id,
              submissionKey: input.submissionKey,
            },
          },
          include: {
            employeeProfile: { select: { fullName: true, employeeCode: true } },
          },
        });
        if (raced) return this.existingCreateResult(raced, lead.id, input);
      }
      throw error;
    }
  }

  async update(
    userId: string,
    leadId: string,
    logId: string,
    input: UpdateEmployeeVoiceVisitLogInput,
  ): Promise<EmployeeVoiceVisitLogDto> {
    const { profile, lead } = await this.requireOwnedLead(userId, leadId);
    if (input.status === 'CONFIRMED' && input.reviewAcknowledged !== true) {
      throw new AppException(
        'EMPLOYEE_VOICE_REVIEW_ACKNOWLEDGMENT_REQUIRED',
        'Review and acknowledge the extracted details before confirming the visit.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.prisma.employeeVoiceVisitLog.findFirst({
      where: { id: logId, employeeProfileId: profile.id, leadId: lead.id },
      include: {
        employeeProfile: { select: { fullName: true, employeeCode: true } },
      },
    });
    if (!existing) this.notFound();

    if (existing.status === 'CONFIRMED') {
      if (this.matches(existing, input)) return this.toDto(existing);
      this.conflict('A confirmed visit log cannot be changed.');
    }

    const confirmedAt = input.status === 'CONFIRMED' ? new Date() : null;
    const { changed, row } = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.employeeVoiceVisitLog.updateMany({
        where: {
          id: existing.id,
          employeeProfileId: profile.id,
          leadId: lead.id,
          status: 'DRAFT',
        },
        data: {
          transcript: input.transcript,
          language: input.language,
          structuredDraft: input.structuredDraft,
          status: input.status,
          confirmedAt,
        },
      });
      const row = await tx.employeeVoiceVisitLog.findFirst({
        where: {
          id: existing.id,
          employeeProfileId: profile.id,
          leadId: lead.id,
        },
        include: {
          employeeProfile: { select: { fullName: true, employeeCode: true } },
        },
      });
      if (changed.count > 0 && input.status === 'CONFIRMED' && row) {
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'EMPLOYEE_VOICE_VISIT_CONFIRMED',
            entityType: 'EmployeeVoiceVisitLog',
            entityId: row.id,
            metadata: {
              employeeCode: profile.employeeCode,
              leadId: lead.id,
              language: input.language,
              reviewAcknowledged: true,
            },
          },
        });
      }
      return { changed, row };
    });
    if (!row) this.notFound();
    if (changed.count === 0) {
      if (row.status === 'CONFIRMED' && this.matches(row, input))
        return this.toDto(row);
      this.conflict(
        'This draft changed or was confirmed in another request. Reload it before editing.',
      );
    }

    return this.toDto(row);
  }

  private async requireOwnedLead(userId: string, leadId: string) {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      select: { id: true, employeeCode: true },
    });
    if (!profile) {
      throw new AppException(
        'FORBIDDEN_ROLE',
        'Employee profile is not configured.',
        HttpStatus.FORBIDDEN,
      );
    }
    const lead = await this.prisma.employeeCrmLead.findFirst({
      where: { id: leadId, employeeProfileId: profile.id },
      select: { id: true, shopName: true },
    });
    if (!lead) {
      throw new AppException(
        CrmErrorCode.LEAD_NOT_FOUND,
        'Lead not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return { profile, lead };
  }

  private existingCreateResult(
    row: EmployeeVoiceVisitLog & {
      employeeProfile: { fullName: string; employeeCode: string };
    },
    leadId: string,
    input: CreateEmployeeVoiceVisitLogInput,
  ) {
    if (row.leadId !== leadId || !this.matchesCreate(row, input)) {
      this.conflict(
        'This submission key was already used for different visit data.',
      );
    }
    return this.toDto(row);
  }

  private matches(
    row: EmployeeVoiceVisitLog,
    input: UpdateEmployeeVoiceVisitLogInput,
  ): boolean {
    return (
      row.transcript === input.transcript &&
      row.language === input.language &&
      isDeepStrictEqual(row.structuredDraft, input.structuredDraft) &&
      row.status === input.status
    );
  }

  private matchesCreate(
    row: EmployeeVoiceVisitLog,
    input: CreateEmployeeVoiceVisitLogInput,
  ): boolean {
    return (
      row.transcript === input.transcript &&
      row.language === input.language &&
      isDeepStrictEqual(row.structuredDraft, input.structuredDraft)
    );
  }

  private toDto(
    row: EmployeeVoiceVisitLog & {
      employeeProfile: { fullName: string; employeeCode: string };
    },
  ): EmployeeVoiceVisitLogDto {
    return {
      id: row.id,
      leadId: row.leadId,
      transcript: row.transcript,
      language: row.language as EmployeeVoiceVisitLogDto['language'],
      structuredDraft: row.structuredDraft as VoiceOnboardingDraft,
      status: row.status as EmployeeVoiceVisitLogDto['status'],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      employee: row.employeeProfile,
    };
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`).toString(
      'base64url',
    );
  }

  private decodeCursor(value: string): { createdAt: Date; id: string } {
    try {
      const decoded = Buffer.from(value, 'base64url').toString('utf8');
      const separator = decoded.indexOf('|');
      const createdAt = new Date(decoded.slice(0, separator));
      const id = decoded.slice(separator + 1);
      if (separator < 0 || !id || Number.isNaN(createdAt.getTime()))
        throw new Error('invalid');
      return { createdAt, id };
    } catch {
      throw new AppException(
        VOICE_LOG_INVALID_CURSOR,
        'Invalid history cursor.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private notFound(): never {
    throw new AppException(
      VOICE_LOG_NOT_FOUND,
      'Visit log not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private conflict(message: string): never {
    throw new AppException(VOICE_LOG_CONFLICT, message, HttpStatus.CONFLICT);
  }
}
