import {
  DEMO_DELETE_CONFIRMATION,
  deleteDemoWorkspaceSchema,
  demoWorkspaceIdempotencyKeySchema,
} from "../demo-workspace";

describe("demo workspace request contracts", () => {
  it("accepts only UUID idempotency keys", () => {
    expect(
      demoWorkspaceIdempotencyKeySchema.safeParse(
        "a82e6064-3272-4eae-9e9a-94a6498290cd",
      ).success,
    ).toBe(true);
    expect(
      demoWorkspaceIdempotencyKeySchema.safeParse("retry-key").success,
    ).toBe(false);
  });

  it("requires workspace identity, exact confirmation phrase, and a signed preview token", () => {
    expect(
      deleteDemoWorkspaceSchema.safeParse({
        workspaceId: "a82e6064-3272-4eae-9e9a-94a6498290cd",
        confirmation: DEMO_DELETE_CONFIRMATION,
        confirmationToken: "x".repeat(32),
      }).success,
    ).toBe(true);
  });

  it("rejects unknown properties and wrong confirmation text", () => {
    const base = {
      workspaceId: "a82e6064-3272-4eae-9e9a-94a6498290cd",
      confirmation: DEMO_DELETE_CONFIRMATION,
      confirmationToken: "x".repeat(32),
    };
    expect(
      deleteDemoWorkspaceSchema.safeParse({
        ...base,
        salonId: "attacker-input",
      }).success,
    ).toBe(false);
    expect(
      deleteDemoWorkspaceSchema.safeParse({ ...base, confirmation: "DELETE" })
        .success,
    ).toBe(false);
  });

  it("rejects malformed workspace IDs and short tokens", () => {
    expect(
      deleteDemoWorkspaceSchema.safeParse({
        workspaceId: "not-a-uuid",
        confirmation: DEMO_DELETE_CONFIRMATION,
        confirmationToken: "short",
      }).success,
    ).toBe(false);
  });
});
