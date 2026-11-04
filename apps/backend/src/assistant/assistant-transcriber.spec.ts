import { ASSISTANT_LIMITS } from '@barbercue/shared';
import {
  UnavailableTranscriber,
  WhisperTranscriber,
  transcriberFromEnv,
} from './assistant-transcriber';

const ok = (text: unknown) =>
  jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ text }) });

describe('assistant private voice transcriber', () => {
  it('is off unless a private Whisper server is configured', () => {
    expect(transcriberFromEnv({}).available).toBe(false);
    expect(
      transcriberFromEnv({ ASSISTANT_WHISPER_URL: 'https://api.openai.com' })
        .available,
    ).toBe(false);
    expect(
      transcriberFromEnv({
        ASSISTANT_WHISPER_URL: 'https://speech.googleapis.com',
      }).available,
    ).toBe(false);
    expect(
      transcriberFromEnv({ ASSISTANT_WHISPER_URL: 'http://127.0.0.1:8080' })
        .available,
    ).toBe(true);
    expect(
      transcriberFromEnv({
        ASSISTANT_WHISPER_URL: 'http://whisper.railway.internal:8080',
      }).available,
    ).toBe(true);
    expect(() => new WhisperTranscriber('https://example.com')).toThrow(
      /private/,
    );
  });

  it('refuses when not configured, without contacting anything', async () => {
    await expect(
      new UnavailableTranscriber().transcribe(),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('forwards one clip to whisper.cpp /inference and returns only the text', async () => {
    const fetcher = ok('  aaj ki   queue dikhao ');
    const t = new WhisperTranscriber(
      'http://127.0.0.1:8080/',
      fetcher as never,
    );
    await expect(
      t.transcribe(Buffer.from('audio'), 'audio/webm;codecs=opus', 'hi'),
    ).resolves.toEqual({ text: 'aaj ki queue dikhao', language: 'hi' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8080/inference');
    const form = init.body as FormData;
    expect(form.get('language')).toBe('hi');
    expect(form.get('response_format')).toBe('json');
  });

  it('rejects other formats, empty or oversized clips before sending', async () => {
    const fetcher = ok('x');
    const t = new WhisperTranscriber('http://127.0.0.1:8080', fetcher as never);
    await expect(
      t.transcribe(Buffer.from('x'), 'application/pdf', 'hi'),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      t.transcribe(Buffer.alloc(0), 'audio/webm', 'hi'),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      t.transcribe(
        Buffer.alloc(ASSISTANT_LIMITS.maxAudioBytes + 1),
        'audio/webm',
        'hi',
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed with a plain message when the server is down or returns no words', async () => {
    const down = new WhisperTranscriber(
      'http://127.0.0.1:8080',
      jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never,
    );
    await expect(
      down.transcribe(Buffer.from('a'), 'audio/webm', 'en'),
    ).rejects.toMatchObject({ status: 503 });
    const silent = new WhisperTranscriber(
      'http://127.0.0.1:8080',
      ok('   ') as never,
    );
    await expect(
      silent.transcribe(Buffer.from('a'), 'audio/webm', 'en'),
    ).rejects.toMatchObject({ status: 422 });
  });
});
