import { Injectable, Logger } from '@nestjs/common';
import {
  AnthropicProvider,
  type ModelProvider,
  type ModelTier,
  type StructuredRequest,
} from '../../growth/model-router';
import { PrismaService } from '../../prisma/prisma.service';
import { connectFlag } from '../connect-config';

/**
 * Connect's model gateway. Reuses Growth AI's provider-independent classes, with its own
 * configuration, budget and usage log (connect_ai_interactions). Code names a tier, never a model.
 *
 *   CONNECT_AI_LLM_ENABLED=true (with CONNECT_AI_ENABLED and FASTQUE_CONNECT_ENABLED)
 *   CONNECT_AI_LLM_PROVIDER              none (default) | anthropic
 *   CONNECT_AI_<FAST|QUALITY>_MODEL      model id
 *   CONNECT_AI_<TIER>_INPUT_USD_PER_MTOK / _OUTPUT_USD_PER_MTOK   prices (no price, no call)
 *   CONNECT_AI_DAILY_BUDGET_USD          platform-wide daily cap (default 1)
 *   ANTHROPIC_API_KEY                    server-side only
 *
 * Every failure path returns null so the caller falls back to rules: the chat keeps working when
 * the provider is down, unconfigured, over budget or paused by the circuit breaker.
 */
export interface ModelCallMeta {
  feature: string;
  salonId: string | null;
  conversationId: string | null;
  messageId?: string | null;
  intent?: string | null;
}

export interface ModelJson {
  json: Record<string, unknown>;
  interactionId: string;
}

const price = (v: string | undefined) =>
  v && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;

export function connectTier(tier: ModelTier) {
  const model = process.env[`CONNECT_AI_${tier}_MODEL`]?.trim();
  const input = price(process.env[`CONNECT_AI_${tier}_INPUT_USD_PER_MTOK`]);
  const output = price(process.env[`CONNECT_AI_${tier}_OUTPUT_USD_PER_MTOK`]);
  if (
    !model ||
    !/^[a-z0-9.\-:@/]{3,80}$/i.test(model) ||
    input == null ||
    output == null
  )
    return null;
  return { model, input, output };
}

@Injectable()
export class ConnectModelService {
  private readonly logger = new Logger(ConnectModelService.name);
  private provider: ModelProvider | null | undefined;
  private failures = 0;
  private openUntil = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Tests inject a fake provider. */
  useProvider(p: ModelProvider | null) {
    this.provider = p;
  }

  private resolve(): ModelProvider | null {
    if (this.provider !== undefined) return this.provider;
    if (
      process.env.CONNECT_AI_LLM_PROVIDER === 'anthropic' &&
      process.env.ANTHROPIC_API_KEY?.trim()
    )
      return new AnthropicProvider();
    return null;
  }

  status() {
    const enabled = connectFlag('CONNECT_AI_LLM_ENABLED');
    const p = enabled ? this.resolve() : null;
    return {
      enabled,
      provider: p?.name ?? 'none',
      fastModel: connectTier('FAST')?.model ?? null,
      qualityModel: connectTier('QUALITY')?.model ?? null,
      configured: !!p && !!connectTier('FAST'),
      dailyBudgetUsd: price(process.env.CONNECT_AI_DAILY_BUDGET_USD) ?? 1,
      paused: Date.now() < this.openUntil,
    };
  }

  available(): boolean {
    return (
      connectFlag('CONNECT_AI_LLM_ENABLED') &&
      !!this.resolve() &&
      !!connectTier('FAST') &&
      Date.now() >= this.openUntil
    );
  }

  async spentTodayMicroUsd(): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.connectAiInteraction.aggregate({
      _sum: { costMicroUsd: true },
      where: { createdAt: { gte: start } },
    });
    return Number(agg._sum.costMicroUsd ?? 0);
  }

  async salonSpentThisMonthMicroUsd(salonId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.connectAiInteraction.aggregate({
      _sum: { costMicroUsd: true },
      where: { salonId, createdAt: { gte: start } },
    });
    return Number(agg._sum.costMicroUsd ?? 0);
  }

  async json(
    tier: ModelTier,
    meta: ModelCallMeta,
    req: Omit<StructuredRequest, 'tier' | 'feature' | 'actorUserId'>,
    salonBudgetMicroUsd: number | null,
  ): Promise<ModelJson | null> {
    if (!this.available()) return null;
    const provider = this.resolve()!;
    const cfg = connectTier(tier) ?? connectTier('FAST')!;
    const daily = Math.round(
      (price(process.env.CONNECT_AI_DAILY_BUDGET_USD) ?? 1) * 1_000_000,
    );
    if ((await this.spentTodayMicroUsd()) >= daily) {
      await this.log(meta, {
        engine: 'LLM',
        success: false,
        error: 'daily_budget_exhausted',
      });
      return null;
    }
    if (
      meta.salonId &&
      salonBudgetMicroUsd != null &&
      (await this.salonSpentThisMonthMicroUsd(meta.salonId)) >=
        salonBudgetMicroUsd
    ) {
      await this.log(meta, {
        engine: 'LLM',
        success: false,
        error: 'salon_budget_exhausted',
      });
      return null;
    }
    try {
      const r = await provider.complete(cfg.model, {
        ...req,
        tier,
        feature: `connect.${meta.feature}`,
        actorUserId: 'connect-ai',
      });
      this.failures = 0;
      const cost = Math.round(
        r.inputTokens * cfg.input + r.outputTokens * cfg.output,
      );
      let json: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(r.text);
        json =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        json = null;
      }
      const row = await this.log(meta, {
        engine: 'LLM',
        provider: provider.name,
        model: cfg.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costMicroUsd: cost,
        success: !!json && !r.refused,
        error: r.refused ? 'refused' : json ? null : 'unparseable',
      });
      return json && !r.refused ? { json, interactionId: row.id } : null;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= 3) {
        this.openUntil = Date.now() + 5 * 60_000;
        this.failures = 0;
      }
      this.logger.warn(
        `Connect model call failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      await this.log(meta, {
        engine: 'LLM',
        provider: provider.name,
        model: cfg.model,
        success: false,
        error: 'provider_error',
      });
      return null;
    }
  }

  log(
    meta: ModelCallMeta,
    r: {
      engine: string;
      provider?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      costMicroUsd?: number;
      success?: boolean;
      error?: string | null;
      confidence?: number;
      escalated?: boolean;
      escalationReason?: string | null;
      injectionFlagged?: boolean;
    },
  ) {
    return this.prisma.connectAiInteraction.create({
      data: {
        salonId: meta.salonId,
        conversationId: meta.conversationId,
        messageId: meta.messageId ?? null,
        feature: meta.feature,
        intent: meta.intent ?? null,
        engine: r.engine,
        provider: r.provider ?? null,
        model: r.model ?? null,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        costMicroUsd: r.costMicroUsd ?? 0,
        success: r.success ?? true,
        error: r.error ?? null,
        confidence: r.confidence ?? null,
        escalated: r.escalated ?? false,
        escalationReason: r.escalationReason ?? null,
        injectionFlagged: r.injectionFlagged ?? false,
      },
    });
  }
}
