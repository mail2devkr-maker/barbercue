import { createHash, randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SALES_CONSENT_STATEMENT,
  SALES_RECORDING_MAX_BYTES,
  type SalesCoachReport,
  type SalesRecordingDto,
  type SalesRecordingMeta,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service';
import {
  CrmAccessService,
  forbidden,
  notFound,
  type CrmActor,
} from './crm-access.service';
import { logLeadActivity, notifyCrm } from './crm-events';
import { employeeSelect, toEmployeeRef } from './crm-leads.service';
import {
  estimateCostUsd,
  salesCoachProvider,
  SalesCoachUnavailableError,
} from './sales-coach.provider';

const include = {
  lead: { select: { id: true, shopName: true } },
  employeeProfile: { select: employeeSelect },
  analyses: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.SalesRecordingInclude;
type Row = Prisma.SalesRecordingGetPayload<{ include: typeof include }>;

/** Audio type from the file's bytes (never trust the browser's label alone). */
export function sniffAudio(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  if (b.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (b.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  if (
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WAVE'
  )
    return 'audio/wav';
  if (
    b.toString('ascii', 0, 3) === 'ID3' ||
    (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
  )
    return 'audio/mpeg';
  return null;
}

const retentionDays = () => {
  const n = Number(process.env.SALES_RECORDING_RETENTION_DAYS ?? '180');
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 3650) : 180;
};

@Injectable()
export class CrmRecordingsService {
  private readonly log = new Logger(CrmRecordingsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CrmAccessService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  private dto(r: Row, a: CrmActor): SalesRecordingDto {
    const an = r.analyses[0];
    return {
      id: r.id,
      lead: r.lead,
      meetingId: r.meetingId,
      employee: toEmployeeRef(r.employeeProfile),
      durationSeconds: r.durationSeconds,
      sizeBytes: r.sizeBytes,
      mimeType: r.mimeType,
      language: r.language,
      consentMethod: r.consentMethod,
      consentAt: r.consentAt.toISOString(),
      participants: r.participants,
      analysisStatus: r.analysisStatus,
      analysis: an
        ? {
            id: an.id,
            provider: an.provider,
            overallScore: an.overallScore,
            correctedScore: an.correctedScore,
            report: (an.report as SalesCoachReport | null) ?? null,
            // The full transcript is for the employee and managers only (it is theirs / their team's).
            transcript:
              a.team || r.employeeProfileId === a.employeeProfileId
                ? an.transcript
                : null,
            errorMessage: an.errorMessage,
            reviewerNotes: an.reviewerNotes,
            completedAt: an.completedAt?.toISOString() ?? null,
          }
        : null,
      createdAt: r.createdAt.toISOString(),
      deleted: !!r.deletedAt,
    };
  }

  private async recordingFor(a: CrmActor, id: string) {
    const r = await this.prisma.salesRecording.findUnique({
      where: { id },
      include,
    });
    if (!r || (!a.team && r.employeeProfileId !== a.employeeProfileId))
      throw notFound('Recording');
    return r;
  }

  async list(
    a: CrmActor,
    q: { leadId?: string; employeeId?: string },
  ): Promise<SalesRecordingDto[]> {
    const emp = this.access.employeeScope(a, q.employeeId);
    const rows = await this.prisma.salesRecording.findMany({
      where: {
        deletedAt: null,
        ...(emp ? { employeeProfileId: emp } : {}),
        ...(q.leadId ? { leadId: q.leadId } : {}),
      },
      include,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.dto(r, a));
  }

  /**
   * A consented recording. The consent statement shown to the employee is stored with the audio;
   * the database refuses a row without consent. Retried uploads with the same key are not duplicated.
   */
  async upload(
    a: CrmActor,
    file: Express.Multer.File | undefined,
    meta: SalesRecordingMeta,
  ): Promise<SalesRecordingDto> {
    this.access.assertWrite(a);
    if (!a.employeeProfileId)
      throw forbidden(
        'Only employees with an employee profile can record sales conversations.',
      );
    const lead = await this.access.lead(a, meta.leadId);
    if (meta.meetingId) {
      const m = await this.prisma.crmMeeting.findFirst({
        where: { id: meta.meetingId, leadId: lead.id },
      });
      if (!m) throw notFound('Meeting');
    }
    const existing = await this.prisma.salesRecording.findUnique({
      where: {
        employeeProfileId_submissionKey: {
          employeeProfileId: a.employeeProfileId,
          submissionKey: meta.submissionKey,
        },
      },
      include,
    });
    if (existing) return this.dto(existing, a);
    if (!file?.buffer?.length)
      throw new AppException(
        'CRM_RECORDING_EMPTY',
        'The recording is empty.',
        HttpStatus.BAD_REQUEST,
      );
    if (file.size > SALES_RECORDING_MAX_BYTES)
      throw new AppException(
        'CRM_RECORDING_TOO_LARGE',
        'Recordings can be up to 40 MB. Split long meetings.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    const mime = sniffAudio(file.buffer);
    if (!mime)
      throw new AppException(
        'CRM_RECORDING_TYPE',
        'That file is not a supported audio recording.',
        HttpStatus.BAD_REQUEST,
      );
    const consentAt = new Date(meta.consentAt);
    if (consentAt.getTime() > Date.now() + 5 * 60_000)
      throw new AppException(
        'CRM_CONSENT_TIME',
        'Consent time is in the future.',
        HttpStatus.BAD_REQUEST,
      );
    const id = randomUUID();
    const key = `crm/recordings/${a.employeeProfileId}/${id}`;
    await this.storage.put(key, file.buffer, mime);
    const coach = salesCoachProvider();
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const rec = await tx.salesRecording.create({
          data: {
            id,
            leadId: lead.id,
            meetingId: meta.meetingId ?? null,
            employeeProfileId: a.employeeProfileId!,
            storageKey: key,
            mimeType: mime,
            sizeBytes: file.size,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            durationSeconds: meta.durationSeconds,
            language: meta.language,
            consentGiven: true,
            consentMethod: meta.consentMethod,
            consentStatement: SALES_CONSENT_STATEMENT,
            consentAt,
            participants: meta.participants?.trim() || null,
            analysisStatus: coach.configured
              ? coach.enabled
                ? 'QUEUED'
                : 'DISABLED'
              : 'NOT_CONFIGURED',
            retentionUntil: new Date(Date.now() + retentionDays() * 864e5),
            submissionKey: meta.submissionKey,
          },
          include,
        });
        await logLeadActivity(
          tx,
          lead.id,
          a.userId,
          'RECORDING_ADDED',
          `Sales conversation recorded (${Math.round(meta.durationSeconds / 60)} min, consent: ${meta.consentMethod.toLowerCase().replace(/_/g, ' ')})`,
          { recordingId: id },
        );
        return rec;
      });
      if (row.analysisStatus === 'QUEUED') void this.runAnalysis(id);
      return this.dto(row, a);
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async audio(
    a: CrmActor,
    id: string,
  ): Promise<{ body: Buffer; mimeType: string }> {
    const r = await this.recordingFor(a, id);
    if (r.deletedAt || !r.storageKey) throw notFound('Recording');
    const body = await this.storage.get(r.storageKey);
    if (!body) throw notFound('Recording audio');
    await this.prisma.auditLog.create({
      data: {
        actorUserId: a.userId,
        action: 'CRM_RECORDING_PLAYED',
        entityType: 'SalesRecording',
        entityId: id,
      },
    });
    return { body, mimeType: r.mimeType };
  }

  /** Deletes the audio for good (the row stays as an audit trail without the file). */
  async remove(a: CrmActor, id: string): Promise<void> {
    this.access.assertWrite(a);
    const r = await this.recordingFor(a, id);
    if (r.deletedAt) return;
    if (r.storageKey) await this.storage.delete(r.storageKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.salesRecording.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedByUserId: a.userId,
          storageKey: null,
          status: 'DELETED',
        },
      });
      await tx.salesRecordingAnalysis.updateMany({
        where: { recordingId: id },
        data: { transcript: null },
      });
      await logLeadActivity(
        tx,
        r.leadId,
        a.userId,
        'RECORDING_DELETED',
        'Sales conversation recording deleted',
        { recordingId: id },
      );
      await tx.auditLog.create({
        data: {
          actorUserId: a.userId,
          action: 'CRM_RECORDING_DELETED',
          entityType: 'SalesRecording',
          entityId: id,
        },
      });
    });
  }

  /** Manual (re)analysis. Without a configured provider nothing is generated — and the caller is told so. */
  async analyse(a: CrmActor, id: string): Promise<SalesRecordingDto> {
    const r = await this.recordingFor(a, id);
    if (!a.manage && r.employeeProfileId !== a.employeeProfileId)
      throw forbidden();
    const coach = salesCoachProvider();
    if (!coach.configured)
      throw new AppException(
        'AI_NOT_CONFIGURED',
        'AI Analysis Not Configured. The recording is kept and can be analysed once an AI provider is set up.',
        HttpStatus.CONFLICT,
      );
    if (!coach.enabled)
      throw new AppException(
        'AI_DISABLED',
        'AI analysis is turned off.',
        HttpStatus.CONFLICT,
      );
    if (r.deletedAt)
      throw new AppException(
        'CRM_RECORDING_DELETED',
        'The audio was deleted.',
        HttpStatus.GONE,
      );
    if (r.analysisStatus === 'PROCESSING')
      throw new AppException(
        'AI_BUSY',
        'Analysis is already running.',
        HttpStatus.CONFLICT,
      );
    await this.prisma.salesRecording.update({
      where: { id },
      data: { analysisStatus: 'QUEUED' },
    });
    void this.runAnalysis(id);
    return this.dto(
      await this.prisma.salesRecording.findUniqueOrThrow({
        where: { id },
        include,
      }),
      a,
    );
  }

  /** Runs one analysis; failures are stored (with the reason) and can be retried. */
  async runAnalysis(id: string): Promise<void> {
    const claimed = await this.prisma.salesRecording.updateMany({
      where: { id, analysisStatus: 'QUEUED', deletedAt: null },
      data: { analysisStatus: 'PROCESSING' },
    });
    if (!claimed.count) return;
    const r = await this.prisma.salesRecording.findUniqueOrThrow({
      where: { id },
      include: {
        employeeProfile: { select: { userId: true } },
        lead: { select: { shopName: true } },
      },
    });
    const coach = salesCoachProvider();
    try {
      const audio = r.storageKey ? await this.storage.get(r.storageKey) : null;
      if (!audio) throw new Error('The audio file is missing.');
      const result = await coach.analyse(audio, r.mimeType, {
        language: r.language,
        durationSeconds: r.durationSeconds,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.salesRecordingAnalysis.create({
          data: {
            recordingId: id,
            provider: coach.name,
            model: result.model,
            status: 'COMPLETED',
            transcript: result.transcript,
            report: result.report as unknown as Prisma.InputJsonValue,
            overallScore: result.report.overallScore,
            estimatedCostUsd: estimateCostUsd(result.totalTokens),
            completedAt: new Date(),
          },
        });
        await tx.salesRecording.update({
          where: { id },
          data: { analysisStatus: 'COMPLETED' },
        });
        await notifyCrm(
          tx,
          r.employeeProfile.userId,
          'crm.analysis_completed',
          `Coaching report ready: ${r.lead.shopName}`,
          null,
          `/employee/conversations?recording=${id}`,
          `analysis:${id}`,
        );
      });
    } catch (error) {
      const message =
        error instanceof SalesCoachUnavailableError
          ? error.message
          : `Analysis failed: ${error instanceof Error ? error.message : String(error)}`;
      this.log.warn(`Sales recording ${id}: ${message}`);
      await this.prisma.$transaction([
        this.prisma.salesRecordingAnalysis.create({
          data: {
            recordingId: id,
            provider: coach.name,
            status: 'FAILED',
            errorMessage: message.slice(0, 500),
            completedAt: new Date(),
          },
        }),
        this.prisma.salesRecording.update({
          where: { id },
          data: {
            analysisStatus:
              error instanceof SalesCoachUnavailableError
                ? 'NOT_CONFIGURED'
                : 'FAILED',
          },
        }),
      ]);
    }
  }

  async review(
    a: CrmActor,
    id: string,
    input: { reviewerNotes?: string | null; correctedScore?: number | null },
  ): Promise<SalesRecordingDto> {
    this.access.assertManage(a);
    const r = await this.recordingFor(a, id);
    const an = r.analyses[0];
    if (!an || an.status !== 'COMPLETED')
      throw new AppException(
        'AI_NO_REPORT',
        'There is no AI report to review yet.',
        HttpStatus.CONFLICT,
      );
    await this.prisma.salesRecordingAnalysis.update({
      where: { id: an.id },
      data: {
        reviewedByUserId: a.userId,
        reviewerNotes: input.reviewerNotes?.trim() || null,
        ...(input.correctedScore !== undefined
          ? { correctedScore: input.correctedScore }
          : {}),
      },
    });
    return this.dto(
      await this.prisma.salesRecording.findUniqueOrThrow({
        where: { id },
        include,
      }),
      a,
    );
  }

  /** Retention: delete audio past its retention date (called from the scheduler). */
  async purgeExpired(now = new Date()): Promise<number> {
    const expired = await this.prisma.salesRecording.findMany({
      where: { deletedAt: null, retentionUntil: { lt: now } },
      select: { id: true, storageKey: true },
      take: 200,
    });
    for (const r of expired) {
      if (r.storageKey)
        await this.storage.delete(r.storageKey).catch(() => undefined);
      await this.prisma.salesRecording.update({
        where: { id: r.id },
        data: { deletedAt: now, storageKey: null, status: 'DELETED' },
      });
      await this.prisma.salesRecordingAnalysis.updateMany({
        where: { recordingId: r.id },
        data: { transcript: null },
      });
    }
    return expired.length;
  }

  aiStatus(a: CrmActor) {
    const coach = salesCoachProvider();
    return {
      provider: coach.name,
      configured: coach.configured,
      enabled: coach.enabled,
      message: !coach.configured
        ? 'AI Analysis Not Configured'
        : coach.enabled
          ? 'AI analysis is on'
          : 'AI analysis is configured but turned off',
      costPerMillionTokensUsd: a.manage
        ? Number(process.env.SALES_COACH_USD_PER_MILLION_TOKENS ?? '') || null
        : null,
      retentionDays: retentionDays(),
    };
  }

  async usage(a: CrmActor) {
    this.access.assertManage(a);
    const rows = await this.prisma.salesRecordingAnalysis.groupBy({
      by: ['status'],
      _count: { _all: true },
      _sum: { estimatedCostUsd: true },
    });
    return rows.map((r) => ({
      status: r.status,
      count: r._count._all,
      estimatedCostUsd: r._sum.estimatedCostUsd?.toFixed(4) ?? null,
    }));
  }
}
