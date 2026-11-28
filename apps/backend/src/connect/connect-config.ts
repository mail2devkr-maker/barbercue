import { CanActivate, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CONNECT_DEFAULT_CONFIG,
  CONNECT_FLAG_NAMES,
  type ConnectFeature,
  type ConnectFlagName,
  type ConnectFlags,
  type ConnectPlatformConfigDto,
  type ConnectTier,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * FastQue Connect switches, read per request. Everything is OFF unless the variable is exactly
 * "true", and every sub-flag also needs FASTQUE_CONNECT_ENABLED.
 */
export function connectFlag(name: ConnectFlagName): boolean {
  const on = process.env[name] === 'true';
  if (name === 'FASTQUE_CONNECT_ENABLED') return on;
  if (name === 'CONNECT_AI_LLM_ENABLED')
    return on && connectFlag('CONNECT_AI_ENABLED');
  return on && process.env.FASTQUE_CONNECT_ENABLED === 'true';
}

export function connectFlags(): ConnectFlags {
  return Object.fromEntries(
    CONNECT_FLAG_NAMES.map((n) => [n, connectFlag(n)]),
  ) as ConnectFlags;
}

export const connectError = (
  code: string,
  message: string,
  status = HttpStatus.BAD_REQUEST,
  details?: Record<string, unknown>,
) => new AppException(code, message, status, details);

/** Same answer as a missing route: a disabled feature reveals nothing. */
export const connectNotFound = () =>
  connectError('CONNECT_NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);

@Injectable()
export class ConnectEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!connectFlag('FASTQUE_CONNECT_ENABLED')) throw connectNotFound();
    return true;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge of a stored partial config over the defaults; unknown keys are dropped. */
export function mergeConfig(
  base: unknown,
  patch: unknown,
): ConnectPlatformConfigDto {
  const walk = (b: unknown, p: unknown): unknown => {
    if (!isObj(b)) {
      if (p === undefined) return b;
      if (typeof b === 'number')
        return typeof p === 'number' && Number.isFinite(p) ? p : b;
      if (typeof b === 'boolean') return typeof p === 'boolean' ? p : b;
      if (typeof b === 'string') return typeof p === 'string' ? p : b;
      if (Array.isArray(b)) return Array.isArray(p) ? p : b;
      return b;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(b))
      out[k] = walk(b[k], isObj(p) ? p[k] : undefined);
    return out;
  };
  return walk(base, patch) as ConnectPlatformConfigDto;
}

@Injectable()
export class ConnectConfigService {
  private readonly logger = new Logger(ConnectConfigService.name);
  private cache: { at: number; value: ConnectPlatformConfigDto } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ConnectPlatformConfigDto> {
    if (this.cache && Date.now() - this.cache.at < 30_000)
      return this.cache.value;
    let stored: unknown = null;
    try {
      stored = (
        await this.prisma.connectPlatformConfig.findUnique({
          where: { id: 'global' },
        })
      )?.config;
    } catch (err) {
      this.logger.warn(
        `Config read failed, using defaults: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    const value = mergeConfig(CONNECT_DEFAULT_CONFIG, stored);
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(
    patch: unknown,
    actorUserId: string,
  ): Promise<ConnectPlatformConfigDto> {
    const current = await this.get();
    const next = mergeConfig(current, patch);
    // Guard rails an admin cannot configure away.
    next.limits.maxAttachmentBytes = clamp(
      next.limits.maxAttachmentBytes,
      100_000,
      25 * 1024 * 1024,
    );
    next.limits.maxVoiceBytes = clamp(
      next.limits.maxVoiceBytes,
      100_000,
      10 * 1024 * 1024,
    );
    next.limits.maxMessageChars = clamp(next.limits.maxMessageChars, 100, 4000);
    next.limits.messagesPerMinute = clamp(
      next.limits.messagesPerMinute,
      1,
      120,
    );
    next.limits.retentionDays = clamp(next.limits.retentionDays, 30, 3650);
    next.lifecycle.activeDaysAfterCompletion = clamp(
      next.lifecycle.activeDaysAfterCompletion,
      0,
      90,
    );
    next.lifecycle.cancelledWindowDays = clamp(
      next.lifecycle.cancelledWindowDays,
      0,
      30,
    );
    next.ai.confidenceThreshold = clamp(next.ai.confidenceThreshold, 0.5, 0.99);
    next.ai.monthlyBudgetUsdPerSalon = clamp(
      next.ai.monthlyBudgetUsdPerSalon,
      0,
      1000,
    );
    await this.prisma.connectPlatformConfig.upsert({
      where: { id: 'global' },
      create: {
        id: 'global',
        config: next as unknown as Prisma.InputJsonValue,
        updatedById: actorUserId,
      },
      update: {
        config: next as unknown as Prisma.InputJsonValue,
        updatedById: actorUserId,
      },
    });
    await this.prisma.connectAuditEvent.create({
      data: {
        actorUserId,
        action: 'ADMIN_CONFIG_UPDATED',
        meta: { patch } as Prisma.InputJsonValue,
      },
    });
    this.cache = null;
    return this.get();
  }

  /** Entitlement check. No subscription assigns tiers yet, so every tenant gets defaultTier. */
  async hasFeature(
    feature: ConnectFeature,
    tier?: ConnectTier,
  ): Promise<boolean> {
    const cfg = await this.get();
    const t = tier ?? cfg.entitlements.defaultTier;
    return (cfg.entitlements.tiers[t] ?? []).includes(feature);
  }
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
