import {
  WORK_ASSIGNMENT_TRANSITIONS,
  WORK_JOB_TRANSITIONS,
  ageOn,
  canTransitionWorkAssignment,
  canTransitionWorkJob,
  draftWorkJobFromText,
  evaluateWorkEligibility,
  quoteWorkJob,
  screenWorkJob,
  workAssignmentSourcesFor,
  workJobCapacityStatus,
  workJobUpsertSchema,
  workOrgUpsertSchema,
  workPlatformFee,
  type WorkAssignmentStatus,
  type WorkJobStatus,
} from "../work-marketplace";

describe("work marketplace state machines", () => {
  it("every transition target is itself a known state", () => {
    for (const [from, tos] of Object.entries(WORK_JOB_TRANSITIONS)) {
      for (const to of tos) expect(Object.keys(WORK_JOB_TRANSITIONS)).toContain(to);
      expect(tos).not.toContain(from);
    }
    for (const [from, tos] of Object.entries(WORK_ASSIGNMENT_TRANSITIONS)) {
      for (const to of tos) expect(Object.keys(WORK_ASSIGNMENT_TRANSITIONS)).toContain(to);
      expect(tos).not.toContain(from);
    }
  });

  it("terminal states have no exits", () => {
    for (const s of ["PAID", "WITHDRAWN", "CANCELLED", "CLOSED_UNPAID"] as WorkAssignmentStatus[]) {
      expect(WORK_ASSIGNMENT_TRANSITIONS[s]).toEqual([]);
    }
    for (const s of ["CLOSED", "REJECTED"] as WorkJobStatus[]) expect(WORK_JOB_TRANSITIONS[s]).toEqual([]);
  });

  it("a job cannot open without passing through funding", () => {
    expect(canTransitionWorkJob("DRAFT", "OPEN")).toBe(false);
    expect(canTransitionWorkJob("PENDING_VERIFICATION", "OPEN")).toBe(false);
    expect(canTransitionWorkJob("FUNDING_REQUIRED", "OPEN")).toBe(true);
  });

  it("money states are only reachable from reviewed or compensated work", () => {
    expect(canTransitionWorkAssignment("ACCEPTED", "PAID")).toBe(false);
    expect(canTransitionWorkAssignment("SUBMITTED", "PAID")).toBe(false);
    expect(canTransitionWorkAssignment("PAYABLE", "PAID")).toBe(true);
    expect(workAssignmentSourcesFor("PAID")).toEqual(["PAYABLE"]);
    expect(workAssignmentSourcesFor("PAYABLE").sort()).toEqual(["ACCEPTED", "CHECKED_IN", "DISPUTED", "SUBMITTED"]);
  });

  it("derives capacity status", () => {
    expect(workJobCapacityStatus(0, 5)).toBe("OPEN");
    expect(workJobCapacityStatus(3, 5)).toBe("PARTIALLY_FILLED");
    expect(workJobCapacityStatus(5, 5)).toBe("FILLED");
  });
});

describe("fees and quotes", () => {
  it.each([
    [50_000, 1_000, 5_000],
    [33_333, 1_000, 3_333],
    [33_335, 1_000, 3_334],
    [0, 1_000, 0],
    [50_000, 0, 0],
  ])("fee on %i paise at %i bps is %i", (amount, bps, fee) => {
    expect(workPlatformFee(amount, bps)).toBe(fee);
  });

  it("rejects bad inputs instead of guessing", () => {
    expect(() => workPlatformFee(-1, 1000)).toThrow();
    expect(() => workPlatformFee(10.5, 1000)).toThrow();
    expect(() => workPlatformFee(100, 9_999)).toThrow();
    expect(() => quoteWorkJob(0, 50_000, 1000)).toThrow();
  });

  it("quotes employer total as pay plus fee for every slot", () => {
    expect(quoteWorkJob(5, 50_000, 1_000)).toEqual({
      positions: 5,
      payPerWorkerPaise: 50_000,
      feeBps: 1_000,
      workerPayTotalPaise: 250_000,
      platformFeeTotalPaise: 25_000,
      employerTotalPaise: 275_000,
    });
  });
});

describe("eligibility", () => {
  const now = new Date("2026-11-20T04:00:00Z");
  const base = {
    now,
    job: { status: "OPEN" as WorkJobStatus, startsAt: new Date("2026-11-21T04:30:00Z"), applicationDeadline: null, minAge: 18, minVerificationLevel: 1, requiredSkills: ["hindi", "sales"] },
    worker: { dateOfBirth: new Date("2004-05-01"), verificationLevel: 1, skills: ["Sales", "hindi", "excel"], isOrgMember: false, suspended: false },
  };

  it("accepts an eligible worker", () => {
    expect(evaluateWorkEligibility(base)).toEqual({ eligible: true, reasons: [], missingSkills: [] });
  });

  it("explains every failed rule at once", () => {
    const r = evaluateWorkEligibility({
      ...base,
      job: { ...base.job, status: "FILLED", minVerificationLevel: 2, requiredSkills: ["telecalling"] },
      worker: { ...base.worker, dateOfBirth: new Date("2009-01-01"), isOrgMember: true },
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual(["JOB_NOT_ACCEPTING", "UNDER_MIN_AGE", "VERIFICATION_LEVEL", "MISSING_SKILLS", "OWN_ORGANIZATION"]);
    expect(r.missingSkills).toEqual(["telecalling"]);
  });

  it("never lets a job lower the minimum age below 18", () => {
    const r = evaluateWorkEligibility({ ...base, job: { ...base.job, minAge: 16 }, worker: { ...base.worker, dateOfBirth: new Date("2009-06-01") } });
    expect(r.reasons).toContain("UNDER_MIN_AGE");
  });

  it("closes at the deadline", () => {
    const r = evaluateWorkEligibility({ ...base, job: { ...base.job, applicationDeadline: new Date("2026-11-20T03:00:00Z") } });
    expect(r.reasons).toEqual(["DEADLINE_PASSED"]);
  });

  it("computes age on a birthday boundary", () => {
    expect(ageOn(new Date("2008-11-20"), new Date("2026-11-19T23:59:00Z"))).toBe(17);
    expect(ageOn(new Date("2008-11-20"), new Date("2026-11-20T00:00:00Z"))).toBe(18);
  });
});

describe("anti-scam screening", () => {
  it.each([
    "Pay a refundable security deposit of ₹500 before joining",
    "Registration fee ₹199 applies to all candidates",
    "Simple trading tasks, double your money every week",
    "Share your OTP and Aadhaar with our team lead",
    "Write 5 star reviews for our restaurant on Google",
    "Earn ₹2 lakh per month from home, guaranteed income",
    "Use your bank account to receive money for clients",
  ])("flags: %s", (description) => {
    expect(screenWorkJob({ title: "Work from home", description }).flagged).toBe(true);
  });

  it.each([
    "Visit salons in Greater Noida, explain the FastQue app and register interested shops with owner consent.",
    "Count stock on shelves and record the totals in the provided sheet. Bring your own phone.",
    "Help guests find their seats at a college fest. Food and water provided.",
  ])("passes ordinary work: %s", (description) => {
    expect(screenWorkJob({ title: "Field assignment", description })).toEqual({ flagged: false, flags: [] });
  });
});

describe("smart draft", () => {
  it("reads the spec's example without inventing anything", () => {
    const d = draftWorkJobFromText(
      "I need 10 students in Greater Noida tomorrow between 10 AM and 4 PM to visit salons, explain our app, obtain owner consent, register interested shops, and upload service details. Pay ₹500 per completed assignment.",
    );
    expect(d.fields.positions).toBe(10);
    expect(d.fields.city).toBe("Greater Noida");
    expect(d.fields.dateHint).toBe("tomorrow");
    expect(d.fields.startTime).toBe("10:00");
    expect(d.fields.endTime).toBe("16:00");
    expect(d.fields.payPerWorkerPaise).toBe(50_000);
    expect(d.fields.payType).toBe("PER_TASK");
    expect(d.fields.checklist?.map((c) => c.label)).toEqual([
      "Visit salons",
      "Explain our app",
      "Obtain owner consent",
      "Register interested shops",
      "Upload service details",
    ]);
    expect(d.missing).toEqual(["Exact address or service area", "Completion criteria", "Cancellation compensation"]);
  });

  it("reports missing pay instead of guessing", () => {
    const d = draftWorkJobFromText("Need 3 helpers in Pune for an event");
    expect(d.fields.payPerWorkerPaise).toBeUndefined();
    expect(d.missing).toContain("Guaranteed pay per worker");
    expect(d.missing).toContain("Start and end time");
  });
});

describe("request schemas", () => {
  const job = {
    categorySlug: "inventory-audits",
    title: "Weekend stock audit",
    description: "Count every item on the shelves of our Sector 18 store and record totals in the sheet provided.",
    locationType: "ON_SITE",
    addressLine: "Shop 4, Sector 18 Market, Noida",
    city: "Noida",
    positions: 1,
    startsAt: "2026-11-22T04:30:00.000Z",
    endsAt: "2026-11-22T10:30:00.000Z",
    payType: "FIXED",
    payPerWorkerPaise: 50_000,
    hiringMode: "INSTANT_ACCEPT",
    checklist: [{ id: "count", label: "Count every shelf", kind: "CONFIRM" }],
    completionCriteria: "All shelves counted and the sheet uploaded.",
    cancellationTerms: { employerCancelAfterArrivalPaise: 25_000 },
  };

  it("accepts a complete job and applies disclosed defaults", () => {
    const parsed = workJobUpsertSchema.parse(job);
    expect(parsed.minAge).toBe(18);
    expect(parsed.reviewWindowHours).toBe(72);
    expect(parsed.cancellationTerms.workerLateCancelHours).toBe(12);
  });

  it("rejects an on-site job without an address, end before start, and compensation above pay", () => {
    const r = workJobUpsertSchema.safeParse({
      ...job,
      addressLine: null,
      endsAt: "2026-11-22T03:00:00.000Z",
      cancellationTerms: { employerCancelAfterArrivalPaise: 60_000 },
    });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["addressLine", "endsAt", "cancellationTerms"]));
  });

  it("rejects a minimum age below 18", () => {
    expect(workJobUpsertSchema.safeParse({ ...job, minAge: 16 }).success).toBe(false);
  });

  it("validates GSTIN and Indian mobile format", () => {
    const org = {
      legalName: "Sharma Retail Private Limited",
      displayName: "Sharma Retail",
      orgType: "RETAIL",
      gstin: "09aaacs1234a1z5",
      registeredAddress: "12 Sector 18, Noida, UP",
      city: "Noida",
      contactName: "Rohit Sharma",
      contactPhone: "+919812345678",
      contactEmail: "ops@sharma.example",
    };
    expect(workOrgUpsertSchema.parse(org).gstin).toBe("09AAACS1234A1Z5");
    expect(workOrgUpsertSchema.safeParse({ ...org, gstin: "12345" }).success).toBe(false);
    expect(workOrgUpsertSchema.safeParse({ ...org, contactPhone: "9812345678" }).success).toBe(false);
  });
});
