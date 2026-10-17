import {
  InventoryMovementKind,
  InventoryUnit,
  createInventoryMovementSchema,
  createInventoryProductSchema,
  inventoryProductListQuerySchema,
  inventoryLookupListQuerySchema,
} from "./inventory";

describe("inventory shared contract", () => {
  it("requires a cost for incoming stock and keeps amounts at currency precision", () => {
    expect(
      createInventoryMovementSchema.safeParse({
        kind: InventoryMovementKind.PURCHASE,
        quantity: 1,
      }).success,
    ).toBe(false);
    expect(
      createInventoryMovementSchema.safeParse({
        kind: InventoryMovementKind.PURCHASE,
        quantity: 1,
        unitCost: 2.25,
      }).success,
    ).toBe(true);
    expect(
      createInventoryMovementSchema.safeParse({
        kind: InventoryMovementKind.PURCHASE,
        quantity: 1,
        unitCost: 2.251,
      }).success,
    ).toBe(false);
  });

  it("requires a reason and direction for adjustments and forbids client-supplied stock balances", () => {
    expect(
      createInventoryMovementSchema.safeParse({
        kind: InventoryMovementKind.ADJUSTMENT,
        quantity: 1,
        adjustmentDirection: "DECREASE",
      }).success,
    ).toBe(false);
    expect(
      createInventoryMovementSchema.safeParse({
        kind: InventoryMovementKind.ADJUSTMENT,
        quantity: 1,
        adjustmentDirection: "DECREASE",
        reason: "Count correction",
      }).success,
    ).toBe(true);
    expect(
      createInventoryProductSchema.safeParse({
        name: "Shampoo",
        unit: InventoryUnit.EACH,
        stockOnHand: 50,
      }).success,
    ).toBe(false);
  });

  it("accepts quantity precision only to three decimals and validates bounded cursor filters", () => {
    expect(
      createInventoryMovementSchema.safeParse({
        kind: InventoryMovementKind.CONSUMPTION,
        quantity: 0.125,
      }).success,
    ).toBe(true);
    expect(
      createInventoryMovementSchema.safeParse({
        kind: InventoryMovementKind.CONSUMPTION,
        quantity: 0.0001,
      }).success,
    ).toBe(false);
    expect(
      inventoryProductListQuerySchema.parse({
        cursor: "opaque-cursor",
        limit: "50",
        lowStock: "true",
      }),
    ).toMatchObject({
      cursor: "opaque-cursor",
      limit: 50,
      lowStock: true,
    });
    expect(
      inventoryProductListQuerySchema.safeParse({ limit: "0" }).success,
    ).toBe(false);
    expect(
      inventoryProductListQuerySchema.safeParse({ limit: "101" }).success,
    ).toBe(false);
  });

  it("bounds lookup pagination and rejects offset-based query fields", () => {
    expect(inventoryLookupListQuerySchema.parse({ limit: "50" })).toMatchObject(
      {
        limit: 50,
      },
    );
    expect(
      inventoryLookupListQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(
      inventoryLookupListQuerySchema.safeParse({ limit: 10, offset: 20 })
        .success,
    ).toBe(false);
  });
});
