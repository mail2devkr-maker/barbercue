import {
  parseVoiceOnboardingTranscript,
  updateEmployeeVoiceVisitLogSchema,
  voiceOnboardingDraftSchema,
} from "./index";

describe("employee voice onboarding parser", () => {
  it("extracts the field-visit example without inventing values", () => {
    const draft = parseVoiceOnboardingTranscript(
      "Shri Ganesh Salon Hajipur. Owner Rahul Kumar. Mobile 9876543210. Char chairs hain. Paanch staff hain. Haircut 100 rupees. Beard 60. Head massage 150. Facial 500.",
    );
    expect(draft).toMatchObject({
      shopName: "Shri Ganesh Salon Hajipur",
      ownerName: "Rahul Kumar",
      mobile: "9876543210",
      chairs: 4,
      staffCount: 5,
      services: [
        { name: "Haircut", priceRupees: 100 },
        { name: "Beard", priceRupees: 60 },
        { name: "Head massage", priceRupees: 150 },
        { name: "Facial", priceRupees: 500 },
      ],
    });
  });

  it("understands Hindi digits and common Hindi number words", () => {
    const draft = parseVoiceOnboardingTranscript(
      "राम सैलून। मालिक राहुल। मोबाइल ९८७६५४३२१०। चार कुर्सी हैं। पाँच स्टाफ हैं। कटिंग ₹१००।",
    );
    expect(draft.mobile).toBe("9876543210");
    expect(draft.chairs).toBe(4);
    expect(draft.staffCount).toBe(5);
    expect(draft.services).toEqual([{ name: "कटिंग", priceRupees: 100 }]);
  });

  it("does not invent a missing service price and keeps unclassified detail as notes", () => {
    const draft = parseVoiceOnboardingTranscript(
      "Ganesh Salon. Services: Hair spa. Special note: owner wants a callback.",
    );
    expect(draft.services).toEqual([{ name: "Hair spa", priceRupees: null }]);
    expect(draft.notes).toContain("Special note: owner wants a callback");
  });

  it("enforces bounded editable draft fields", () => {
    expect(() =>
      voiceOnboardingDraftSchema.parse({
        shopName: "Shop",
        ownerName: null,
        mobile: null,
        address: null,
        city: null,
        locality: null,
        chairs: 1000,
        staffCount: null,
        services: [],
        notes: null,
      }),
    ).toThrow();
  });

  it("requires explicit review acknowledgement before a draft can be confirmed", () => {
    const confirmation = {
      transcript: "Salon. Haircut 100.",
      language: "en-IN",
      structuredDraft: parseVoiceOnboardingTranscript("Salon. Haircut 100."),
      status: "CONFIRMED",
    };
    expect(
      updateEmployeeVoiceVisitLogSchema.safeParse(confirmation).success,
    ).toBe(false);
    expect(
      updateEmployeeVoiceVisitLogSchema.safeParse({
        ...confirmation,
        reviewAcknowledged: true,
      }).success,
    ).toBe(true);
  });
});
