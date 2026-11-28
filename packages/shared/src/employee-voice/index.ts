import { z } from "zod";

export const employeeVoiceLanguageSchema = z.enum(["hi-IN", "en-IN"]);
export type EmployeeVoiceLanguage = z.infer<typeof employeeVoiceLanguageSchema>;

export const voiceOnboardingServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    priceRupees: z.number().min(0).max(1_000_000).nullable(),
  })
  .strict();

export const voiceOnboardingDraftSchema = z
  .object({
    shopName: z.string().max(200),
    ownerName: z.string().max(120).nullable(),
    mobile: z.string().max(20).nullable(),
    address: z.string().max(500).nullable(),
    city: z.string().max(120).nullable(),
    locality: z.string().max(160).nullable(),
    chairs: z.number().int().min(0).max(500).nullable(),
    staffCount: z.number().int().min(0).max(500).nullable(),
    services: z.array(voiceOnboardingServiceSchema).max(100),
    notes: z.string().max(5000).nullable(),
  })
  .strict();
export type VoiceOnboardingDraft = z.infer<typeof voiceOnboardingDraftSchema>;

export const createEmployeeVoiceVisitLogSchema = z
  .object({
    submissionKey: z.string().uuid(),
    transcript: z.string().trim().min(1).max(20_000),
    language: employeeVoiceLanguageSchema,
    structuredDraft: voiceOnboardingDraftSchema,
  })
  .strict();
export type CreateEmployeeVoiceVisitLogInput = z.infer<
  typeof createEmployeeVoiceVisitLogSchema
>;

export const updateEmployeeVoiceVisitLogSchema = z
  .object({
    transcript: z.string().trim().min(1).max(20_000),
    language: employeeVoiceLanguageSchema,
    structuredDraft: voiceOnboardingDraftSchema,
    status: z.enum(["DRAFT", "CONFIRMED"]),
    reviewAcknowledged: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "CONFIRMED" && input.reviewAcknowledged !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewAcknowledged"],
        message:
          "Employee review acknowledgment is required before confirmation.",
      });
    }
  });
export type UpdateEmployeeVoiceVisitLogInput = z.infer<
  typeof updateEmployeeVoiceVisitLogSchema
>;

export const employeeVoiceVisitLogListQuerySchema = z
  .object({
    limit: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? 20 : Number(value)))
      .pipe(z.number().int().min(1).max(50)),
    cursor: z.string().max(300).optional(),
  })
  .strict();
export type EmployeeVoiceVisitLogListQuery = z.infer<
  typeof employeeVoiceVisitLogListQuerySchema
>;

export interface EmployeeVoiceVisitLogDto {
  id: string;
  leadId: string;
  transcript: string;
  language: EmployeeVoiceLanguage;
  structuredDraft: VoiceOnboardingDraft;
  status: "DRAFT" | "CONFIRMED";
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  employee: { fullName: string; employeeCode: string };
}

export interface EmployeeVoiceVisitLogPageDto {
  lead: { id: string; shopName: string };
  items: EmployeeVoiceVisitLogDto[];
  nextCursor: string | null;
}

const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पाँच: 5,
  पांच: 5,
  छह: 6,
  छः: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
};

function asciiDigits(value: string): string {
  return value.replace(/[०-९]/g, (digit) => DEVANAGARI_DIGITS[digit] ?? digit);
}

function countFrom(text: string, unitAliases: string[]): number | null {
  const units = new Set(unitAliases.map((unit) => unit.toLowerCase()));
  const tokens = asciiDigits(text)
    .toLowerCase()
    .replace(/[।.,:;!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (let index = 1; index < tokens.length; index += 1) {
    if (!units.has(tokens[index])) continue;
    const raw = tokens[index - 1];
    if (/^\d{1,3}$/.test(raw)) return Number(raw);
    if (NUMBER_WORDS[raw] !== undefined) return NUMBER_WORDS[raw];
  }
  return null;
}

function afterLabel(text: string, label: RegExp): string | null {
  const value = text.match(label)?.[1]?.trim();
  return value ? value.replace(/[।.!;,]+$/, "").trim() : null;
}

function amountAndName(
  segment: string,
): { name: string; amount: number | null } | null {
  const normalized = asciiDigits(segment.trim());
  const match = normalized.match(
    /^(.*?)\s*(?:(?:₹|rs\.?|rupees?|रु\.?|रुपये|रुपया)\s*)?(\d[\d,]*)\s*(?:₹|rs\.?|rupees?|रु\.?|रुपये|रुपया)?\s*$/iu,
  );
  if (!match || !match[1].trim()) return null;
  const name = match[1]
    .trim()
    .replace(/\s+(?:price|की कीमत|की दर)\s*$/iu, "")
    .trim();
  if (
    !name ||
    /\b(?:chair|chairs|staff|employees?|people|कुर्सी|कुर्सियां|स्टाफ|कर्मचारी)\b/iu.test(
      name,
    )
  ) {
    return null;
  }
  const amount = Number(match[2].replace(/,/g, ""));
  return Number.isSafeInteger(amount) && amount >= 0 ? { name, amount } : null;
}

/**
 * Conservative, deterministic extraction for employee correction. It never supplies missing
 * values or publishes data to a salon catalog; uncertain clauses remain in notes/transcript.
 */
export function parseVoiceOnboardingTranscript(
  transcript: string,
): VoiceOnboardingDraft {
  const text = transcript
    .replace(/\r/g, "\n")
    .replace(/[।!?;\n]+/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  const segments = text
    .split(/\.(?:\s+|$)/)
    .map((part) => part.trim())
    .filter(Boolean);

  const phoneMatch = asciiDigits(text).match(/(?:\+?\d[\d\s()-]{8,17}\d)/);
  const mobile = phoneMatch?.[0].replace(/\D/g, "") ?? null;
  const ownerName = afterLabel(
    text,
    /(?:owner|proprietor|मालिक|ओनर)\s*(?:name)?\s*[:,-]?\s*([^.,।;]+)/iu,
  );
  const address = afterLabel(
    text,
    /(?:address|पता|एड्रेस)\s*[:,-]?\s*([^.,।;]+)/iu,
  );
  const city = afterLabel(text, /(?:city|शहर|नगर)\s*[:,-]?\s*([^.,।;]+)/iu);
  const locality = afterLabel(
    text,
    /(?:locality|area|इलाका|क्षेत्र)\s*[:,-]?\s*([^.,।;]+)/iu,
  );
  const chairs = countFrom(text, [
    "chair",
    "chairs",
    "कुर्सी",
    "कुर्सियां",
    "कुर्सियाँ",
  ]);
  const staffCount = countFrom(text, [
    "staff",
    "employee",
    "employees",
    "team",
    "स्टाफ",
    "कर्मचारी",
    "कर्मचारियों",
  ]);

  let shopName = "";
  const first = segments[0] ?? "";
  if (
    first &&
    !/(?:owner|mobile|phone|address|chairs?|staff|मालिक|मोबाइल|पता|कुर्सी|स्टाफ)/iu.test(
      first,
    )
  ) {
    shopName = first.slice(0, 200);
  }

  const services: VoiceOnboardingDraft["services"] = [];
  const notes: string[] = [];
  for (const segment of segments) {
    if (segment === first && shopName) continue;
    const isLabeledField =
      /^(?:owner|proprietor|मालिक|ओनर|mobile|phone|मोबाइल|फोन|address|पता|city|शहर|locality|area|इलाका)(?=$|[\s:,-])/iu.test(
        segment,
      );
    const isCountField =
      /^(?:\d{1,3}|[\p{L}]+)\s*(?:chairs?|कुर्सी|कुर्सियां|कुर्सियाँ|staff|employees?|team|स्टाफ|कर्मचारी|कर्मचारियों)(?=$|[\s:,.])/iu.test(
        asciiDigits(segment),
      );
    if (isLabeledField || isCountField) continue;
    const explicitService = segment.match(
      /^(?:services?\s*[:,-]?|सेवाएं?\s*[:,-]?)\s*(.+)$/iu,
    )?.[1];
    const candidate = explicitService ?? segment;
    const parsed = amountAndName(candidate);
    if (parsed) {
      services.push({
        name: parsed.name.slice(0, 100),
        priceRupees: parsed.amount,
      });
      continue;
    }
    if (explicitService) {
      services.push({ name: explicitService.slice(0, 100), priceRupees: null });
      continue;
    }
    if (candidate.length <= 100) notes.push(candidate);
  }

  const draft = {
    shopName,
    ownerName,
    mobile,
    address,
    city,
    locality,
    chairs,
    staffCount,
    services: services.slice(0, 100),
    notes: notes.length ? notes.join(". ").slice(0, 5000) : null,
  };
  return voiceOnboardingDraftSchema.parse(draft);
}
