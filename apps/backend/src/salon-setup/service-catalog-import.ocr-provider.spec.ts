import sharp from 'sharp';
import {
  ServiceCatalogImportService,
  catalogOcrProvider,
} from './service-catalog-import.service';

/** Provider selection for PDF/photo catalog OCR. No real Gemini or model call is ever made. */
describe('catalog import OCR provider selection', () => {
  const env = { ...process.env };
  const access = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
  const prisma = { $transaction: jest.fn() };
  let subject: ServiceCatalogImportService;
  let fetchSpy: jest.SpyInstance;
  const file = (name: string, buffer: Buffer) =>
    ({ originalname: name, buffer, size: buffer.length }) as Express.Multer.File;
  const pdf = Buffer.from('%PDF-1.4 synthetic');
  let jpeg: Buffer;

  beforeAll(async () => {
    jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
  });
  beforeEach(() => {
    process.env = { ...env };
    delete process.env.GEMINI_API_KEY;
    delete process.env.CATALOG_IMPORT_OCR_PROVIDER;
    delete process.env.LOCAL_VISION_URL;
    fetchSpy = jest.spyOn(global, 'fetch');
    subject = new ServiceCatalogImportService(prisma as never, access as never);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...env };
  });

  it('keeps the historical default: Gemini when a key exists, otherwise nothing', () => {
    expect(catalogOcrProvider({})).toBeNull();
    expect(catalogOcrProvider({ GEMINI_API_KEY: 'k' })).toBe('gemini');
    expect(
      catalogOcrProvider({ GEMINI_API_KEY: 'k', CATALOG_IMPORT_OCR_PROVIDER: 'none' }),
    ).toBeNull();
  });

  it('selects local only with a private LOCAL_VISION_URL and never falls back to Gemini', () => {
    expect(
      catalogOcrProvider({ CATALOG_IMPORT_OCR_PROVIDER: 'local', GEMINI_API_KEY: 'k' }),
    ).toBeNull();
    expect(
      catalogOcrProvider({
        CATALOG_IMPORT_OCR_PROVIDER: 'local',
        LOCAL_VISION_URL: 'https://api.openai.com',
      }),
    ).toBeNull();
    expect(
      catalogOcrProvider({
        CATALOG_IMPORT_OCR_PROVIDER: 'LOCAL',
        LOCAL_VISION_URL: 'http://ollama.railway.internal:11434',
      }),
    ).toBe('local');
    expect(catalogOcrProvider({ CATALOG_IMPORT_OCR_PROVIDER: 'openai' })).toBeNull();
  });

  it('reports the provider identity and PDF support, never credentials', async () => {
    process.env.CATALOG_IMPORT_OCR_PROVIDER = 'local';
    process.env.LOCAL_VISION_URL = 'http://ollama.railway.internal:11434';
    await expect(subject.capabilities('actor', 'salon')).resolves.toEqual({
      pdfPhotoOcrAvailable: true,
      ocrProvider: 'local',
      ocrPdfSupported: false,
    });
  });

  it('names the provider actually used in the consent error', async () => {
    process.env.CATALOG_IMPORT_OCR_PROVIDER = 'local';
    process.env.LOCAL_VISION_URL = 'http://localhost:11434';
    await expect(
      subject.preview('actor', 'salon', file('menu.jpg', jpeg), false),
    ).rejects.toThrow(/FastQue's self-hosted AI model/);
    process.env.CATALOG_IMPORT_OCR_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'synthetic-key-not-real';
    await expect(
      subject.preview('actor', 'salon', file('menu.jpg', jpeg), false),
    ).rejects.toThrow(/Google Gemini/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when nothing is configured', async () => {
    await expect(
      subject.preview('actor', 'salon', file('menu.jpg', jpeg), true),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('refuses PDFs on the local provider without sending anything', async () => {
    process.env.CATALOG_IMPORT_OCR_PROVIDER = 'local';
    process.env.LOCAL_VISION_URL = 'http://localhost:11434';
    await expect(
      subject.preview('actor', 'salon', file('menu.pdf', pdf), true),
    ).rejects.toMatchObject({ status: 415 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads a photo through the self-hosted model and validates its rows', async () => {
    process.env.CATALOG_IMPORT_OCR_PROVIDER = 'local';
    process.env.LOCAL_VISION_URL = 'http://ollama.railway.internal:11434';
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  services: [
                    { name: 'Haircut', price: 150, durationMinutes: null },
                    { name: '', price: 10 },
                  ],
                }),
              },
            },
          ],
        }),
    } as unknown as Response);
    const preview = await subject.preview(
      'actor',
      'salon',
      file('menu.jpg', jpeg),
      true,
    );
    expect(preview.services).toEqual([
      expect.objectContaining({ name: 'Haircut', price: 150, durationMinutes: null }),
    ]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ollama.railway.internal:11434/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.messages[0].content[1].image_url?.url).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('maps an unreachable local model to 502 and garbage output to 400', async () => {
    process.env.CATALOG_IMPORT_OCR_PROVIDER = 'local';
    process.env.LOCAL_VISION_URL = 'http://localhost:11434';
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      subject.preview('actor', 'salon', file('menu.jpg', jpeg), true),
    ).rejects.toMatchObject({ status: 502 });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'sorry' } }] }),
    } as unknown as Response);
    await expect(
      subject.preview('actor', 'salon', file('menu.jpg', jpeg), true),
    ).rejects.toMatchObject({ status: 400 });
  });
});
