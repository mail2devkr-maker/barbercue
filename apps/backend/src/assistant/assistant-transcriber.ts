import { HttpStatus, Logger } from '@nestjs/common';
import {
  ASSISTANT_LIMITS,
  type AssistantTranscriptionDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { isPrivateModelUrl } from './assistant-interpreter';

/**
 * Optional private speech-to-text for the Action Assistant (issue #362). Off unless
 * ASSISTANT_WHISPER_URL points at a self-hosted whisper.cpp `server` on a PRIVATE host (loopback,
 * RFC1918, *.local, *.railway.internal) - the same rule as the local model, so it can never be aimed
 * at a paid or public service. Audio is forwarded once and never stored or logged; only the text
 * comes back. Without it, the browser's own recognizer (disclosed to the user) or typing is used.
 */
export const ASSISTANT_TRANSCRIBER = Symbol('ASSISTANT_TRANSCRIBER');

export interface Transcriber {
  readonly available: boolean;
  transcribe(
    audio: Buffer,
    mimeType: string,
    language: string,
  ): Promise<AssistantTranscriptionDto>;
}

const AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp4',
];

export class UnavailableTranscriber implements Transcriber {
  readonly available = false;
  transcribe(): Promise<AssistantTranscriptionDto> {
    return Promise.reject(
      new AppException(
        'ASSISTANT_TRANSCRIPTION_UNAVAILABLE',
        'Private voice recognition is not set up. Use the browser microphone or type.',
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    );
  }
}

export class WhisperTranscriber implements Transcriber {
  readonly available = true;
  private readonly logger = new Logger(WhisperTranscriber.name);

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {
    if (!isPrivateModelUrl(baseUrl))
      throw new Error('ASSISTANT_WHISPER_URL must be a private/loopback host');
  }

  async transcribe(
    audio: Buffer,
    mimeType: string,
    language: string,
  ): Promise<AssistantTranscriptionDto> {
    const type = mimeType.split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.includes(type)) {
      throw new AppException(
        'ASSISTANT_AUDIO_INVALID',
        'Unsupported audio format.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    if (!audio.length || audio.length > ASSISTANT_LIMITS.maxAudioBytes) {
      throw new AppException(
        'ASSISTANT_AUDIO_INVALID',
        'Recording is empty or too long. Keep it under 30 seconds.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const lang = language === 'en' ? 'en' : 'hi';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type }), 'speech');
    form.append('response_format', 'json');
    form.append('language', lang);
    form.append('temperature', '0');
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
      const body = (await res.json()) as { text?: unknown };
      const text =
        typeof body.text === 'string'
          ? body.text
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, ASSISTANT_LIMITS.maxTextLength)
          : '';
      if (!text)
        throw new AppException(
          'ASSISTANT_AUDIO_EMPTY',
          "I couldn't hear any words. Try again or type.",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      return { text, language: lang };
    } catch (err) {
      if (err instanceof AppException) throw err;
      this.logger.warn(
        `private voice recognition unavailable (${err instanceof Error ? err.message : 'error'})`,
      );
      throw new AppException(
        'ASSISTANT_TRANSCRIPTION_UNAVAILABLE',
        'Private voice recognition is not responding. Please type instead.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

export function transcriberFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Transcriber {
  const url = env.ASSISTANT_WHISPER_URL?.trim();
  if (!url) return new UnavailableTranscriber();
  if (!isPrivateModelUrl(url)) {
    new Logger('AssistantTranscriber').warn(
      'ASSISTANT_WHISPER_URL is not a private host; private voice recognition stays off',
    );
    return new UnavailableTranscriber();
  }
  return new WhisperTranscriber(url);
}
