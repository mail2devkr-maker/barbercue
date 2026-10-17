import { salonDescriptionSuggestionSchema } from '../schemas';

describe('salonDescriptionSuggestionSchema', () => {
  it('defaults to an English professional draft with no added claims', () => {
    expect(salonDescriptionSuggestionSchema.parse({})).toEqual({
      language: 'en',
      tone: 'professional',
      ownerAttestedHighlights: [],
    });
  });

  it('accepts bounded Hindi owner-attested highlights', () => {
    expect(
      salonDescriptionSuggestionSchema.safeParse({
        language: 'hi',
        tone: 'friendly',
        ownerAttestedHighlights: ['Family-friendly service'],
      }).success,
    ).toBe(true);
  });

  it('rejects unknown fields, too many highlights, and oversized claims', () => {
    expect(
      salonDescriptionSuggestionSchema.safeParse({ provider: 'gemini' })
        .success,
    ).toBe(false);
    expect(
      salonDescriptionSuggestionSchema.safeParse({
        ownerAttestedHighlights: Array(6).fill('fact'),
      }).success,
    ).toBe(false);
    expect(
      salonDescriptionSuggestionSchema.safeParse({
        ownerAttestedHighlights: ['x'.repeat(121)],
      }).success,
    ).toBe(false);
  });
});
