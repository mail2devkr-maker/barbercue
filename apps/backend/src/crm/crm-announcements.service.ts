import { HttpStatus, Injectable } from '@nestjs/common';
import type { CrmAnnouncement } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  CrmAnnouncementDto,
  CrmAnnouncementInput,
  CrmAnnouncementUpdateInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service';
import { forbidden, notFound, type CrmActor } from './crm-access.service';

/** MP4/MOV or WebM by content, never by the file name. */
export function sniffVideo(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  if (b.toString('ascii', 4, 8) === 'ftyp')
    return b.toString('ascii', 8, 10) === 'qt'
      ? 'video/quicktime'
      : 'video/mp4';
  return null;
}

/** CEO messages: written by admins, shown on the employee dashboard. */
@Injectable()
export class CrmAnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  private admin(a: CrmActor): void {
    if (a.kind !== 'ADMIN')
      throw forbidden('Only an administrator can manage CEO messages.');
  }

  private dto(r: CrmAnnouncement): CrmAnnouncementDto {
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      videoUrl: r.videoUrl,
      hasVideo: r.videoStorageKey !== null,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Admins see everything; everyone else the visible messages, newest first. */
  async list(a: CrmActor): Promise<CrmAnnouncementDto[]> {
    const rows = await this.prisma.crmAnnouncement.findMany({
      where: a.kind === 'ADMIN' ? {} : { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: a.kind === 'ADMIN' ? 50 : 5,
    });
    return rows.map((r) => this.dto(r));
  }

  private async row(a: CrmActor, id: string): Promise<CrmAnnouncement> {
    const r = await this.prisma.crmAnnouncement.findUnique({ where: { id } });
    if (!r || (!r.isActive && a.kind !== 'ADMIN')) throw notFound('Message');
    return r;
  }

  async create(
    a: CrmActor,
    input: CrmAnnouncementInput,
  ): Promise<CrmAnnouncementDto> {
    this.admin(a);
    return this.dto(
      await this.prisma.crmAnnouncement.create({
        data: {
          title: input.title,
          body: input.body || null,
          videoUrl: input.videoUrl || null,
          createdByUserId: a.userId,
        },
      }),
    );
  }

  async update(
    a: CrmActor,
    id: string,
    input: CrmAnnouncementUpdateInput,
  ): Promise<CrmAnnouncementDto> {
    this.admin(a);
    await this.row(a, id);
    return this.dto(
      await this.prisma.crmAnnouncement.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body || null } : {}),
          ...(input.videoUrl !== undefined
            ? { videoUrl: input.videoUrl || null }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      }),
    );
  }

  async uploadVideo(
    a: CrmActor,
    id: string,
    file: Express.Multer.File | undefined,
  ): Promise<CrmAnnouncementDto> {
    this.admin(a);
    const current = await this.row(a, id);
    const mime = file?.buffer ? sniffVideo(file.buffer) : null;
    if (!file || !mime)
      throw new AppException(
        'CRM_VIDEO_TYPE',
        'Upload an MP4, MOV or WebM video (up to 50 MB).',
        HttpStatus.BAD_REQUEST,
      );
    const key = `crm/announcements/${id}/${randomUUID()}`;
    await this.storage.put(key, file.buffer, mime);
    let saved: CrmAnnouncement;
    try {
      saved = await this.prisma.crmAnnouncement.update({
        where: { id },
        data: {
          videoStorageKey: key,
          videoMimeType: mime,
          videoSizeBytes: file.size,
        },
      });
    } catch (err) {
      await this.storage.delete(key);
      throw err;
    }
    if (current.videoStorageKey)
      await this.storage.delete(current.videoStorageKey);
    return this.dto(saved);
  }

  async video(
    a: CrmActor,
    id: string,
  ): Promise<{ body: Buffer; mimeType: string }> {
    const r = await this.row(a, id);
    const body = r.videoStorageKey
      ? await this.storage.get(r.videoStorageKey)
      : null;
    if (!body) throw notFound('Video');
    return { body, mimeType: r.videoMimeType ?? 'video/mp4' };
  }

  async remove(a: CrmActor, id: string): Promise<void> {
    this.admin(a);
    const r = await this.row(a, id);
    await this.prisma.crmAnnouncement.delete({ where: { id } });
    if (r.videoStorageKey) await this.storage.delete(r.videoStorageKey);
  }
}
