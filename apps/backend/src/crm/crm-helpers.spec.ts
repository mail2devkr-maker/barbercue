import { SALES_COACH_CRITERIA } from '@barbercue/shared';
import { guessLeadField, phoneKey } from './crm-leads.service';
import {
  estimateCostUsd,
  parseCoachJson,
  salesCoachProvider,
} from './sales-coach.provider';

describe('sales coach provider', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is "not configured" without a provider or key, so no score can ever be produced', async () => {
    delete process.env.SALES_COACH_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    const coach = salesCoachProvider();
    expect(coach.configured).toBe(false);
    expect(coach.enabled).toBe(false);
    await expect(
      coach.analyse(Buffer.from('x'), 'audio/webm', {
        language: 'hi-IN',
        durationSeconds: 1,
      }),
    ).rejects.toThrow();
  });

  it('stays not configured when the provider is named but the key is missing', () => {
    process.env.SALES_COACH_PROVIDER = 'gemini';
    delete process.env.GEMINI_API_KEY;
    expect(salesCoachProvider().configured).toBe(false);
  });

  it('is configured but off until SALES_COACH_ENABLED=true', () => {
    process.env.SALES_COACH_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    process.env.SALES_COACH_ENABLED = 'false';
    const coach = salesCoachProvider();
    expect(coach.configured).toBe(true);
    expect(coach.enabled).toBe(false);
  });

  it('estimates cost only when a price is set', () => {
    delete process.env.SALES_COACH_USD_PER_MILLION_TOKENS;
    expect(estimateCostUsd(500_000)).toBeNull();
    process.env.SALES_COACH_USD_PER_MILLION_TOKENS = '0.6';
    expect(estimateCostUsd(500_000)).toBe(0.3);
    expect(estimateCostUsd(null)).toBeNull();
  });
});

describe('parseCoachJson', () => {
  const key = SALES_COACH_CRITERIA[0][0];
  it('clamps scores, drops unknown criteria and nulls irrelevant ones', () => {
    const { report, transcript } = parseCoachJson(
      JSON.stringify({
        transcript: 'hello',
        report: {
          overallScore: 140,
          summary: 'ok',
          criteria: [
            {
              key,
              score: -5,
              relevant: true,
              evidence: [{ quote: 'namaste', atSeconds: 3.6 }],
              note: 'n',
            },
            { key: 'pricing', score: 80, relevant: false },
            { key: 'madeUp', score: 50 },
          ],
          strengths: ['a', 7],
        },
      }),
    );
    expect(transcript).toBe('hello');
    expect(report.overallScore).toBe(100);
    expect(report.criteria).toHaveLength(2);
    expect(report.criteria[0]).toMatchObject({
      key,
      score: 0,
      evidence: [{ quote: 'namaste', atSeconds: 4 }],
    });
    expect(report.criteria[1]).toMatchObject({
      key: 'pricing',
      score: null,
      relevant: false,
    });
    expect(report.strengths).toEqual(['a']);
  });

  it('rejects a response without an overall score instead of inventing one', () => {
    expect(() =>
      parseCoachJson(JSON.stringify({ report: { summary: 'x' } })),
    ).toThrow(/overall score/);
    expect(() => parseCoachJson('not json')).toThrow();
  });
});

describe('lead import helpers', () => {
  it('maps common header spellings to lead fields', () => {
    expect(guessLeadField('Salon Name')).toBe('shopName');
    expect(guessLeadField('Mobile')).toBe('phone');
    expect(guessLeadField('City')).toBe('city');
    expect(guessLeadField('totally unrelated')).toBeNull();
  });

  it('compares phone numbers by their last 10 digits', () => {
    expect(phoneKey('+91 98765-43210')).toBe('9876543210');
    expect(phoneKey('098765 43210')).toBe('9876543210');
    expect(phoneKey('')).toBeNull();
  });
});
