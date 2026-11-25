import { LocalVisionClient } from '../common/local-ai/local-vision.client';
import { LocalWhisperClient } from '../common/local-ai/local-whisper.client';
import { LocalSalesCoach, salesCoachProvider } from './sales-coach.provider';

describe('sales coach provider selection (local)', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env = { ...env };
    for (const k of [
      'SALES_COACH_PROVIDER',
      'SALES_COACH_ENABLED',
      'GEMINI_API_KEY',
      'LOCAL_WHISPER_URL',
      'ASSISTANT_WHISPER_URL',
      'LOCAL_VISION_URL',
    ])
      delete process.env[k];
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('selects the local coach only when both private services are set', () => {
    process.env.SALES_COACH_PROVIDER = 'local';
    process.env.SALES_COACH_ENABLED = 'true';
    process.env.LOCAL_VISION_URL = 'http://ollama.railway.internal:11434';
    expect(salesCoachProvider().configured).toBe(false);
    process.env.LOCAL_WHISPER_URL = 'http://whisper.railway.internal:8080';
    const coach = salesCoachProvider();
    expect(coach).toBeInstanceOf(LocalSalesCoach);
    expect(coach).toMatchObject({
      name: 'local',
      configured: true,
      enabled: true,
    });
  });

  it('fails closed for public hosts and does not use a Gemini key for "local"', () => {
    process.env.SALES_COACH_PROVIDER = 'local';
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    process.env.LOCAL_WHISPER_URL = 'https://api.openai.com';
    process.env.LOCAL_VISION_URL = 'http://ollama.railway.internal:11434';
    expect(salesCoachProvider().configured).toBe(false);
  });

  it('is configured but off until SALES_COACH_ENABLED=true', async () => {
    process.env.SALES_COACH_PROVIDER = 'local';
    process.env.LOCAL_WHISPER_URL = 'http://localhost:8080';
    process.env.LOCAL_VISION_URL = 'http://localhost:11434';
    const coach = salesCoachProvider();
    expect(coach.configured).toBe(true);
    expect(coach.enabled).toBe(false);
    await expect(
      coach.analyse(Buffer.from('x'), 'audio/webm', {
        language: 'hi-IN',
        durationSeconds: 1,
      }),
    ).rejects.toThrow(/turned off/);
  });
});

describe('LocalSalesCoach', () => {
  it("transcribes with whisper, analyses only text, and keeps whisper's transcript", async () => {
    const whisperFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          segments: [{ start: 3, text: 'Namaste, main FastQue se hoon' }],
        }),
    });
    const modelFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          usage: { total_tokens: 900 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  transcript: 'MODEL REWRITE - must be ignored',
                  report: {
                    overallScore: 72,
                    summary: 'Good opener',
                    criteria: [],
                  },
                }),
              },
            },
          ],
        }),
    });
    const coach = new LocalSalesCoach(
      new LocalWhisperClient(
        'http://localhost:8080',
        whisperFetch as unknown as typeof fetch,
      ),
      new LocalVisionClient(
        'http://localhost:11434',
        'qwen2.5vl:7b',
        modelFetch as unknown as typeof fetch,
      ),
      true,
    );
    const result = await coach.analyse(Buffer.from('audio'), 'audio/webm', {
      language: 'hi-IN',
      durationSeconds: 60,
    });
    expect(result.transcript).toBe('[00:03] Namaste, main FastQue se hoon');
    expect(result.report.overallScore).toBe(72);
    expect(result.model).toBe('local:qwen2.5vl:7b');
    expect(result.totalTokens).toBe(900);
    const body = JSON.parse(String(modelFetch.mock.calls[0][1].body)) as {
      messages: Array<{
        role: string;
        content: Array<{ type: string; text?: string }>;
      }>;
    };
    // No audio and no image goes to the model - only the transcript text.
    expect(body.messages[1].content).toHaveLength(1);
    expect(body.messages[1].content[0].type).toBe('text');
    expect(body.messages[1].content[0].text).toContain('[00:03] Namaste');
  });

  it('does not produce a score when whisper or the model fails', async () => {
    const down = jest.fn().mockRejectedValue(new Error('down'));
    const modelFetch = jest.fn();
    const coach = new LocalSalesCoach(
      new LocalWhisperClient(
        'http://localhost:8080',
        down as unknown as typeof fetch,
      ),
      new LocalVisionClient(
        'http://localhost:11434',
        'm',
        modelFetch as unknown as typeof fetch,
      ),
      true,
    );
    await expect(
      coach.analyse(Buffer.from('a'), 'audio/webm', {
        language: 'en-IN',
        durationSeconds: 5,
      }),
    ).rejects.toThrow();
    expect(modelFetch).not.toHaveBeenCalled();
  });
});
