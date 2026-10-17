export type SalonDescriptionLanguage = 'en' | 'hi';
export type SalonDescriptionTone = 'professional' | 'friendly' | 'premium';

/** Only salon-owned public facts and explicitly owner-attested highlights may reach a provider. */
export interface SalonDescriptionPrompt {
  language: SalonDescriptionLanguage;
  tone: SalonDescriptionTone;
  salonName: string;
  cityName: string;
  currentDescription: string | null;
  activeServiceNames: string[];
  ownerAttestedHighlights: string[];
}

/** Approved implementations must honor abort, avoid prompt retention/logging, and cap output. */
export interface DescriptionSuggestionProvider {
  suggest(input: SalonDescriptionPrompt, signal: AbortSignal): Promise<string>;
}

export const DESCRIPTION_SUGGESTION_PROVIDER = Symbol(
  'DESCRIPTION_SUGGESTION_PROVIDER',
);
