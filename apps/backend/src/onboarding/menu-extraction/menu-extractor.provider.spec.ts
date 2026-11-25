import sharp from 'sharp';
import { LocalVisionClient } from '../../common/local-ai/local-vision.client';
import {
  GeminiMenuExtractor,
  LocalMenuExtractor,
  MenuExtractorFailedError,
  UnconfiguredMenuExtractor,
  menuExtractorFromEnv,
} from './menu-extractor';

describe('menu extraction provider selection', () => {
  const on = { ONBOARDING_MENU_EXTRACTION_ENABLED: 'true' };
  const local = { LOCAL_VISION_URL: 'http://ollama.railway.internal:11434' };

  it('keeps Gemini as the default provider when the switch is on and a key exists', () => {
    expect(menuExtractorFromEnv({ ...on, GEMINI_API_KEY: 'k' })).toBeInstanceOf(
      GeminiMenuExtractor,
    );
    expect(
      menuExtractorFromEnv({
        ...on,
        GEMINI_API_KEY: 'k',
        ONBOARDING_MENU_EXTRACTION_PROVIDER: 'gemini',
      }),
    ).toBeInstanceOf(GeminiMenuExtractor);
  });

  it('selects the self-hosted model only when asked, with a private URL', () => {
    const extractor = menuExtractorFromEnv({
      ...on,
      ...local,
      ONBOARDING_MENU_EXTRACTION_PROVIDER: 'local',
      LOCAL_VISION_MODEL: 'gemma3:4b',
    });
    expect(extractor).toBeInstanceOf(LocalMenuExtractor);
    expect(extractor.provider).toBe('local:gemma3:4b');
    expect(extractor.isConfigured).toBe(true);
  });

  it.each([
    ['switch off', { ...local, ONBOARDING_MENU_EXTRACTION_PROVIDER: 'local' }],
    [
      'local without URL',
      {
        ...on,
        ONBOARDING_MENU_EXTRACTION_PROVIDER: 'local',
        GEMINI_API_KEY: 'k',
      },
    ],
    [
      'local with public URL',
      {
        ...on,
        ONBOARDING_MENU_EXTRACTION_PROVIDER: 'local',
        LOCAL_VISION_URL: 'https://api.openai.com',
      },
    ],
    [
      'explicit none',
      {
        ...on,
        ...local,
        GEMINI_API_KEY: 'k',
        ONBOARDING_MENU_EXTRACTION_PROVIDER: 'none',
      },
    ],
    [
      'unknown provider',
      {
        ...on,
        ...local,
        GEMINI_API_KEY: 'k',
        ONBOARDING_MENU_EXTRACTION_PROVIDER: 'openai',
      },
    ],
    [
      'gemini without key',
      { ...on, ...local, ONBOARDING_MENU_EXTRACTION_PROVIDER: 'gemini' },
    ],
  ])('fails closed (%s), never silently switching provider', (_label, env) => {
    expect(menuExtractorFromEnv(env)).toBeInstanceOf(UnconfiguredMenuExtractor);
  });
});

describe('LocalMenuExtractor', () => {
  let photo: Buffer;
  beforeAll(async () => {
    photo = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
  });

  const clientReturning = (content: unknown) => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    }) as unknown as jest.MockedFunction<typeof fetch>;
    return {
      fetcher,
      client: new LocalVisionClient(
        'http://localhost:11434',
        'qwen2.5vl:7b',
        fetcher,
      ),
    };
  };

  it('sends a bounded JPEG and parses rows with the shared validator', async () => {
    const { fetcher, client } = clientReturning(
      JSON.stringify({
        services: [{ name: 'Beard Trim', price: 80, gender: 'MEN' }],
      }),
    );
    const rows = await new LocalMenuExtractor(client).extract(
      photo,
      'image/png',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Beard Trim',
        price: 80,
        gender: 'MEN',
        durationMinutes: null,
      }),
    ]);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: Array<{ image_url?: { url: string } }> }>;
    };
    const dataUrl = body.messages[0].content[1].image_url!.url;
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    const meta = await sharp(
      Buffer.from(dataUrl.split(',')[1], 'base64'),
    ).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(2048);
  });

  it('turns unreachable models, garbage output and undecodable images into a failed extraction', async () => {
    await expect(
      new LocalMenuExtractor(clientReturning('no json').client).extract(
        photo,
        'image/png',
      ),
    ).rejects.toBeInstanceOf(MenuExtractorFailedError);
    await expect(
      new LocalMenuExtractor(clientReturning('{"items":[]}').client).extract(
        photo,
        'image/png',
      ),
    ).rejects.toBeInstanceOf(MenuExtractorFailedError);
    const { client, fetcher } = clientReturning('{}');
    await expect(
      new LocalMenuExtractor(client).extract(
        Buffer.from('not an image'),
        'image/jpeg',
      ),
    ).rejects.toBeInstanceOf(MenuExtractorFailedError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
