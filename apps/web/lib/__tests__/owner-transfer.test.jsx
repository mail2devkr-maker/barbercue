import { emailProblem, evidenceProblem, isExpired, isOpen, nextStep, verifyProblem } from "../owner-transfer";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const t = (over = {}) => ({
  id: "t1", salonId: "s1", newEmail: "owner@example.test", status: "PREPARED", preparedByAdminId: "a1", verifiedByAdminId: null,
  verificationEvidence: [], verifiedAt: null, inviteNotBefore: null, invitationExpiresAt: null, invitationCount: 0, breakGlass: false,
  preparedAt: "2026-10-27T10:00:00.000Z", completedAt: null, ...over,
});

describe("owner transfer screen rules", () => {
  describe("evidenceProblem (mirrors the server and the database)", () => {
    it.each([
      [["REGISTERED_PHONE_CALLBACK"], "identity"],
      [["REGISTERED_PHONE_CALLBACK", "BUSINESS_OR_SHOP_PROOF"], "identity"],
      [["GOVERNMENT_ID", "REGISTERED_PHONE_CALLBACK"], "authority"],
      [["IN_PERSON_VISIT"], "authority"],
      [["BUSINESS_OR_SHOP_PROOF", "CURRENT_OWNER_WRITTEN_CONSENT"], "identity"],
    ])("%j is not enough (%s missing)", (evidence, missing) => {
      expect(evidenceProblem(evidence)).toContain(missing === "identity" ? "identity check" : "proof of authority");
    });
    it.each([
      [["GOVERNMENT_ID", "BUSINESS_OR_SHOP_PROOF"]],
      [["IN_PERSON_VISIT", "CURRENT_OWNER_WRITTEN_CONSENT"]],
      [["GOVERNMENT_ID", "CURRENT_OWNER_WRITTEN_CONSENT", "REGISTERED_PHONE_CALLBACK"]],
    ])("%j is enough", (evidence) => expect(evidenceProblem(evidence)).toBeNull());
  });

  it("emailProblem needs a valid address typed twice", () => {
    expect(emailProblem("nope", "nope")).toContain("valid e-mail");
    expect(emailProblem("a@b.test", "c@b.test")).toContain("do not match");
    expect(emailProblem(" A@B.test ", "a@b.TEST")).toBeNull();
  });

  it("verifyProblem asks for a real description, and a break-glass justification only when needed", () => {
    const ok = { evidence: ["GOVERNMENT_ID", "BUSINESS_OR_SHOP_PROOF"], reference: "x".repeat(20), breakGlassJustification: "", needsBreakGlass: false };
    expect(verifyProblem(ok)).toBeNull();
    expect(verifyProblem({ ...ok, reference: "short" })).toContain("at least 20");
    expect(verifyProblem({ ...ok, needsBreakGlass: true })).toContain("justification");
    expect(verifyProblem({ ...ok, needsBreakGlass: true, breakGlassJustification: "j".repeat(50) })).toBeNull();
    expect(verifyProblem({ ...ok, evidence: ["REGISTERED_PHONE_CALLBACK"] })).toContain("identity check");
  });

  describe("nextStep distinguishes every state", () => {
    it("prepared -> verify, verified -> invite (or wait during the break-glass cool-down)", () => {
      expect(nextStep(t(), NOW).kind).toBe("verify");
      expect(nextStep(t({ status: "VERIFIED" }), NOW).kind).toBe("invite");
      const cooling = nextStep(t({ status: "VERIFIED", breakGlass: true, inviteNotBefore: "2026-10-28T12:00:00.000Z" }), NOW);
      expect(cooling.kind).toBe("wait");
      expect(cooling.note).toContain("cool-down");
    });
    it("invited: live link -> wait, expired -> resend, expired after 3 -> none", () => {
      const live = nextStep(t({ status: "INVITED", invitationExpiresAt: "2026-10-28T00:00:00.000Z", invitationCount: 1 }), NOW);
      expect(live.kind).toBe("wait");
      expect(live.note).toContain("Nothing has moved");
      expect(nextStep(t({ status: "INVITED", invitationExpiresAt: "2026-10-27T00:00:00.000Z", invitationCount: 1 }), NOW).kind).toBe("reinvite");
      expect(nextStep(t({ status: "INVITED", invitationExpiresAt: "2026-10-27T00:00:00.000Z", invitationCount: 3 }), NOW).kind).toBe("none");
    });
    it("finished transfers offer nothing", () => {
      expect(nextStep(t({ status: "COMPLETED" }), NOW).kind).toBe("none");
      expect(nextStep(t({ status: "CANCELLED" }), NOW).kind).toBe("none");
      expect(isOpen(t({ status: "COMPLETED" }))).toBe(false);
      expect(isOpen(t({ status: "INVITED" }))).toBe(true);
    });
  });

  it("isExpired treats a missing or unreadable time as expired", () => {
    expect(isExpired(null, NOW)).toBe(true);
    expect(isExpired("garbage", NOW)).toBe(true);
    expect(isExpired("2026-10-27T12:00:01.000Z", NOW)).toBe(false);
  });
});
