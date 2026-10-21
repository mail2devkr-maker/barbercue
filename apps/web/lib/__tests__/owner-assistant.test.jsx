import { QUESTION_LIMITS, QUICK_QUESTIONS, describeFailure, formatFigure, metricLabel, parseAnswer, validateQuestion } from "../owner-assistant";

// Mirror of the server's intent patterns in apps/backend/src/owner-ops/owner-assistant.service.ts (intentFor). It exists only so that a
// quick question this page offers can never silently drift away from wording the server understands; the live backend is the authority
// and the same eight questions are asked against it in the browser QA run.
const NON_TODAY_PERIOD = /\b(?:yesterday|tomorrow|last\s+(?:day|week|month|year)|this\s+(?:week|month|year)|next\s+(?:day|week|month|year))\b/u;
const TODAY = /\b(today|aaj)\b|आज/u;
function serverIntent(question) {
  const q = question.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (NON_TODAY_PERIOD.test(q)) return null;
  const hasToday = TODAY.test(q);
  if (hasToday && /\b(summary|overview|saaransh)\b|सारांश/u.test(q)) return "TODAY_SUMMARY";
  if (hasToday && /\b(revenue|collection|collected|payment|payments|income|kamai)\b|कमाई|आमदनी|भुगतान/u.test(q)) return "TODAY_RECORDED_AND_ESTIMATED_VALUE";
  if (/\b(waiting|wait|queue|intezar)\b|प्रतीक्षा|कतार/u.test(q)) return "WAITING_QUEUE_NOW";
  if (/\b(in service|being served|serving now)\b|सेवा में/u.test(q)) return "IN_SERVICE_NOW";
  if (hasToday && /\b(appointment|appointments|booking|bookings)\b|बुकिंग/u.test(q)) return "APPOINTMENTS_TODAY";
  if (hasToday && /\b(completed|finished|served)\b|पूरी हुई|पूर्ण/u.test(q)) return "COMPLETED_SERVICES_TODAY";
  if (/\b(available|free)\b.{0,40}\b(barber|barbers|staff)\b|\b(barber|barbers|staff)\b.{0,40}\b(available|free)\b|उपलब्ध/u.test(q)) return "AVAILABLE_BARBERS_NOW";
  if (hasToday && /\b(cancelled|canceled|cancellation|cancellations)\b|रद्द/u.test(q)) return "CANCELLATIONS_TODAY";
  return null;
}

describe("quick questions", () => {
  it("offers exactly the eight documented intents, each once", () => {
    expect(QUICK_QUESTIONS.map((q) => q.intent).sort()).toEqual(
      ["APPOINTMENTS_TODAY", "AVAILABLE_BARBERS_NOW", "CANCELLATIONS_TODAY", "COMPLETED_SERVICES_TODAY", "IN_SERVICE_NOW", "TODAY_RECORDED_AND_ESTIMATED_VALUE", "TODAY_SUMMARY", "WAITING_QUEUE_NOW"],
    );
  });

  it("uses wording the server maps to the same intent", () => {
    for (const q of QUICK_QUESTIONS) expect({ label: q.label, intent: serverIntent(q.question) }).toEqual({ label: q.label, intent: q.intent });
  });

  it("every question fits the length rules", () => {
    for (const q of QUICK_QUESTIONS) expect(validateQuestion(q.question)).toBeNull();
  });
});

describe("validateQuestion", () => {
  it("rejects too-short and too-long text after trimming", () => {
    expect(validateQuestion("")).toMatch(/at least 2/);
    expect(validateQuestion("  a  ")).toMatch(/at least 2/);
    expect(validateQuestion("x".repeat(QUESTION_LIMITS.max + 1))).toMatch(/under 300/);
  });

  it("accepts the boundaries", () => {
    expect(validateQuestion("ab")).toBeNull();
    expect(validateQuestion("x".repeat(QUESTION_LIMITS.max))).toBeNull();
  });
});

describe("figures", () => {
  it("labels known metrics and makes unknown ones readable instead of hiding them", () => {
    expect(metricLabel("recordedCollectionsToday")).toBe("Collections recorded today");
    expect(metricLabel("estimatedServiceValueToday")).toMatch(/Estimated/);
    expect(metricLabel("walkInsTodayCount")).toBe("Walk ins today count");
    expect(metricLabel("constructor")).toBe("Constructor");
  });

  it("formats money with its currency, a missing currency honestly, and counts plainly", () => {
    expect(formatFigure({ metric: "recordedCollectionsToday", value: 245, unit: "money", currency: "INR", estimated: false })).toMatch(/245/);
    expect(formatFigure({ metric: "recordedCollectionsToday", value: 245, unit: "money", currency: null, estimated: false })).toBe("245.00 (currency not set)");
    expect(formatFigure({ metric: "waitingInQueue", value: 12, unit: "count", currency: null, estimated: false })).toBe("12");
  });
});

const GOOD = {
  salonId: "s1", mode: "DETERMINISTIC", intent: "TODAY_SUMMARY", localDate: "2026-10-21", timezone: "Asia/Kolkata", answer: "Today there are 4 appointments.",
  figures: [{ metric: "appointmentsToday", value: 4, unit: "count", currency: null, estimated: false }], generatedAt: "2026-10-21T10:00:00.000Z",
};

describe("parseAnswer", () => {
  it("accepts exactly the documented shape", () => {
    expect(parseAnswer(GOOD)).toEqual(GOOD);
  });

  it("refuses anything else instead of showing part of it", () => {
    for (const bad of [null, undefined, "x", 3, [], {}, { ...GOOD, mode: "GENERATIVE" }, { ...GOOD, answer: "  " }, { ...GOOD, answer: 5 }, { ...GOOD, figures: "no" },
      { ...GOOD, figures: [{ ...GOOD.figures[0], value: Number.NaN }] }, { ...GOOD, figures: [{ ...GOOD.figures[0], unit: "percent" }] }, { ...GOOD, figures: [{ ...GOOD.figures[0], estimated: "yes" }] },
      { ...GOOD, timezone: undefined }]) {
      expect(parseAnswer(bad)).toBeNull();
    }
  });
});

describe("describeFailure", () => {
  it("lists what is supported on 422, preferring the server's own list and capping it", () => {
    const f = describeFailure(422, "OWNER_ASSISTANT_QUERY_UNSUPPORTED", { supportedIntents: ["today summary", "waiting queue now", 7, "", "x".repeat(200)] });
    expect(f.kind).toBe("UNSUPPORTED");
    expect(f.supported).toEqual(["today summary", "waiting queue now"]);
    expect(describeFailure(422, undefined, undefined).supported).toEqual([]);
    expect(describeFailure(undefined, "OWNER_ASSISTANT_QUERY_UNSUPPORTED", { supportedIntents: Array.from({ length: 30 }, (_, i) => `q${i}`) }).supported).toHaveLength(12);
  });

  it("explains rate limits, access, offline and everything else", () => {
    expect(describeFailure(429).kind).toBe("TOO_FAST");
    expect(describeFailure(429).message).toMatch(/12 a minute/);
    expect(describeFailure(401).kind).toBe("NO_ACCESS");
    expect(describeFailure(403).kind).toBe("NO_ACCESS");
    expect(describeFailure(0).message).toMatch(/offline/);
    expect(describeFailure(500).kind).toBe("TRY_LATER");
    expect(describeFailure(500).message).toMatch(/Nothing was changed/);
  });
});
