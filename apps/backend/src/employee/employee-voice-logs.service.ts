import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuthErrorCode,
  CrmErrorCode,
  voiceOnboardingServiceSchema,
  type CreateEmployeeVoiceLogInput,
  type EmployeeVoiceOnboardingLogDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

// Explicit small bound: each employee sees their OWN recent records.
// Existing CRM lead/shop creation and public service catalogs are never touched.
const HISTORY_LIMIT = 50;

@Injectable()
export class EmployeeVoiceLogsService {
  constructor(private readonly prisma: PrismaService) {}

  private async profileId(userId: string): Promise<string> {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new AppException(AuthErrorCode.FORBIDDEN_ROLE, 'Employee profile is not configured.', HttpStatus.FORBIDDEN);
    }
    return profile.id;
  }

  async list(userId: string): Promise<EmployeeVoiceOnboardingLogDto[]> {
    const id = await this.profileId(userId);
    const rows = await this.prisma.employeeOnboardingVoiceLog.findMany({
      where: { employeeProfileId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    return rows.map((row) => this.toDto(row));
  }

  async create(userId: string, input: CreateEmployeeVoiceLogInput): Promise<EmployeeVoiceOnboardingLogDto> {
    const employeeProfileId = await this.profileId(userId);

    // A lead can be linked ONLY if it belongs to the caller's employee profile.
    // Never trust a shop name/id from the client over this database relationship.
    let shopName = input.shopName;
    if (input.leadId) {
      const lead = await this.prisma.employeeCrmLead.findFirst({
        where: { id: input.leadId, employeeProfileId },
        select: { id: true, shopName: true },
      });
      if (!lead) {
        throw new AppException(CrmErrorCode.LEAD_NOT_FOUND, 'This CRM lead is not assigned to you.', HttpStatus.NOT_FOUND);
      }
      shopName = lead.shopName;
    }

    // Client retry with the same idempotency key NEVER creates a duplicate log.
    const key = { employeeProfileId_clientRequestId: { employeeProfileId, clientRequestId: input.clientRequestId } };
    const previous = await this.prisma.employeeOnboardingVoiceLog.findUnique({ where: key });
    if (previous) return this.toDto(previous);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.employeeOnboardingVoiceLog.create({
          data: {
            employeeProfileId,
            leadId: input.leadId ?? null,
            clientRequestId: input.clientRequestId,
            shopName,
            transcript: input.transcript,
            language: input.language,
            consentConfirmed: true,
            contactName: input.contactName?.trim() || null,
            phone: input.phone?.trim() || null,
            city: input.city?.trim() || null,
            locality: input.locality?.trim() || null,
            addressLine: input.addressLine?.trim() || null,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            chairCount: input.chairCount ?? null,
            staffCount: input.staffCount ?? null,
            services: input.services,
            notes: input.notes?.trim() || null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'CRM_VOICE_ONBOARDING_LOG_CREATED',
            entityType: 'EmployeeOnboardingVoiceLog',
            entityId: created.id,
            // No transcript, contacts, prices or precise coordinates in audit metadata.
            metadata: { leadId: created.leadId, serviceCount: input.services.length },
          },
        });
        return created;
      });
      return this.toDto(row);
    } catch (error) {
      // A concurrent retry could win the unique insert race. Fetch only this employee's key.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.employeeOnboardingVoiceLog.findUnique({ where: key });
        if (existing) return this.toDto(existing);
      }
      throw error;
    }
  }

  private toDto(row: {
    id: string;
    leadId: string | null;
    shopName: string;
    transcript: string;
    language: string;
    consentConfirmed: boolean;
    contactName: string | null;
    phone: string | null;
    city: string | null;
    locality: string | null;
    addressLine: string | null;
    latitude: number | null;
    longitude: number | null;
    chairCount: number | null;
    staffCount: number | null;
    services: Prisma.JsonValue;
    notes: string | null;
    createdAt: Date;
  }): EmployeeVoiceOnboardingLogDto {
    const services = voiceOnboardingServiceSchema.array().safeParse(row.services);
    return {
      id: row.id,
      leadId: row.leadId,
      shopName: row.shopName,
      transcript: row.transcript,
      language: row.language === 'en-IN' ? 'en-IN' : 'hi-IN',
      consentConfirmed: true,
      contactName: row.contactName,
      phone: row.phone,
      city: row.city,
      locality: row.locality,
      addressLine: row.addressLine,
      latitude: row.latitude,
      longitude: row.longitude,
      chairCount: row.chairCount,
      staffCount: row.staffCount,
      services: services.success ? services.data : [],
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
