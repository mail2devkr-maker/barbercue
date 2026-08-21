import { Test } from '@nestjs/testing';
import { StyleAdvisorService } from './style-advisor.service';
import { AI_IMAGE_PROVIDER } from './ai-image-provider';
import { AiCreditService } from '../premium/ai-credit.service';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from('fake-image-bytes'),
    mimetype: 'image/jpeg',
    size: 1024,
    ...overrides,
  } as Express.Multer.File;
}

describe('StyleAdvisorService', () => {
  let service: StyleAdvisorService;
  let provider: { generate: jest.Mock };
  let aiCredits: { reserveCredit: jest.Mock; consumeCredit: jest.Mock; releaseCredit: jest.Mock };

  beforeEach(async () => {
    provider = { generate: jest.fn() };
    aiCredits = {
      reserveCredit: jest.fn().mockResolvedValue('sub-1'),
      consumeCredit: jest.fn().mockResolvedValue(undefined),
      releaseCredit: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        StyleAdvisorService,
        { provide: AI_IMAGE_PROVIDER, useValue: provider },
        { provide: AiCreditService, useValue: aiCredits },
      ],
    }).compile();
    service = moduleRef.get(StyleAdvisorService);
  });

  it('throws IMAGE_REQUIRED when no file is uploaded', async () => {
    await expect(service.generate('u1', undefined)).rejects.toMatchObject({
      code: 'IMAGE_REQUIRED',
    });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(aiCredits.reserveCredit).not.toHaveBeenCalled();
  });

  it('throws INVALID_IMAGE for an unsupported mime type', async () => {
    await expect(
      service.generate('u1', makeFile({ mimetype: 'application/pdf' })),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(aiCredits.reserveCredit).not.toHaveBeenCalled();
  });

  it('throws INVALID_IMAGE for a file over the size limit', async () => {
    await expect(
      service.generate('u1', makeFile({ size: 6 * 1024 * 1024 })),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(aiCredits.reserveCredit).not.toHaveBeenCalled();
  });

  it('propagates PREMIUM_REQUIRED / AI_CREDITS_EXHAUSTED from reserveCredit without ever calling the provider', async () => {
    aiCredits.reserveCredit.mockRejectedValue(
      Object.assign(new Error('no premium'), { code: 'PREMIUM_REQUIRED' }),
    );
    await expect(service.generate('u1', makeFile())).rejects.toMatchObject({ code: 'PREMIUM_REQUIRED' });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('reserves a credit, calls the provider, and consumes the credit on success', async () => {
    const results = [
      { styleId: 'fade', styleName: 'Fade', previewUrl: 'https://example.com/a.jpg', matchPercent: 82 },
    ];
    provider.generate.mockResolvedValue(results);

    const file = makeFile();
    const result = await service.generate('u1', file);

    expect(aiCredits.reserveCredit).toHaveBeenCalledWith('u1');
    expect(provider.generate).toHaveBeenCalledWith(file.buffer, file.mimetype);
    expect(aiCredits.consumeCredit).toHaveBeenCalledWith('sub-1');
    expect(aiCredits.releaseCredit).not.toHaveBeenCalled();
    expect(result).toEqual(results);
  });

  it('releases the reserved credit (not consumes it) when the provider call fails', async () => {
    provider.generate.mockRejectedValue(new Error('provider exploded'));

    await expect(service.generate('u1', makeFile())).rejects.toThrow('provider exploded');

    expect(aiCredits.releaseCredit).toHaveBeenCalledWith('sub-1');
    expect(aiCredits.consumeCredit).not.toHaveBeenCalled();
  });
});
