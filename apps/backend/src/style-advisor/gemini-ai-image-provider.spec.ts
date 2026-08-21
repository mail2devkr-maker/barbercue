import { ApiError } from '@google/genai';
import { GeminiAiImageProvider } from './gemini-ai-image-provider';

const generateContentMock = jest.fn();

// Mocks the SDK entirely — this suite never makes a real (paid) Gemini API call. Only the
// constructor + models.generateContent shape used by GeminiAiImageProvider is stubbed; ApiError
// itself is the real exported class so `instanceof` checks in the provider work unmodified.
jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai');
  return {
    ...actual,
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: { generateContent: generateContentMock },
    })),
  };
});

function imagePart(data: string, mimeType = 'image/png') {
  return { candidates: [{ content: { parts: [{ inlineData: { data, mimeType } }] } }] };
}

describe('GeminiAiImageProvider', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it('generates exactly 3 previews, one Gemini call per style, in the expected style order', async () => {
    generateContentMock
      .mockResolvedValueOnce(imagePart('ZmFrZS1pbWFnZS0x'))
      .mockResolvedValueOnce(imagePart('ZmFrZS1pbWFnZS0y'))
      .mockResolvedValueOnce(imagePart('ZmFrZS1pbWFnZS0z'));

    const provider = new GeminiAiImageProvider('test-key');
    const results = await provider.generate(Buffer.from('source-photo-bytes'), 'image/jpeg');

    expect(generateContentMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.styleId)).toEqual(['fade', 'textured-quiff', 'undercut']);
    expect(results[0].previewUrl).toBe('data:image/png;base64,ZmFrZS1pbWFnZS0x');
    expect(results.every((r) => typeof r.matchPercent === 'number')).toBe(true);

    const firstCallArgs = generateContentMock.mock.calls[0][0];
    expect(firstCallArgs.model).toBe('gemini-2.5-flash-image');
    const parts = firstCallArgs.contents[0].parts;
    expect(parts[1].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from('source-photo-bytes').toString('base64'),
    });
  });

  it('never logs or embeds the source image bytes in the outgoing request text', async () => {
    generateContentMock.mockResolvedValue(imagePart('b3V0cHV0'));
    const provider = new GeminiAiImageProvider('test-key');
    await provider.generate(Buffer.from('source-photo-bytes'), 'image/jpeg');

    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).not.toContain(Buffer.from('source-photo-bytes').toString('base64'));
  });

  it('stops after the failing call instead of attempting remaining styles (bounded cost)', async () => {
    generateContentMock
      .mockResolvedValueOnce(imagePart('b25l'))
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }));

    const provider = new GeminiAiImageProvider('test-key');
    await expect(
      provider.generate(Buffer.from('source-photo-bytes'), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });

    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('maps a 429 ApiError to AI_RATE_LIMITED', async () => {
    generateContentMock.mockRejectedValue(new ApiError({ message: 'rate limited', status: 429 }));
    const provider = new GeminiAiImageProvider('test-key');

    await expect(
      provider.generate(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
  });

  it('maps a non-429 ApiError to AI_GENERATION_FAILED', async () => {
    generateContentMock.mockRejectedValue(new ApiError({ message: 'server error', status: 500 }));
    const provider = new GeminiAiImageProvider('test-key');

    await expect(
      provider.generate(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'AI_GENERATION_FAILED' });
  });

  it('maps a non-ApiError thrown value to AI_GENERATION_FAILED', async () => {
    generateContentMock.mockRejectedValue(new Error('network timeout'));
    const provider = new GeminiAiImageProvider('test-key');

    await expect(
      provider.generate(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'AI_GENERATION_FAILED' });
  });

  it('maps a response with no inline image data to AI_GENERATION_FAILED', async () => {
    generateContentMock.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'no image, sorry' }] } }] });
    const provider = new GeminiAiImageProvider('test-key');

    await expect(
      provider.generate(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'AI_GENERATION_FAILED' });
  });
});
