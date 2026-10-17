import {
  InvoiceMathError,
  InvoicePaymentStatus,
  InvoiceTaxMode,
  billingProfileSchema,
  bulkDeactivateSalonChairsApplySchema,
  bulkDeactivateSalonChairsPreviewSchema,
  cancellationAnalyticsQuerySchema,
  computeInvoiceTotals,
  createInShopBookingSchema,
  createInvoiceSchema,
  createQueueCustomerSchema,
  deriveInvoicePaymentStatus,
  formatInvoiceNumber,
  recordInvoicePaymentSchema,
  shopCancelBookingSchema,
  voidInvoiceSchema,
  pushCopyFor,
  Language,
} from "../index";

const SERVICE = "22222222-2222-2222-2222-222222222222";

describe("computeInvoiceTotals", () => {
  const noTax = {
    enabled: false,
    rateBps: null,
    mode: InvoiceTaxMode.EXCLUSIVE,
  };

  it("sums lines with no tax when tax is not configured", () => {
    const totals = computeInvoiceTotals(
      [
        {
          description: "Haircut",
          unitPricePaise: 15000,
          quantity: 1,
          discountPaise: 0,
        },
        {
          description: "Beard trim",
          unitPricePaise: 8000,
          quantity: 2,
          discountPaise: 1000,
        },
      ],
      noTax,
    );
    expect(totals.subtotalPaise).toBe(31000);
    expect(totals.discountTotalPaise).toBe(1000);
    expect(totals.taxTotalPaise).toBe(0);
    expect(totals.totalPaise).toBe(30000);
    expect(totals.lines.map((l) => l.lineTotalPaise)).toEqual([15000, 15000]);
  });

  it("adds exclusive tax on the discounted net, rounding half up in paise", () => {
    const totals = computeInvoiceTotals(
      [
        {
          description: "Haircut",
          unitPricePaise: 15050,
          quantity: 1,
          discountPaise: 50,
        },
      ],
      { enabled: true, rateBps: 1800, mode: InvoiceTaxMode.EXCLUSIVE },
    );
    // net 15000 -> 18% = 2700 exactly
    expect(totals.taxTotalPaise).toBe(2700);
    expect(totals.totalPaise).toBe(17700);
  });

  it("rounds a fractional-paise tax half up (never via floating point)", () => {
    // 12345 * 5.00% = 617.25 -> 617 ; 12350 * 5% = 617.5 -> 618
    const a = computeInvoiceTotals(
      [
        {
          description: "x",
          unitPricePaise: 12345,
          quantity: 1,
          discountPaise: 0,
        },
      ],
      {
        enabled: true,
        rateBps: 500,
        mode: InvoiceTaxMode.EXCLUSIVE,
      },
    );
    const b = computeInvoiceTotals(
      [
        {
          description: "x",
          unitPricePaise: 12350,
          quantity: 1,
          discountPaise: 0,
        },
      ],
      {
        enabled: true,
        rateBps: 500,
        mode: InvoiceTaxMode.EXCLUSIVE,
      },
    );
    expect(a.taxTotalPaise).toBe(617);
    expect(b.taxTotalPaise).toBe(618);
  });

  it("extracts the tax component from an inclusive price without changing the total", () => {
    const totals = computeInvoiceTotals(
      [
        {
          description: "Haircut",
          unitPricePaise: 11800,
          quantity: 1,
          discountPaise: 0,
        },
      ],
      { enabled: true, rateBps: 1800, mode: InvoiceTaxMode.INCLUSIVE },
    );
    expect(totals.totalPaise).toBe(11800);
    expect(totals.taxTotalPaise).toBe(1800); // 11800 * 18/118
  });

  it("refuses to guess a rate: enabled tax without a valid rate throws", () => {
    expect(() =>
      computeInvoiceTotals(
        [
          {
            description: "x",
            unitPricePaise: 100,
            quantity: 1,
            discountPaise: 0,
          },
        ],
        {
          enabled: true,
          rateBps: null,
          mode: InvoiceTaxMode.EXCLUSIVE,
        },
      ),
    ).toThrow(InvoiceMathError);
  });

  it("rejects empty invoices, fractional paise, zero quantity and over-discounting", () => {
    expect(() => computeInvoiceTotals([], noTax)).toThrow(InvoiceMathError);
    expect(() =>
      computeInvoiceTotals(
        [
          {
            description: "x",
            unitPricePaise: 10.5,
            quantity: 1,
            discountPaise: 0,
          },
        ],
        noTax,
      ),
    ).toThrow(InvoiceMathError);
    expect(() =>
      computeInvoiceTotals(
        [
          {
            description: "x",
            unitPricePaise: 100,
            quantity: 0,
            discountPaise: 0,
          },
        ],
        noTax,
      ),
    ).toThrow(InvoiceMathError);
    expect(() =>
      computeInvoiceTotals(
        [
          {
            description: "x",
            unitPricePaise: 100,
            quantity: 1,
            discountPaise: 101,
          },
        ],
        noTax,
      ),
    ).toThrow(InvoiceMathError);
  });
});

describe("deriveInvoicePaymentStatus", () => {
  const base = { voided: false, totalPaise: 10000 };
  it("is UNPAID until the shop records a payment (a displayed QR is not payment)", () => {
    expect(
      deriveInvoicePaymentStatus({ ...base, paidPaise: 0, refundedPaise: 0 }),
    ).toBe(InvoicePaymentStatus.UNPAID);
  });
  it("is PARTIALLY_PAID, PAID, REFUNDED and VOID correctly", () => {
    expect(
      deriveInvoicePaymentStatus({
        ...base,
        paidPaise: 4000,
        refundedPaise: 0,
      }),
    ).toBe(InvoicePaymentStatus.PARTIALLY_PAID);
    expect(
      deriveInvoicePaymentStatus({
        ...base,
        paidPaise: 10000,
        refundedPaise: 0,
      }),
    ).toBe(InvoicePaymentStatus.PAID);
    expect(
      deriveInvoicePaymentStatus({
        ...base,
        paidPaise: 10000,
        refundedPaise: 10000,
      }),
    ).toBe(InvoicePaymentStatus.REFUNDED);
    expect(
      deriveInvoicePaymentStatus({
        ...base,
        paidPaise: 10000,
        refundedPaise: 2000,
      }),
    ).toBe(InvoicePaymentStatus.PARTIALLY_PAID);
    expect(
      deriveInvoicePaymentStatus({
        ...base,
        voided: true,
        paidPaise: 0,
        refundedPaise: 0,
      }),
    ).toBe(InvoicePaymentStatus.VOID);
  });
});

describe("formatInvoiceNumber", () => {
  it("zero-pads the per-salon sequence", () => {
    expect(formatInvoiceNumber("FQ", 7)).toBe("FQ-000007");
    expect(formatInvoiceNumber("INV", 123456)).toBe("INV-123456");
  });
});

describe("createInShopBookingSchema", () => {
  const valid = {
    guestName: "Ravi Kumar",
    serviceIds: [SERVICE],
    slotStart: "2026-10-20T10:00:00.000Z",
  };
  it("accepts a named guest with no phone and normalizes nothing it was not given", () => {
    const parsed = createInShopBookingSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.guestPhone).toBeUndefined();
  });
  it("requires explicit consent before a phone number may be stored", () => {
    expect(
      createInShopBookingSchema.safeParse({
        ...valid,
        guestPhone: "9876543210",
      }).success,
    ).toBe(false);
    const ok = createInShopBookingSchema.safeParse({
      ...valid,
      guestPhone: "9876543210",
      contactConsent: true,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.guestPhone).toBe("+919876543210");
  });
  it("rejects a missing name, no services and too many services", () => {
    expect(
      createInShopBookingSchema.safeParse({ ...valid, guestName: " " }).success,
    ).toBe(false);
    expect(
      createInShopBookingSchema.safeParse({ ...valid, serviceIds: [] }).success,
    ).toBe(false);
    expect(
      createInShopBookingSchema.safeParse({
        ...valid,
        serviceIds: Array(11).fill(SERVICE),
      }).success,
    ).toBe(false);
  });
});

describe("createQueueCustomerSchema", () => {
  it("needs only a name; a phone needs consent", () => {
    expect(createQueueCustomerSchema.safeParse({ name: "Amit" }).success).toBe(
      true,
    );
    expect(
      createQueueCustomerSchema.safeParse({ name: "Amit", phone: "9876543210" })
        .success,
    ).toBe(false);
    expect(
      createQueueCustomerSchema.safeParse({
        name: "Amit",
        phone: "9876543210",
        contactConsent: true,
      }).success,
    ).toBe(true);
  });
});

describe("shopCancelBookingSchema", () => {
  it("treats a blank reason as no reason and caps its length", () => {
    const blank = shopCancelBookingSchema.safeParse({ reason: "   " });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.reason).toBeUndefined();
    expect(
      shopCancelBookingSchema.safeParse({ reason: "x".repeat(301) }).success,
    ).toBe(false);
  });
});

describe("invoice request schemas", () => {
  it("requires exactly one invoice source", () => {
    expect(createInvoiceSchema.safeParse({}).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ bookingId: SERVICE }).success).toBe(
      true,
    );
    expect(
      createInvoiceSchema.safeParse({
        bookingId: SERVICE,
        queueEntryId: SERVICE,
      }).success,
    ).toBe(false);
  });
  it("accepts only a positive amount with at most 2 decimals", () => {
    const ok = recordInvoicePaymentSchema.safeParse({
      method: "CASH",
      amount: 150.5,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.kind).toBe("PAYMENT");
    expect(
      recordInvoicePaymentSchema.safeParse({ method: "CASH", amount: 0 })
        .success,
    ).toBe(false);
    expect(
      recordInvoicePaymentSchema.safeParse({ method: "CASH", amount: -5 })
        .success,
    ).toBe(false);
    expect(
      recordInvoicePaymentSchema.safeParse({ method: "CASH", amount: 10.005 })
        .success,
    ).toBe(false);
    expect(
      recordInvoicePaymentSchema.safeParse({ method: "BITCOIN", amount: 10 })
        .success,
    ).toBe(false);
  });
  it("requires a reason to void", () => {
    expect(voidInvoiceSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(
      voidInvoiceSchema.safeParse({ reason: "Entered the wrong service" })
        .success,
    ).toBe(true);
  });
});

describe("billingProfileSchema", () => {
  const base = { legalName: "Handsome Center", taxEnabled: false };
  it("does not invent tax: disabled tax needs no rate and defaults the prefix", () => {
    const parsed = billingProfileSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.invoicePrefix).toBe("INV");
      expect(parsed.data.taxMode).toBe("EXCLUSIVE");
    }
  });
  it("requires a rate when tax is enabled", () => {
    expect(
      billingProfileSchema.safeParse({ ...base, taxEnabled: true }).success,
    ).toBe(false);
    expect(
      billingProfileSchema.safeParse({
        ...base,
        taxEnabled: true,
        taxRatePercent: 18,
      }).success,
    ).toBe(true);
  });
  it("format-checks a GSTIN and rejects an obviously invalid one", () => {
    expect(
      billingProfileSchema.safeParse({ ...base, gstin: "22AAAAA0000A1Z5" })
        .success,
    ).toBe(true);
    expect(
      billingProfileSchema.safeParse({ ...base, gstin: "12345" }).success,
    ).toBe(false);
  });
});

describe("cancellationAnalyticsQuerySchema", () => {
  it("accepts the documented actor filters including UNKNOWN", () => {
    for (const actor of [
      "CUSTOMER",
      "OWNER",
      "STAFF",
      "SYSTEM",
      "ADMIN",
      "UNKNOWN",
    ]) {
      expect(
        cancellationAnalyticsQuerySchema.safeParse({ actor }).success,
      ).toBe(true);
    }
    expect(
      cancellationAnalyticsQuerySchema.safeParse({ actor: "BOT" }).success,
    ).toBe(false);
  });
});

describe("bulk chair deactivation contracts", () => {
  const chairA = "11111111-1111-4111-8111-111111111111";
  const chairB = "22222222-2222-4222-8222-222222222222";

  it("requires a bounded, unique set of salon chair IDs for preview", () => {
    expect(
      bulkDeactivateSalonChairsPreviewSchema.safeParse({ chairIds: [chairA] })
        .success,
    ).toBe(true);
    expect(
      bulkDeactivateSalonChairsPreviewSchema.safeParse({
        chairIds: [chairA, chairA],
      }).success,
    ).toBe(false);
    expect(
      bulkDeactivateSalonChairsPreviewSchema.safeParse({ chairIds: [] })
        .success,
    ).toBe(false);
    expect(
      bulkDeactivateSalonChairsPreviewSchema.safeParse({
        chairIds: Array(51).fill(chairA),
      }).success,
    ).toBe(false);
  });

  it("requires unique chair IDs and exact UTC update versions for apply", () => {
    const item = {
      chairId: chairA,
      expectedUpdatedAt: "2026-10-17T10:00:00.000Z",
    };
    expect(
      bulkDeactivateSalonChairsApplySchema.safeParse({ items: [item] }).success,
    ).toBe(true);
    expect(
      bulkDeactivateSalonChairsApplySchema.safeParse({ items: [item, item] })
        .success,
    ).toBe(false);
    expect(
      bulkDeactivateSalonChairsApplySchema.safeParse({
        items: [{ ...item, expectedUpdatedAt: "not-a-date" }],
      }).success,
    ).toBe(false);
    expect(
      bulkDeactivateSalonChairsApplySchema.safeParse({
        items: [{ ...item, chairId: chairB }],
      }).success,
    ).toBe(true);
  });
});

describe("customer cancellation push copy", () => {
  it("names the shop, service and time and says the SHOP cancelled it (English and Hindi)", () => {
    const en = pushCopyFor(Language.EN).shopCancelledBooking({
      shopName: "Handsome Center",
      serviceName: "Haircut",
      whenText: "15 Oct, 4:30 PM",
    });
    expect(en.body).toContain("Handsome Center");
    expect(en.body).toContain("Haircut");
    expect(en.body).toContain("15 Oct, 4:30 PM");
    expect(en.body).toContain("cancelled by the shop");
    const hi = pushCopyFor(Language.HI).shopCancelledBooking({
      shopName: "Handsome Center",
      serviceName: null,
      whenText: null,
    });
    expect(hi.body).toContain("Handsome Center");
    expect(hi.body).not.toContain("null");
  });
});
