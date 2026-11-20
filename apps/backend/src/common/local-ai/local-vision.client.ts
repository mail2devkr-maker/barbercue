import { Logger } from '@nestjs/common';
import { isPrivateModelUrl } from './private-model-url';

/**
 * One shared client for a SELF-HOSTED, OpenAI-compatible multimodal model (Ollama, llama.cpp
 * server, vLLM...) running on FastQue's own private network, e.g. an Ollama service reachable at
 * http://ollama.railway.internal:11434. It is the self-hosted alternative to Google Gemini for menu
 * photo reading, owner catalog import and the CRM sales coach's text analysis.
 *
 *   LOCAL_VISION_URL         base URL; must be loopback / RFC1918 / *.local / *.railway.internal
 *   LOCAL_VISION_MODEL       model tag, default qwen2.5vl:7b
 *   LOCAL_VISION_TIMEOUT_MS  per-request bound, default 300000, clamped to 5 s .. 15 min
 *
 * Only images go to the model (JPEG / PNG / WEBP). PDFs are refused: vision models take images,
 * and FastQue deliberately does not rasterise untrusted PDFs on the API server.
 * The model's answer is untrusted text; callers validate it with their own parsers.
 */
export const LOCAL_VISION_DEFAULT_MODEL = 'qwen2.5vl:7b';
export const LOCAL_VISION_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15 * 60_000;

/** The configured endpoint could not be reached, answered with an error, or timed out. */
export class LocalVisionRequestError extends Error {}
/** The model answered, but not with a JSON object. */
export class LocalVisionOutputError extends Error {}
/** The input cannot be sent to a local vision model (e.g. a PDF, or an unknown image type). */
export class LocalVisionUnsupportedInputError extends Error {}

export interface LocalVisionImage {
  mimeType: string;
  data: Buffer;
}

export interface LocalVisionRequest {
  /** Optional system instructions. */
  system?: string;
  /** The user-turn text (instructions and/or data such as a transcript). */
  prompt: string;
  /** Zero or more images, sent as base64 data URLs. */
  images?: LocalVisionImage[];
  maxTokens?: number;
}

export interface LocalVisionResult {
  /** The JSON object text the model returned (trimmed to the outermost braces). */
  json: string;
  totalTokens: number | null;
}

export function clampTimeout(raw: string | undefined): number {
  const n = Number(raw ?? '');
  if (!raw?.trim() || !Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(n)));
}

/** Strips any prose or ```json fences around the first-to-last brace. */
export function extractJsonObject(content: string): string {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new LocalVisionOutputError('The model did not return JSON.');
  const json = content.slice(start, end + 1);
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object');
  } catch {
    throw new LocalVisionOutputError('The model returned unreadable JSON.');
  }
  return json;
}

export class LocalVisionClient {
  private readonly logger = new Logger(LocalVisionClient.name);

  constructor(
    readonly baseUrl: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
    readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!isPrivateModelUrl(baseUrl))
      throw new Error('LOCAL_VISION_URL must be a private/loopback host');
  }

  async completeJson(request: LocalVisionRequest): Promise<LocalVisionResult> {
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = [{ type: 'text', text: request.prompt }];
    for (const image of request.images ?? []) {
      const type = image.mimeType.split(';')[0].trim().toLowerCase();
      if (type === 'application/pdf')
        throw new LocalVisionUnsupportedInputError(
          'The self-hosted model reads images, not PDFs.',
        );
      if (!(LOCAL_VISION_IMAGE_TYPES as readonly string[]).includes(type))
        throw new LocalVisionUnsupportedInputError(
          `Unsupported image type for the self-hosted model: ${type}`,
        );
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${type};base64,${image.data.toString('base64')}`,
        },
      });
    }
    const messages: Array<{ role: string; content: unknown }> = [];
    if (request.system)
      messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content });

    let body: {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { total_tokens?: unknown };
    };
    try {
      const res = await this.fetcher(
        `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: request.maxTokens ?? 8192,
            response_format: { type: 'json_object' },
            stream: false,
            messages,
          }),
        },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      body = (await res.json()) as typeof body;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'error';
      this.logger.warn(`self-hosted vision model request failed (${reason})`);
      throw new LocalVisionRequestError(
        'The self-hosted AI model did not respond.',
      );
    }
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string')
      throw new LocalVisionOutputError('The model returned no text.');
    const tokens = body.usage?.total_tokens;
    return {
      json: extractJsonObject(text),
      totalTokens:
        typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : null,
    };
  }
}

/**
 * The configured self-hosted model, or null when LOCAL_VISION_URL is unset or not private.
 * Never throws: a misconfigured URL fails closed (the feature reports "not configured").
 */
export function localVisionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): LocalVisionClient | null {
  const url = env.LOCAL_VISION_URL?.trim() ?? '';
  if (!url) return null;
  if (!isPrivateModelUrl(url)) {
    new Logger('LocalVision').warn(
      'LOCAL_VISION_URL is not a private host; the self-hosted AI provider stays off',
    );
    return null;
  }
  return new LocalVisionClient(
    url,
    env.LOCAL_VISION_MODEL?.trim() || LOCAL_VISION_DEFAULT_MODEL,
    fetcher,
    clampTimeout(env.LOCAL_VISION_TIMEOUT_MS),
  );
}
