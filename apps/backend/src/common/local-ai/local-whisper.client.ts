import { Logger } from '@nestjs/common';
import { isPrivateModelUrl } from './private-model-url';

/**
 * Long-form speech-to-text through a SELF-HOSTED whisper.cpp `server` on FastQue's private
 * network, for the CRM sales coach's local provider. Vision models cannot hear audio, so the local
 * coach first transcribes here, then asks the self-hosted model (LOCAL_VISION_URL) to analyse text.
 *
 *   LOCAL_WHISPER_URL         base URL of whisper.cpp server (falls back to ASSISTANT_WHISPER_URL);
 *                             loopback / RFC1918 / *.local / *.railway.internal only
 *   LOCAL_WHISPER_TIMEOUT_MS  per-recording bound, default 600000, clamped to 10 s .. 30 min
 *
 * The server must run with `--convert` (ffmpeg) so browser webm/ogg/mp4 recordings are accepted.
 */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_TRANSCRIPT = 200_000;

export class LocalWhisperError extends Error {}

function clampTimeout(raw: string | undefined): number {
  const n = Number(raw ?? '');
  if (!raw?.trim() || !Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(n)));
}

const stamp = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}]`;
};

/** whisper.cpp verbose_json -> "[mm:ss] text" lines; plain `text` when there are no segments. */
export function formatWhisperTranscript(body: unknown): string {
  const b = (body ?? {}) as { text?: unknown; segments?: unknown };
  const lines = Array.isArray(b.segments)
    ? b.segments
        .filter(
          (s): s is { start?: unknown; text: string } =>
            !!s &&
            typeof s === 'object' &&
            typeof (s as { text?: unknown }).text === 'string',
        )
        .map((s) => {
          const text = s.text.replace(/\s+/g, ' ').trim();
          if (!text) return '';
          return typeof s.start === 'number' && Number.isFinite(s.start)
            ? `${stamp(s.start)} ${text}`
            : text;
        })
        .filter((line) => line)
    : [];
  const transcript = lines.length
    ? lines.join('\n')
    : typeof b.text === 'string'
      ? b.text.replace(/\s+/g, ' ').trim()
      : '';
  return transcript.slice(0, MAX_TRANSCRIPT);
}

export class LocalWhisperClient {
  private readonly logger = new Logger(LocalWhisperClient.name);

  constructor(
    readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!isPrivateModelUrl(baseUrl))
      throw new Error('LOCAL_WHISPER_URL must be a private/loopback host');
  }

  async transcribe(
    audio: Buffer,
    mimeType: string,
    language: string,
  ): Promise<string> {
    const type = mimeType.split(';')[0].trim().toLowerCase();
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type }),
      'recording',
    );
    form.append('response_format', 'verbose_json');
    form.append(
      'language',
      language.toLowerCase().startsWith('en') ? 'en' : 'hi',
    );
    form.append('temperature', '0');
    let body: unknown;
    try {
      const res = await this.fetcher(
        `${this.baseUrl.replace(/\/$/, '')}/inference`,
        {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      body = await res.json();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'error';
      this.logger.warn(`self-hosted speech recognition failed (${reason})`);
      throw new LocalWhisperError(
        'The self-hosted speech recognition service did not respond.',
      );
    }
    const transcript = formatWhisperTranscript(body);
    if (!transcript)
      throw new LocalWhisperError('No speech was recognised in the recording.');
    return transcript;
  }
}

export function localWhisperFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): LocalWhisperClient | null {
  const url =
    env.LOCAL_WHISPER_URL?.trim() || env.ASSISTANT_WHISPER_URL?.trim() || '';
  if (!url) return null;
  if (!isPrivateModelUrl(url)) {
    new Logger('LocalWhisper').warn(
      'LOCAL_WHISPER_URL is not a private host; local sales-coach transcription stays off',
    );
    return null;
  }
  return new LocalWhisperClient(
    url,
    fetcher,
    clampTimeout(env.LOCAL_WHISPER_TIMEOUT_MS),
  );
}
