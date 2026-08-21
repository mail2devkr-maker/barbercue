import { UnconfiguredAiImageProvider } from './unconfigured-ai-image-provider';

describe('UnconfiguredAiImageProvider', () => {
  it('always throws AI_PROVIDER_NOT_CONFIGURED, never a fabricated result', () => {
    const provider = new UnconfiguredAiImageProvider();
    expect(() => provider.generate()).toThrow(
      expect.objectContaining({ code: 'AI_PROVIDER_NOT_CONFIGURED' }),
    );
  });
});
