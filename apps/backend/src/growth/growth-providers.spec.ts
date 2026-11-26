import {
  GoogleAdsKeywordProvider,
  KeywordProviderUnavailable,
  MockKeywordProvider,
  keywordProviderFromEnv,
  mapGoogleAdsIdeas,
} from './keyword-providers';
import {
  AnthropicProvider,
  ModelRouter,
  ModelUnavailableError,
  costMicroUsd,
  tierConfig,
  type ModelProvider,
} from './model-router';

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

const req = { seeds: ['haircut', 'salon near me'], cityName: 'Greater Noida', geoTargetConstant: 'geoTargetConstants/1007751', language: 'languageConstants/1000' };

describe('keyword providers', () => {
  it('defaults to no provider and refuses to run (nothing is invented)', async () => {
    delete process.env.GROWTH_AI_KEYWORD_PROVIDER;
    const p = keywordProviderFromEnv();
    expect(p.name).toBe('none');
    expect(p.configured).toBe(false);
    await expect(p.generate(req)).rejects.toBeInstanceOf(KeywordProviderUnavailable);
  });

  it('mock data is labelled and deterministic', async () => {
    const p = new MockKeywordProvider();
    expect(p.isMock).toBe(true);
    const a = await p.generate(req);
    const b = await p.generate(req);
    expect(a).toEqual(b);
    expect(a.map((i) => i.keyword)).toContain('haircut greater noida');
    expect(a.every((i) => (i.lowBidMicros ?? 0) <= (i.highBidMicros ?? 0))).toBe(true);
  });

  it('maps a GenerateKeywordIdeas response, keeping missing metrics as null', () => {
    const rows = mapGoogleAdsIdeas({
      results: [
        {
          text: 'haircut near me',
          keywordIdeaMetrics: {
            avgMonthlySearches: '2900',
            competition: 'HIGH',
            competitionIndex: '81',
            lowTopOfPageBidMicros: '9120000',
            highTopOfPageBidMicros: '31000000',
            monthlySearchVolumes: [{ year: '2026', month: 'OCTOBER', monthlySearches: '2400' }],
          },
        },
        { text: 'barber greater noida', keywordIdeaMetrics: {} },
        { keywordIdeaMetrics: {} },
      ],
    });
    expect(rows).toEqual([
      { keyword: 'haircut near me', avgMonthlySearches: 2900, monthly: [{ year: 2026, month: 10, searches: 2400 }], competition: 'HIGH', competitionIndex: 81, lowBidMicros: 9120000, highBidMicros: 31000000 },
      { keyword: 'barber greater noida', avgMonthlySearches: null, monthly: [], competition: 'UNKNOWN', competitionIndex: null, lowBidMicros: null, highBidMicros: null },
    ]);
  });

  it('calls only Google hosts, with the configured account and headers', async () => {
    Object.assign(process.env, {
      GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: '9876543210',
      GOOGLE_ADS_CLIENT_ID: 'client',
      GOOGLE_ADS_CLIENT_SECRET: 'secret',
      GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
    });
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fake = (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      const json = url.includes('oauth2') ? { access_token: 'tok' } : { results: [{ text: 'haircut', keywordIdeaMetrics: { avgMonthlySearches: '10' } }] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json), text: () => Promise.resolve('') });
    };
    const p = new GoogleAdsKeywordProvider(fake as never);
    expect(p.configured).toBe(true);
    const out = await p.generate(req);
    expect(out[0]).toMatchObject({ keyword: 'haircut', avgMonthlySearches: 10 });
    expect(calls[0].url).toBe('https://www.googleapis.com/oauth2/v3/token');
    expect(calls[1].url).toBe('https://googleads.googleapis.com/v26/customers/1234567890:generateKeywordIdeas');
    expect(calls[1].headers).toMatchObject({ Authorization: 'Bearer tok', 'login-customer-id': '9876543210' });
    expect(JSON.parse(calls[1].body)).toMatchObject({ geoTargetConstants: ['geoTargetConstants/1007751'], keywordPlanNetwork: 'GOOGLE_SEARCH', includeAdultKeywords: false });
  });

  it('refuses real research without a city-level location', async () => {
    Object.assign(process.env, { GOOGLE_ADS_CUSTOMER_ID: '1234567890', GOOGLE_ADS_CLIENT_ID: 'c', GOOGLE_ADS_CLIENT_SECRET: 's', GOOGLE_ADS_REFRESH_TOKEN: 'r' });
    const p = new GoogleAdsKeywordProvider((() => Promise.reject(new Error('should not be called'))) as never);
    await expect(p.generate({ ...req, geoTargetConstant: null })).rejects.toThrow('city-level');
  });
});

describe('model router', () => {
  const usage: Array<Record<string, unknown>> = [];
  const prisma = {
    growthAiUsage: {
      create: jest.fn((a: { data: Record<string, unknown> }) => {
        usage.push(a.data);
        return Promise.resolve(a.data);
      }),
      aggregate: jest.fn(() => Promise.resolve({ _sum: { costMicroUsd: BigInt(usage.reduce((s, u) => s + Number(u.costMicroUsd), 0)) } })),
    },
  };
  const request = { feature: 'ad_copy', tier: 'FAST' as const, system: 's', user: '{}', schema: {}, maxTokens: 100, actorUserId: 'u1' };
  const configure = () =>
    Object.assign(process.env, {
      GROWTH_AI_ENABLED: 'true',
      GROWTH_AI_LLM_ENABLED: 'true',
      GROWTH_AI_FAST_MODEL: 'claude-haiku-5-5',
      GROWTH_AI_FAST_INPUT_USD_PER_MTOK: '0.10',
      GROWTH_AI_FAST_OUTPUT_USD_PER_MTOK: '0.50',
    });
  const provider = (out: Partial<Awaited<ReturnType<ModelProvider['complete']>>> | Error): ModelProvider => ({
    name: 'fake',
    complete: () => (out instanceof Error ? Promise.reject(out) : Promise.resolve({ text: '{"ok":true}', inputTokens: 1000, outputTokens: 200, refused: false, ...out })),
  });
  beforeEach(() => {
    usage.length = 0;
  });

  it('keeps models and prices in configuration and computes cost exactly', () => {
    expect(tierConfig('FAST')).toBeNull();
    configure();
    const cfg = tierConfig('FAST')!;
    expect(cfg.model).toBe('claude-haiku-5-5');
    // 1000 × $0.10/M + 200 × $0.50/M = $0.0002 = 200 micro-USD
    expect(costMicroUsd(1000, 200, cfg)).toBe(200);
  });

  it('is off unless both flags are on', async () => {
    const r = new ModelRouter(prisma as never);
    r.useProvider(provider({}));
    await expect(r.structured(request)).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(r.status().configured).toBe(false);
  });

  it('records usage for every call, and treats refusals and bad JSON as failures', async () => {
    configure();
    const r = new ModelRouter(prisma as never);
    r.useProvider(provider({}));
    await expect(r.structured(request)).resolves.toMatchObject({ json: { ok: true }, costMicroUsd: 200 });
    r.useProvider(provider({ refused: true }));
    await expect(r.structured(request)).rejects.toThrow('declined');
    r.useProvider(provider({ text: 'not json' }));
    await expect(r.structured(request)).rejects.toThrow('unreadable');
    expect(usage.map((u) => [u.ok, u.error ?? null])).toEqual([[true, null], [false, 'refusal'], [false, 'invalid JSON']]);
  });

  it('stops at the daily budget', async () => {
    configure();
    process.env.GROWTH_AI_LLM_DAILY_BUDGET_USD = '0.0003';
    const r = new ModelRouter(prisma as never);
    r.useProvider(provider({}));
    await r.structured(request);
    await r.structured(request);
    await expect(r.structured(request)).rejects.toThrow('budget');
  });

  it('opens a circuit breaker after three failures', async () => {
    configure();
    const r = new ModelRouter(prisma as never);
    r.useProvider(provider(new Error('boom')));
    for (let i = 0; i < 3; i++) await expect(r.structured(request)).rejects.toThrow('failed');
    r.useProvider(provider({}));
    await expect(r.structured(request)).rejects.toThrow('paused');
  });

  it('sends structured output and low effort through the Anthropic SDK', async () => {
    const create = jest.fn(() => Promise.resolve({ content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 5, output_tokens: 7 }, stop_reason: 'end_turn' }));
    const p = new AnthropicProvider({ messages: { create } } as never);
    await expect(p.complete('claude-haiku-5-5', { ...request, schema: { type: 'object' } })).resolves.toEqual({ text: '{"a":1}', inputTokens: 5, outputTokens: 7, refused: false });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-5-5', output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } } }),
    );
  });
});
