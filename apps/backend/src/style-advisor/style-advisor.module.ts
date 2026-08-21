import { Module } from '@nestjs/common';
import { PremiumModule } from '../premium/premium.module';
import { StyleAdvisorController } from './style-advisor.controller';
import { StyleAdvisorService } from './style-advisor.service';
import { AI_IMAGE_PROVIDER } from './ai-image-provider';
import { UnconfiguredAiImageProvider } from './unconfigured-ai-image-provider';
import { GeminiAiImageProvider } from './gemini-ai-image-provider';

@Module({
  // Premium phase: StyleAdvisorService depends on AiCreditService to gate generation behind an
  // active subscription + available credit — see that service's own docs for why.
  imports: [PremiumModule],
  controllers: [StyleAdvisorController],
  providers: [
    StyleAdvisorService,
    UnconfiguredAiImageProvider,
    // Same provider-swap shape as AuthModule's OTP_SENDER factory — one token, one place that
    // decides the concrete implementation.
    //
    // Gemini 2.5 Flash Image has NO free tier (confirmed both officially — ai.google.dev/gemini-api
    // /docs/pricing lists "Free Tier: Not available" for this model — and empirically, via an
    // immediate HTTP 429 on a real key with zero prior usage). Research into hosted "free" hairstyle
    // /virtual-try-on APIs (LightX, api.market Hair Changer, roboMUA) found none that unambiguously
    // satisfy this project's requirements without either a one-time-only trial grant, an undocumented
    // photo-retention policy, or requiring the operator to personally create a third-party account
    // (which this codebase cannot do on your behalf) — see ARCHITECTURE.md §19 for the full writeup.
    // Self-hosting an identity-preserving diffusion model (e.g. HairFastGAN) was also researched and
    // judged impractical on a GPU-less 16GB Windows dev machine. No new provider was implemented as a
    // result — per the explicit instruction, an honest "temporarily unavailable" feature beats a fake
    // or unverified one.
    //
    // GEMINI_API_KEY presence is therefore deliberately NOT sufficient to auto-select Gemini — a stray
    // leftover key must never trigger a real (paid) call. Activating it later requires BOTH env vars
    // set intentionally: GEMINI_API_KEY (the credential) and AI_IMAGE_PROVIDER=gemini (the explicit,
    // reversible opt-in). Any other/absent value keeps the safe UnconfiguredAiImageProvider default.
    {
      provide: AI_IMAGE_PROVIDER,
      useFactory: (unconfigured: UnconfiguredAiImageProvider) => {
        if (process.env.AI_IMAGE_PROVIDER !== 'gemini') {
          return unconfigured;
        }
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error(
            'AI_IMAGE_PROVIDER=gemini requires GEMINI_API_KEY to also be set.',
          );
        }
        return new GeminiAiImageProvider(apiKey);
      },
      inject: [UnconfiguredAiImageProvider],
    },
  ],
})
export class StyleAdvisorModule {}
