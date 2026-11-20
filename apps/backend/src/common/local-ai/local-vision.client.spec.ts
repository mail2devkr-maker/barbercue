import {
  LocalVisionClient,
  LocalVisionOutputError,
  LocalVisionRequestError,
  LocalVisionUnsupportedInputError,
  clampTimeout,
  extractJsonObject,
  localVisionFromEnv,
} from './local-vision.client';
import { isPrivateModelUrl } from './private-model-url';
import {
  LocalWhisperClient,
  LocalWhisperError,
  formatWhisperTranscript,
  localWhisperFromEnv,
} from './local-whisper.client';

const okJson = (content: unknown, usage?: unknown) =>
  jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }], usage }),
  }) as unknown as jest.MockedFunction<typeof fetch>;

describe('self-hosted model host allowlist', () => {
  it.each([
    ['http://ollama.railway.internal:11434', true],
    ['http://localhost:11434', true],
    ['http://127.0.0.1:11434', true],
    ['http://[::1]:11434', true],
    ['http://10.0.0.5:11434', true],
    ['http://172.20.1.1:11434', true],
    ['http://192.168.1.10', true],
    ['http://gpu-box.local', true],
    ['https://generativelanguage.googleapis.com', false],
    ['https://api.openai.com/v1', false],
    ['https://my-home-pc.trycloudflare.com', false],
    ['https://abc.ngrok-free.app', false],
    ['http://172.32.0.1', false],
    ['http://user:pass@ollama.railway.internal:11434', false],
    ['ftp://ollama.railway.internal', false],
    ['not a url', false],
  ])('%s -> %s', (url, ok) => {
    expect(isPrivateModelUrl(url)).toBe(ok);
  });
});

describe('LocalVisionClient', () => {
  it('refuses to be constructed for a public host', () => {
    expect(
      () => new LocalVisionClient('https://api.openai.com', 'gpt-4o'),
    ).toThrow(/private/);
  });

  it('sends an OpenAI-compatible request: image data URL, JSON mode, temperature 0, bounded timeout', async () => {
    const fetcher = okJson('```json\n{"services":[]}\n```', {
      total_tokens: 1234,
    });
    const client = new LocalVisionClient(
      'http://ollama.railway.internal:11434/',
      'qwen2.5vl:7b',
      fetcher,
      9000,
    );
    const result = await client.completeJson({
      system: 'sys',
      prompt: 'read this',
      images: [{ mimeType: 'image/jpeg', data: Buffer.from('jpegbytes') }],
    });
    expect(result).toEqual({ json: '{"services":[]}', totalTokens: 1234 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'http://ollama.railway.internal:11434/v1/chat/completions',
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    expect(body).toMatchObject({
      model: 'qwen2.5vl:7b',
      temperature: 0,
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'read this' },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`,
        },
      },
    ]);
  });

  it('refuses PDFs and unknown image types before any network call', async () => {
    const fetcher = okJson('{}');
    const client = new LocalVisionClient(
      'http://localhost:11434',
      'm',
      fetcher,
    );
    await expect(
      client.completeJson({
        prompt: 'x',
        images: [{ mimeType: 'application/pdf', data: Buffer.from('%PDF-') }],
      }),
    ).rejects.toBeInstanceOf(LocalVisionUnsupportedInputError);
    await expect(
      client.completeJson({
        prompt: 'x',
        images: [{ mimeType: 'image/heic', data: Buffer.from('x') }],
      }),
    ).rejects.toBeInstanceOf(LocalVisionUnsupportedInputError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps HTTP errors and network failures to a request error', async () => {
    const bad = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new LocalVisionClient(
      'http://localhost:11434',
      'm',
      bad as unknown as typeof fetch,
    );
    await expect(client.completeJson({ prompt: 'x' })).rejects.toBeInstanceOf(
      LocalVisionRequestError,
    );
    const down = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client2 = new LocalVisionClient(
      'http://localhost:11434',
      'm',
      down as unknown as typeof fetch,
    );
    await expect(client2.completeJson({ prompt: 'x' })).rejects.toBeInstanceOf(
      LocalVisionRequestError,
    );
  });

  it('rejects non-JSON or non-object answers as output errors', async () => {
    for (const content of ['no json here', '[1,2]', '{broken', 42]) {
      const client = new LocalVisionClient(
        'http://localhost:11434',
        'm',
        okJson(content),
      );
      await expect(client.completeJson({ prompt: 'x' })).rejects.toBeInstanceOf(
        LocalVisionOutputError,
      );
    }
    expect(extractJsonObject('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
  });
});

describe('localVisionFromEnv', () => {
  it('is off without a URL, and fails closed for a public URL', () => {
    expect(localVisionFromEnv({})).toBeNull();
    expect(
      localVisionFromEnv({ LOCAL_VISION_URL: 'https://api.openai.com' }),
    ).toBeNull();
  });

  it('builds a client with the default model and a clamped timeout', () => {
    const client = localVisionFromEnv({
      LOCAL_VISION_URL: 'http://ollama.railway.internal:11434',
    });
    expect(client?.model).toBe('qwen2.5vl:7b');
    expect(client?.timeoutMs).toBe(300_000);
    expect(
      localVisionFromEnv({
        LOCAL_VISION_URL: 'http://ollama.railway.internal:11434',
        LOCAL_VISION_MODEL: 'gemma3:4b',
        LOCAL_VISION_TIMEOUT_MS: '60000',
      })?.model,
    ).toBe('gemma3:4b');
    expect(clampTimeout('1')).toBe(5_000);
    expect(clampTimeout('999999999')).toBe(15 * 60_000);
    expect(clampTimeout('abc')).toBe(300_000);
  });
});

describe('LocalWhisperClient', () => {
  it('formats verbose_json segments with [mm:ss] markers and falls back to plain text', () => {
    expect(
      formatWhisperTranscript({
        text: 'ignored',
        segments: [
          { start: 0, text: ' Namaste ji ' },
          { start: 75.4, text: 'FastQue se aaya hoon' },
          { start: 80, text: '   ' },
        ],
      }),
    ).toBe('[00:00] Namaste ji\n[01:15] FastQue se aaya hoon');
    expect(formatWhisperTranscript({ text: '  hello   there ' })).toBe(
      'hello there',
    );
    expect(formatWhisperTranscript(null)).toBe('');
  });

  it('posts multipart audio to the private whisper.cpp /inference endpoint', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ segments: [{ start: 1, text: 'hi' }] }),
    }) as unknown as jest.MockedFunction<typeof fetch>;
    const client = new LocalWhisperClient(
      'http://whisper.railway.internal:8080',
      fetcher,
    );
    await expect(
      client.transcribe(Buffer.from('a'), 'audio/webm;codecs=opus', 'en-IN'),
    ).resolves.toBe('[00:01] hi');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://whisper.railway.internal:8080/inference');
    const form = init?.body as FormData;
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('language')).toBe('en');
  });

  it('fails with a whisper error when the server is down or hears nothing', async () => {
    const down = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(
      new LocalWhisperClient(
        'http://localhost:8080',
        down as unknown as typeof fetch,
      ).transcribe(Buffer.from('a'), 'audio/webm', 'hi-IN'),
    ).rejects.toBeInstanceOf(LocalWhisperError);
    const empty = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });
    await expect(
      new LocalWhisperClient(
        'http://localhost:8080',
        empty as unknown as typeof fetch,
      ).transcribe(Buffer.from('a'), 'audio/webm', 'hi-IN'),
    ).rejects.toBeInstanceOf(LocalWhisperError);
  });

  it('uses LOCAL_WHISPER_URL, then ASSISTANT_WHISPER_URL, and never a public host', () => {
    expect(localWhisperFromEnv({})).toBeNull();
    expect(
      localWhisperFromEnv({ ASSISTANT_WHISPER_URL: 'http://localhost:8080' })
        ?.baseUrl,
    ).toBe('http://localhost:8080');
    expect(
      localWhisperFromEnv({
        LOCAL_WHISPER_URL: 'http://whisper.railway.internal:8080',
        ASSISTANT_WHISPER_URL: 'http://localhost:8080',
      })?.baseUrl,
    ).toBe('http://whisper.railway.internal:8080');
    expect(
      localWhisperFromEnv({ LOCAL_WHISPER_URL: 'https://api.openai.com' }),
    ).toBeNull();
  });
});
