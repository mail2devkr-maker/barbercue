import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { growthFlag, indiaDay, indiaDayStart } from './growth-support';

/**
 * Provider-independent model router for Growth AI. Code names a task tier, never a model: which
 * provider and model serve a tier, and their prices, come from configuration only.
 *
 *   GROWTH_AI_LLM_ENABLED=true            (with GROWTH_AI_ENABLED) to allow any model call
 *   GROWTH_AI_LLM_PROVIDER                none (default) | anthropic
 *   GROWTH_AI_<TIER>_MODEL                e.g. GROWTH_AI_FAST_MODEL, GROWTH_AI_QUALITY_MODEL
 *   GROWTH_AI_<TIER>_INPUT_USD_PER_MTOK   price per million input tokens (required: no price, no call)
 *   GROWTH_AI_<TIER>_OUTPUT_USD_PER_MTOK  price per million output tokens
 *   GROWTH_AI_LLM_DAILY_BUDGET_USD        hard daily cap across all calls (default 1)
 *   ANTHROPIC_API_KEY                     server-side only
 *
 * Every call (success or failure) is written to growth_ai_usage with tokens and cost. Cost in
 * micro-USD = tokens × USD per million tokens, so the arithmetic is exact and deterministic.
 * Model output is only ever text for a person to review; it never changes data by itself.
 */
export type ModelTier = 'FAST' | 'QUALITY';

export interface StructuredRequest {
  feature: string;
  tier: ModelTier;
  system: string;
  /** Untrusted data goes here, as JSON, never into the system prompt. */
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  actorUserId: string;
}

export interface StructuredResult {
  json: unknown;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface ModelProvider {
  readonly name: string;
  complete(
    model: string,
    req: StructuredRequest,
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    refused: boolean;
  }>;
}

export class ModelUnavailableError extends Error {}

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  constructor(
    private readonly client: Pick<Anthropic, 'messages'> = new Anthropic(),
  ) {}

  async complete(model: string, req: StructuredRequest) {
    const response = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: {
        effort: req.tier === 'FAST' ? 'low' : 'medium',
        format: { type: 'json_schema', schema: req.schema },
      },
    });
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      refused: response.stop_reason === 'refusal',
    };
  }
}

interface TierConfig {
  model: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

const price = (v: string | undefined) =>
  v && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;

export function tierConfig(tier: ModelTier): TierConfig | null {
  const model = process.env[`GROWTH_AI_${tier}_MODEL`]?.trim();
  const input = price(process.env[`GROWTH_AI_${tier}_INPUT_USD_PER_MTOK`]);
  const output = price(process.env[`GROWTH_AI_${tier}_OUTPUT_USD_PER_MTOK`]);
  if (
    !model ||
    !/^[a-z0-9.\-:@/]{3,80}$/i.test(model) ||
    input == null ||
    output == null
  )
    return null;
  return { model, inputUsdPerMTok: input, outputUsdPerMTok: output };
}

/** micro-USD: tokens × (USD / 1M tokens) × 1e6 / 1M = tokens × price. */
export const costMicroUsd = (inTok: number, outTok: number, c: TierConfig) =>
  Math.round(inTok * c.inputUsdPerMTok + outTok * c.outputUsdPerMTok);

@Injectable()
export class ModelRouter {
  private readonly logger = new Logger(ModelRouter.name);
  private failures = 0;
  private openUntil = 0;
  private provider: ModelProvider | null | undefined;

  constructor(private readonly prisma: PrismaService) {}

  /** Tests inject a fake provider; production builds one from configuration. */
  useProvider(p: ModelProvider | null) {
    this.provider = p;
  }

  private resolveProvider(): ModelProvider | null {
    if (this.provider !== undefined) return this.provider;
    if (
      process.env.GROWTH_AI_LLM_PROVIDER === 'anthropic' &&
      process.env.ANTHROPIC_API_KEY?.trim()
    )
      return new AnthropicProvider();
    return null;
  }

  status(): {
    configured: boolean;
    provider: string;
    models: string[];
    note: string;
  } {
    const p = growthFlag('GROWTH_AI_LLM_ENABLED')
      ? this.resolveProvider()
      : null;
    const models = (['FAST', 'QUALITY'] as const)
      .map((t) => tierConfig(t)?.model)
      .filter((m): m is string => !!m);
    if (!growthFlag('GROWTH_AI_LLM_ENABLED'))
      return {
        configured: false,
        provider: 'none',
        models,
        note: 'Model calls are off (GROWTH_AI_LLM_ENABLED). Ad copy uses templates.',
      };
    if (!p)
      return {
        configured: false,
        provider: 'none',
        models,
        note: 'No model provider is configured. Ad copy uses templates.',
      };
    return {
      configured: !!tierConfig('FAST'),
      provider: p.name,
      models,
      note: tierConfig('FAST')
        ? 'Model configured.'
        : 'Set GROWTH_AI_FAST_MODEL and its prices.',
    };
  }

  async todaysSpendMicroUsd(): Promise<number> {
    const agg = await this.prisma.growthAiUsage.aggregate({
      _sum: { costMicroUsd: true },
      where: { createdAt: { gte: indiaDayStart(indiaDay()) } },
    });
    return Number(agg._sum.costMicroUsd ?? 0);
  }

  async structured(req: StructuredRequest): Promise<StructuredResult> {
    if (!growthFlag('GROWTH_AI_LLM_ENABLED'))
      throw new ModelUnavailableError('Model calls are off.');
    const provider = this.resolveProvider();
    const cfg = tierConfig(req.tier);
    if (!provider || !cfg)
      throw new ModelUnavailableError('No model is configured for this task.');
    if (Date.now() < this.openUntil)
      throw new ModelUnavailableError(
        'The model provider failed repeatedly; calls are paused for a few minutes.',
      );
    const budgetUsd = price(process.env.GROWTH_AI_LLM_DAILY_BUDGET_USD) ?? 1;
    if ((await this.todaysSpendMicroUsd()) >= Math.round(budgetUsd * 1_000_000))
      throw new ModelUnavailableError(
        `Today's model budget (US$${budgetUsd}) is used up.`,
      );

    const record = (
      ok: boolean,
      inTok: number,
      outTok: number,
      error?: string,
    ) =>
      this.prisma.growthAiUsage.create({
        data: {
          feature: req.feature,
          provider: provider.name,
          model: cfg.model,
          inputTokens: inTok,
          outputTokens: outTok,
          costMicroUsd: BigInt(costMicroUsd(inTok, outTok, cfg)),
          ok,
          error: error?.slice(0, 300) ?? null,
          actorUserId: req.actorUserId,
        },
      });

    let out: Awaited<ReturnType<ModelProvider['complete']>>;
    try {
      out = await provider.complete(cfg.model, req);
    } catch (e) {
      this.failures += 1;
      if (this.failures >= 3) {
        this.openUntil = Date.now() + 10 * 60_000;
        this.failures = 0;
      }
      const message = e instanceof Error ? e.message : 'Model call failed.';
      this.logger.warn(`Growth AI model call failed: ${message}`);
      await record(false, 0, 0, message);
      throw new ModelUnavailableError(
        'The model call failed. Nothing was changed.',
      );
    }
    this.failures = 0;
    if (out.refused) {
      await record(false, out.inputTokens, out.outputTokens, 'refusal');
      throw new ModelUnavailableError('The model declined this request.');
    }
    let json: unknown;
    try {
      json = JSON.parse(out.text);
    } catch {
      await record(false, out.inputTokens, out.outputTokens, 'invalid JSON');
      throw new ModelUnavailableError(
        'The model returned something unreadable.',
      );
    }
    await record(true, out.inputTokens, out.outputTokens);
    return {
      json,
      model: cfg.model,
      provider: provider.name,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      costMicroUsd: costMicroUsd(out.inputTokens, out.outputTokens, cfg),
    };
  }
}
