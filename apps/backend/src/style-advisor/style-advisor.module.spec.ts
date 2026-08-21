import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StyleAdvisorModule } from './style-advisor.module';
import { AI_IMAGE_PROVIDER } from './ai-image-provider';
import { UnconfiguredAiImageProvider } from './unconfigured-ai-image-provider';
import { GeminiAiImageProvider } from './gemini-ai-image-provider';
import { PrismaService } from '../prisma/prisma.service';

// StyleAdvisorModule now imports PremiumModule (for AiCreditService's credit gate), whose
// services depend on PrismaService. A stub, NOT the real PrismaModule, is provided here — the
// real @prisma/client reloads apps/backend/.env into process.env on every instantiation
// (documented Prisma behavior), which would silently restore this suite's deliberately-deleted
// GEMINI_API_KEY mid-compile and defeat exactly the env-var manipulation these tests rely on.
// None of these tests ever call a Prisma method, so a stub is both safer and more correct here.
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class StubPrismaModule {}

// Mocked so this suite never constructs a real @google/genai client or makes a network call.
jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai');
  return {
    ...actual,
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: { generateContent: jest.fn() },
    })),
  };
});

describe('StyleAdvisorModule AI_IMAGE_PROVIDER factory (cost-safety gate)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to UnconfiguredAiImageProvider with no env vars set', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_IMAGE_PROVIDER;

    const moduleRef = await Test.createTestingModule({
      imports: [StyleAdvisorModule, StubPrismaModule],
    }).compile();

    expect(moduleRef.get(AI_IMAGE_PROVIDER)).toBeInstanceOf(UnconfiguredAiImageProvider);
  });

  it('does NOT auto-select Gemini merely because GEMINI_API_KEY is set (no AI_IMAGE_PROVIDER opt-in)', async () => {
    process.env.GEMINI_API_KEY = 'a-real-looking-key';
    delete process.env.AI_IMAGE_PROVIDER;

    const moduleRef = await Test.createTestingModule({
      imports: [StyleAdvisorModule, StubPrismaModule],
    }).compile();

    expect(moduleRef.get(AI_IMAGE_PROVIDER)).toBeInstanceOf(UnconfiguredAiImageProvider);
  });

  it('ignores AI_IMAGE_PROVIDER=gemini if GEMINI_API_KEY is missing, and stays safe rather than crash-selecting Gemini', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.AI_IMAGE_PROVIDER = 'gemini';

    await expect(
      Test.createTestingModule({ imports: [StyleAdvisorModule, StubPrismaModule] }).compile(),
    ).rejects.toThrow('AI_IMAGE_PROVIDER=gemini requires GEMINI_API_KEY to also be set.');
  });

  it('only selects GeminiAiImageProvider when BOTH GEMINI_API_KEY and AI_IMAGE_PROVIDER=gemini are set', async () => {
    process.env.GEMINI_API_KEY = 'a-real-looking-key';
    process.env.AI_IMAGE_PROVIDER = 'gemini';

    const moduleRef = await Test.createTestingModule({
      imports: [StyleAdvisorModule, StubPrismaModule],
    }).compile();

    expect(moduleRef.get(AI_IMAGE_PROVIDER)).toBeInstanceOf(GeminiAiImageProvider);
  });
});
