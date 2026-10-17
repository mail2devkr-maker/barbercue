import {
  acceptExistingOwnerInvitationSchema,
  acceptOwnerInvitationSchema,
  ownerAccessMutationSchema,
  ownerAccessPreviewSchema,
} from "../schemas";

const token = "a".repeat(64);

describe("shop owner access request contracts", () => {
  it("normalizes the proposed owner email", () => {
    expect(
      ownerAccessPreviewSchema.parse({ email: " Owner@Example.COM " }).email,
    ).toBe("owner@example.com");
  });

  it("requires an exact owner snapshot, reason, confirmation and six-digit TOTP", () => {
    const valid = {
      email: "owner@example.com",
      expectedOwnerUserId: "c087f8ed-e965-4f75-9ed4-60ba34478724",
      reason: "Verified ownership transfer request",
      transferConfirmed: true,
      totpCode: "123456",
    };
    expect(ownerAccessMutationSchema.safeParse(valid).success).toBe(true);
    expect(
      ownerAccessMutationSchema.safeParse({
        ...valid,
        expectedOwnerUserId: "other",
      }).success,
    ).toBe(false);
    expect(
      ownerAccessMutationSchema.safeParse({ ...valid, reason: "short" })
        .success,
    ).toBe(false);
    expect(
      ownerAccessMutationSchema.safeParse({ ...valid, totpCode: "12345" })
        .success,
    ).toBe(false);
    expect(
      ownerAccessMutationSchema.safeParse({
        ...valid,
        transferConfirmed: undefined,
      }).success,
    ).toBe(false);
  });

  it("requires a single-use token and matching password for new accounts", () => {
    expect(
      acceptOwnerInvitationSchema.safeParse({
        token,
        password: "StrongPass123!",
        confirmPassword: "StrongPass123!",
      }).success,
    ).toBe(true);
    expect(
      acceptOwnerInvitationSchema.safeParse({
        token,
        password: "StrongPass123!",
        confirmPassword: "DifferentPass123!",
      }).success,
    ).toBe(false);
    expect(
      acceptOwnerInvitationSchema.safeParse({
        token: "short",
        password: "StrongPass123!",
        confirmPassword: "StrongPass123!",
      }).success,
    ).toBe(false);
  });

  it("does not let an existing-account acceptance carry an arbitrary user identity", () => {
    expect(
      acceptExistingOwnerInvitationSchema.safeParse({ token }).success,
    ).toBe(true);
    expect(
      acceptExistingOwnerInvitationSchema.safeParse({
        token,
        userId: "forged-user",
      }).success,
    ).toBe(true);
    expect(
      "userId" in
        acceptExistingOwnerInvitationSchema.parse({
          token,
          userId: "forged-user",
        }),
    ).toBe(false);
  });
});
