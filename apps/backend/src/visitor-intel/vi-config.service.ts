import { Injectable } from '@nestjs/common';
import {
  VI_DEFAULT_SETTINGS,
  viTrackingSettingsSchema,
  type ViTrackingSettings,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Tracking settings (single vi_config row), cached for 30 s so ingestion never waits on it. */
@Injectable()
export class ViConfigService {
  private cache: { at: number; value: ViTrackingSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Server switch, off by default: only VI_TRACKING_ENABLED=true allows ingestion and the scheduled
   * jobs. Off, nothing touches the database, so an idle site lets the database compute sleep.
   */
  static envEnabled(): boolean {
    return process.env.VI_TRACKING_ENABLED === 'true';
  }

  async get(): Promise<ViTrackingSettings> {
    if (this.cache && Date.now() - this.cache.at < 30_000)
      return this.cache.value;
    let value = VI_DEFAULT_SETTINGS;
    try {
      const row = await this.prisma.viConfig.findUnique({ where: { id: 1 } });
      const parsed = viTrackingSettingsSchema.safeParse({
        ...VI_DEFAULT_SETTINGS,
        ...(row?.settings &&
        typeof row.settings === 'object' &&
        !Array.isArray(row.settings)
          ? row.settings
          : {}),
      });
      if (parsed.success) value = parsed.data;
    } catch {
      // Degrade to defaults: analytics must never break the site.
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(
    settings: ViTrackingSettings,
    userId: string,
  ): Promise<ViTrackingSettings> {
    await this.prisma.viConfig.upsert({
      where: { id: 1 },
      create: { id: 1, settings, updatedByUserId: userId },
      update: { settings, updatedByUserId: userId },
    });
    this.cache = null;
    return this.get();
  }
}
