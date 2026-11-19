import { z } from "zod";
import { Role } from "./enums";

// FastQue Finance (admin portal) — company expenses, who paid them, funding received, reimbursements.
// Accounting rules this module keeps everywhere:
// - Contributions/funding are never revenue, and are never equity unless classified as share capital
//   by the company's accountant; ownership percentages are never derived from money contributed.
// - Approving an expense does not pay it: "paid" comes only from recorded payments.
// - A person paying a company expense from their own pocket is ONE expense plus a personal payment
//   (reimbursable / founder loan / non-reimbursable contribution) — never company cash received.
// - Reimbursement payouts settle that liability; they are not a second expense.
// - Money is exact: decimal strings over the wire, integer paise in calculations, never floats.

export const FINANCE_PATHS = {
  /** admin/finance/... */
  root: "admin/finance",
  overview: "overview",
  categories: "categories",
  contributors: "contributors",
  ledger: "ledger",
  accounts: "accounts",
  vendors: "vendors",
  expenses: "expenses",
  export: "export",
  duplicates: "duplicates",
  submit: "submit",
  review: "review",
  cancel: "cancel",
  payments: "payments",
  void: "void",
  attachments: "attachments",
  audit: "audit",
  funding: "funding",
  reimbursements: "reimbursements",
  payouts: "payouts",
  me: "me",
} as const;

// ---------------------------------------------------------------- permissions

/**
 * Who may do what. Enforced by the backend on every route (RolesGuard + per-record checks); the web
 * app only mirrors it. Company-wide figures (funding, cash, salaries, other people's claims) are
 * limited to platform admins and co-founders. Every internal admin role may record and claim its
 * OWN expenses and see only those.
 */
export const FINANCE_PERMISSION_ROLES = {
  /** Company-wide finance: overview, all expenses, funding, ledgers, vendors, accounts. */
  viewCompanyFinance: [Role.PLATFORM_ADMIN, Role.CO_FOUNDER],
  /** Record and edit company expenses, payments, funding, vendors, contributors. */
  manageFinance: [Role.PLATFORM_ADMIN, Role.CO_FOUNDER],
  /** Approve/reject expenses and reimbursements (never their own, except a platform admin). */
  approveFinance: [Role.PLATFORM_ADMIN, Role.CO_FOUNDER],
  /** Categories, company accounts and other finance settings. */
  configureFinance: [Role.PLATFORM_ADMIN],
  /** Bank details of vendors and accounts. */
  viewBankDetails: [Role.PLATFORM_ADMIN],
  /** Submit own expenses, upload receipts, claim reimbursement, see own claims. */
  submitOwnClaims: [Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN, Role.SALES_ADMIN, Role.PLATFORM_VIEWER],
} as const satisfies Record<string, readonly Role[]>;
export type FinancePermission = keyof typeof FINANCE_PERMISSION_ROLES;
export function hasFinancePermission(roles: readonly Role[], permission: FinancePermission): boolean {
  const allowed: readonly Role[] = FINANCE_PERMISSION_ROLES[permission];
  return roles.some((role) => allowed.includes(role));
}

// ---------------------------------------------------------------- enums

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

export const FinanceExpenseStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  CANCELLED: "CANCELLED",
} as const;
export type FinanceExpenseStatus = (typeof FinanceExpenseStatus)[keyof typeof FinanceExpenseStatus];
export const FINANCE_EXPENSE_STATUS_LABEL: Record<FinanceExpenseStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved — unpaid",
  REJECTED: "Rejected",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};
/** Expenses the company has accepted as its own (counted as incurred). */
export const FINANCE_RECOGNISED_STATUSES: readonly FinanceExpenseStatus[] = ["APPROVED", "PARTIALLY_PAID", "PAID"];
/** Waiting for a decision. */
export const FINANCE_PENDING_STATUSES: readonly FinanceExpenseStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
/** Payments can be recorded from the start (money often leaves before approval) until the expense is closed. */
export const FINANCE_PAYABLE_STATUSES: readonly FinanceExpenseStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "PARTIALLY_PAID", "PAID"];
/** Content (amount, category…) is editable only before a decision. */
export const FINANCE_EDITABLE_STATUSES: readonly FinanceExpenseStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW"];

export const FinanceContributorType = {
  FOUNDER: "FOUNDER",
  DIRECTOR: "DIRECTOR",
  INVESTOR: "INVESTOR",
  CITY_PARTNER: "CITY_PARTNER",
  EMPLOYEE: "EMPLOYEE",
  OTHER: "OTHER",
} as const;
export type FinanceContributorType = (typeof FinanceContributorType)[keyof typeof FinanceContributorType];

export const FinanceFundingKind = {
  /** Money received INTO a company account. */
  CONTRIBUTION: "CONTRIBUTION",
  /** Money the company paid back to a contributor (loan/advance repayment, capital return). */
  REPAYMENT: "REPAYMENT",
} as const;
export type FinanceFundingKind = (typeof FinanceFundingKind)[keyof typeof FinanceFundingKind];

export const FinanceFundingClassification = {
  SHARE_CAPITAL: "SHARE_CAPITAL",
  SHARE_APPLICATION_MONEY: "SHARE_APPLICATION_MONEY",
  SHARE_PREMIUM: "SHARE_PREMIUM",
  FOUNDER_LOAN: "FOUNDER_LOAN",
  DIRECTOR_LOAN: "DIRECTOR_LOAN",
  THIRD_PARTY_LOAN: "THIRD_PARTY_LOAN",
  REIMBURSABLE_ADVANCE: "REIMBURSABLE_ADVANCE",
  NON_REIMBURSABLE_CONTRIBUTION: "NON_REIMBURSABLE_CONTRIBUTION",
  OTHER_FUNDING: "OTHER_FUNDING",
  /** Not yet classified — the accountant decides. Never assumed to be equity. */
  UNCLASSIFIED: "UNCLASSIFIED",
} as const;
export type FinanceFundingClassification = (typeof FinanceFundingClassification)[keyof typeof FinanceFundingClassification];
export const FINANCE_FUNDING_CLASSIFICATION_LABEL: Record<FinanceFundingClassification, string> = {
  SHARE_CAPITAL: "Share capital",
  SHARE_APPLICATION_MONEY: "Share application money",
  SHARE_PREMIUM: "Share premium",
  FOUNDER_LOAN: "Founder loan",
  DIRECTOR_LOAN: "Director loan",
  THIRD_PARTY_LOAN: "Third-party loan",
  REIMBURSABLE_ADVANCE: "Reimbursable advance",
  NON_REIMBURSABLE_CONTRIBUTION: "Non-reimbursable contribution",
  OTHER_FUNDING: "Other funding",
  UNCLASSIFIED: "Unclassified (accountant to decide)",
};
/** Classifications that create a balance the company owes back. */
export const FINANCE_REPAYABLE_CLASSIFICATIONS: readonly FinanceFundingClassification[] = [
  "FOUNDER_LOAN",
  "DIRECTOR_LOAN",
  "THIRD_PARTY_LOAN",
  "REIMBURSABLE_ADVANCE",
];

export const FinanceAccountType = {
  COMPANY_BANK: "COMPANY_BANK",
  COMPANY_CASH: "COMPANY_CASH",
  COMPANY_WALLET: "COMPANY_WALLET",
} as const;
export type FinanceAccountType = (typeof FinanceAccountType)[keyof typeof FinanceAccountType];

export const FinancePaymentMethod = {
  UPI: "UPI",
  BANK_TRANSFER: "BANK_TRANSFER",
  CARD: "CARD",
  CASH: "CASH",
  CHEQUE: "CHEQUE",
  OTHER: "OTHER",
} as const;
export type FinancePaymentMethod = (typeof FinancePaymentMethod)[keyof typeof FinancePaymentMethod];

export const FinancePayerType = {
  /** Paid from a FastQue company account — company cash goes out. */
  COMPANY_ACCOUNT: "COMPANY_ACCOUNT",
  /** Paid by a person from their own money — no company cash moves. */
  PERSON: "PERSON",
} as const;
export type FinancePayerType = (typeof FinancePayerType)[keyof typeof FinancePayerType];

/** What a personal payment becomes for the company. */
export const FinancePersonalTreatment = {
  REIMBURSABLE: "REIMBURSABLE",
  FOUNDER_LOAN: "FOUNDER_LOAN",
  NON_REIMBURSABLE_CONTRIBUTION: "NON_REIMBURSABLE_CONTRIBUTION",
} as const;
export type FinancePersonalTreatment = (typeof FinancePersonalTreatment)[keyof typeof FinancePersonalTreatment];
export const FINANCE_PERSONAL_TREATMENT_LABEL: Record<FinancePersonalTreatment, string> = {
  REIMBURSABLE: "To be reimbursed",
  FOUNDER_LOAN: "Treated as founder loan",
  NON_REIMBURSABLE_CONTRIBUTION: "Non-reimbursable contribution",
};

export const FinanceReimbursementStatus = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  PARTIALLY_REIMBURSED: "PARTIALLY_REIMBURSED",
  FULLY_REIMBURSED: "FULLY_REIMBURSED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;
export type FinanceReimbursementStatus = (typeof FinanceReimbursementStatus)[keyof typeof FinanceReimbursementStatus];
export const FINANCE_REIMBURSEMENT_STATUS_LABEL: Record<FinanceReimbursementStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved — unpaid",
  PARTIALLY_REIMBURSED: "Partially reimbursed",
  FULLY_REIMBURSED: "Fully reimbursed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
/** Claims that block a second claim on the same payment. */
export const FINANCE_OPEN_REIMBURSEMENT_STATUSES: readonly FinanceReimbursementStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "PARTIALLY_REIMBURSED",
  "FULLY_REIMBURSED",
];

export const FINANCE_DEPARTMENTS = [
  "Technology",
  "Sales",
  "Marketing",
  "Operations",
  "Human Resources",
  "Legal & Compliance",
  "Administration",
  "Commerce",
] as const;

/** Suggested cities/territories; free text is allowed for new ones. */
export const FINANCE_CITY_SUGGESTIONS = ["NCR", "Indore", "Bhopal", "Patna", "Bhubaneswar", "Hajipur"] as const;

export const FINANCE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const FINANCE_ATTACHMENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export const FinanceErrorCode = {
  NOT_FOUND: "FINANCE_NOT_FOUND",
  FORBIDDEN: "FINANCE_FORBIDDEN",
  INVALID_STATE: "FINANCE_INVALID_STATE",
  OVERPAYMENT: "FINANCE_OVERPAYMENT",
  DUPLICATE_SUSPECTED: "FINANCE_DUPLICATE_SUSPECTED",
  DUPLICATE_CLAIM: "FINANCE_DUPLICATE_CLAIM",
  DUPLICATE_ATTACHMENT: "FINANCE_DUPLICATE_ATTACHMENT",
  SELF_APPROVAL: "FINANCE_SELF_APPROVAL",
  INVALID: "FINANCE_INVALID",
} as const;

// ---------------------------------------------------------------- default categories

/** FastQue's standard expense categories (seeded by migration; admins can add more). */
export const FINANCE_DEFAULT_CATEGORIES: ReadonlyArray<{ name: string; department: string; subcategories: readonly string[] }> = [
  {
    name: "Technology & Product Development",
    department: "Technology",
    subcategories: [
      "Website Development", "Mobile App Development", "Frontend Development", "Backend Development", "Cloud Hosting",
      "Database Hosting", "Domain Registration", "SSL/Security", "GitHub / Developer Tools", "Claude / AI Tools",
      "AI API Usage", "SMS / OTP Services", "WhatsApp API", "Email Services", "Maps / Geolocation API", "Storage / CDN",
      "Software Subscriptions", "Testing / QA", "UI/UX Design", "Other Technology Expenses",
    ],
  },
  {
    name: "Sales & Field Operations",
    department: "Sales",
    subcategories: [
      "Field Sales Salaries", "Sales Incentives", "Travel Allowance", "Fuel", "Local Transportation", "Field Accommodation",
      "Mobile Recharge", "Internet", "Sales Training", "Salon Onboarding Cost", "QR Code Installation", "Salon Photography",
      "Sales Demonstration Materials", "Field Equipment", "Other Field Expenses",
    ],
  },
  {
    name: "Marketing & Customer Acquisition",
    department: "Marketing",
    subcategories: [
      "Meta Ads", "Google Ads", "Influencer Marketing", "Social Media Marketing", "Video Production", "Graphic Design",
      "Flyers and Pamphlets", "QR Posters", "Promotional Banners", "T-shirts / Uniforms", "Salon Welcome Kits",
      "Referral Rewards", "Customer Discounts", "Promotional Events", "Other Marketing Expenses",
    ],
  },
  {
    name: "Human Resources",
    department: "Human Resources",
    subcategories: [
      "Employee Salaries", "Contractor Payments", "Recruitment", "Training", "Employee Benefits", "Bonuses", "Insurance",
      "Other HR Expenses",
    ],
  },
  {
    name: "Legal, Registration & Compliance",
    department: "Legal & Compliance",
    subcategories: [
      "Company Incorporation", "CA / Accounting Fees", "ROC Filings", "Annual Compliance", "Legal Consultation",
      "Trademark Registration", "GST Compliance", "Income Tax Compliance", "Audit Fees", "Contract Documentation",
      "Other Legal Expenses",
    ],
  },
  {
    name: "Office & Administration",
    department: "Administration",
    subcategories: [
      "Office Rent", "Utilities", "Internet", "Office Supplies", "Laptop / Computer", "Furniture", "Printing", "Courier",
      "Bank Charges", "Other Administrative Expenses",
    ],
  },
  {
    name: "Salon Partnership & Activation",
    department: "Sales",
    subcategories: [
      "Salon Onboarding Kits", "QR Materials", "Staff Training", "Salon Promotional Support", "Partner Incentives",
      "Salon Activation Campaigns", "Product Demonstrations", "Other Salon Partnership Expenses",
    ],
  },
  {
    name: "Inventory & Commerce Operations",
    department: "Commerce",
    subcategories: [
      "Product Sample Purchases", "Supplier Samples", "Warehouse Expenses", "Packaging", "Shipping", "Barcode / QR Labels",
      "Inventory Technology", "Product Returns", "Other Commerce Expenses",
    ],
  },
  {
    name: "Travel & Meetings",
    department: "Operations",
    subcategories: [
      "Intercity Travel", "Hotels", "Business Meals", "Investor Meetings", "Partner Meetings", "Local Transportation",
      "Other Travel Expenses",
    ],
  },
  {
    name: "Miscellaneous",
    department: "Administration",
    subcategories: ["General Miscellaneous", "One-Time Expenses", "Unclassified Expenses"],
  },
];

/** Name comparison key for categories ("Cloud  Hosting" = "cloud hosting"). */
export function normalizeFinanceName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------------------------------------------------------------- money (exact)

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** "1234.5" → 123450 paise. Throws on anything that is not a plain non-negative amount with ≤2 decimals. */
export function financeToPaise(amount: string | number): number {
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  if (!MONEY_PATTERN.test(text)) throw new Error(`Invalid amount: ${amount}`);
  const [rupees, fraction = ""] = text.split(".");
  return Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
}

/** 123450 → "1234.50" */
export function financeFromPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error(`Invalid paise: ${paise}`);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Sum of decimal strings, exactly. */
export function sumMoney(amounts: ReadonlyArray<string | number>): string {
  return financeFromPaise(amounts.reduce<number>((total, a) => total + financeToPaise(String(a)), 0));
}

/** "₹1,23,450.00" (Indian grouping). */
export function formatInr(amount: string | number): string {
  const paise = typeof amount === "number" ? Math.round(amount * 100) : toPaiseSigned(amount);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = new Intl.NumberFormat("en-IN").format(Math.floor(abs / 100));
  const fraction = abs % 100;
  return `${sign}₹${rupees}${fraction ? `.${String(fraction).padStart(2, "0")}` : ""}`;
}

function toPaiseSigned(amount: string): number {
  const text = amount.trim();
  return text.startsWith("-") ? -financeToPaise(text.slice(1)) : financeToPaise(text);
}

/** A positive INR amount sent as a string or number; normalised to a 2-decimal string. */
export const financeMoneySchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const paise = financeToPaise(typeof v === "number" ? String(v) : v);
      if (paise <= 0) throw new Error("not positive");
      return financeFromPaise(paise);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount in rupees, up to 2 decimals, greater than 0." });
      return z.NEVER;
    }
  });
/** Same, but zero is allowed (tax, opening balance). */
export const financeMoneyOrZeroSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      return financeFromPaise(financeToPaise(typeof v === "number" ? String(v) : v));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount in rupees, up to 2 decimals." });
      return z.NEVER;
    }
  });

// ---------------------------------------------------------------- pure rules (shared by server + tests)

/** Status an expense moves to after its payments change (approval itself never marks it paid). */
export function expenseStatusAfterPayments(
  status: FinanceExpenseStatus,
  amount: string,
  activePaid: string,
): FinanceExpenseStatus {
  if (!FINANCE_RECOGNISED_STATUSES.includes(status)) return status;
  const paid = financeToPaise(activePaid);
  if (paid <= 0) return "APPROVED";
  return paid >= financeToPaise(amount) ? "PAID" : "PARTIALLY_PAID";
}

/** Reimbursement status from its approved amount and active payouts. */
export function reimbursementStatusAfterPayouts(
  status: FinanceReimbursementStatus,
  approved: string | null,
  paidOut: string,
): FinanceReimbursementStatus {
  if (!["APPROVED", "PARTIALLY_REIMBURSED", "FULLY_REIMBURSED"].includes(status) || approved === null) return status;
  const paid = financeToPaise(paidOut);
  if (paid <= 0) return "APPROVED";
  return paid >= financeToPaise(approved) ? "FULLY_REIMBURSED" : "PARTIALLY_REIMBURSED";
}

export type FinanceRunway =
  | { kind: "MONTHS"; months: number }
  | { kind: "NOT_BURNING" }
  | { kind: "NO_CASH" }
  | { kind: "INSUFFICIENT_DATA" };

/**
 * Cash runway from unrestricted cash and average monthly NET burn. Zero or negative burn is not
 * "infinite runway" — it is reported as not burning; no history is reported as insufficient data.
 */
export function computeRunway(cash: string, averageNetBurn: string | null): FinanceRunway {
  if (averageNetBurn === null) return { kind: "INSUFFICIENT_DATA" };
  const cashPaise = toPaiseSigned(cash);
  const burn = toPaiseSigned(averageNetBurn);
  if (burn <= 0) return { kind: "NOT_BURNING" };
  if (cashPaise <= 0) return { kind: "NO_CASH" };
  return { kind: "MONTHS", months: Math.floor((cashPaise / burn) * 10) / 10 };
}

/** Average of monthly amounts (decimal strings), exactly to the paisa; null when there are none. */
export function averageMoney(amounts: readonly string[]): string | null {
  if (!amounts.length) return null;
  const total = amounts.reduce((t, a) => t + toPaiseSigned(a), 0);
  return financeFromPaise(Math.round(total / amounts.length));
}

// ---------------------------------------------------------------- input schemas

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const clientRequestId = z.string().uuid().optional();

export const financeCategoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  parentId: z.string().uuid().optional(),
  department: optionalText(60),
});
export type FinanceCategoryCreateInput = z.infer<typeof financeCategoryCreateSchema>;
export const financeCategoryUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  department: optionalText(60),
  isActive: z.boolean().optional(),
});
export type FinanceCategoryUpdateInput = z.infer<typeof financeCategoryUpdateSchema>;

export const financeContributorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(values(FinanceContributorType)),
  /** Links the contributor to an existing FastQue user with this email (one contributor per user). */
  userEmail: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  phone: optionalText(20),
  notes: optionalText(500),
  isActive: z.boolean().optional(),
});
export type FinanceContributorInput = z.infer<typeof financeContributorSchema>;

export const financeAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(values(FinanceAccountType)),
  institution: optionalText(120),
  accountLast4: z.string().regex(/^\d{4}$/).optional(),
  openingBalance: financeMoneyOrZeroSchema.default("0"),
  openingBalanceDate: isoDate,
  isActive: z.boolean().optional(),
});
export type FinanceAccountInput = z.infer<typeof financeAccountSchema>;

export const financeVendorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: optionalText(80),
  contactPerson: optionalText(120),
  phone: optionalText(20),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  address: optionalText(400),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN is 15 characters.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  paymentTerms: optionalText(120),
  bankDetails: optionalText(400),
  isActive: z.boolean().optional(),
});
export type FinanceVendorInput = z.infer<typeof financeVendorSchema>;

export const financeExpenseInputSchema = z
  .object({
    expenseDate: isoDate,
    categoryId: z.string().uuid(),
    subcategoryId: z.string().uuid().optional(),
    customSubcategory: optionalText(80),
    description: z.string().trim().min(3).max(1000),
    amount: financeMoneySchema,
    taxAmount: financeMoneyOrZeroSchema.default("0"),
    vendorId: z.string().uuid().optional(),
    department: optionalText(60),
    city: optionalText(60),
    project: optionalText(120),
    reimbursementRequired: z.boolean().default(false),
    /** Create-only: "I paid this myself" — records a personal, reimbursable payment of the full amount. */
    paidByMe: z.boolean().optional(),
    isRecurring: z.boolean().default(false),
    notes: optionalText(1000),
    /** Set after the user has seen the possible-duplicate warning and still wants to save. */
    confirmDuplicate: z.boolean().optional(),
    clientRequestId,
  })
  .refine((v) => financeToPaise(v.taxAmount) <= financeToPaise(v.amount), { message: "Tax cannot exceed the amount.", path: ["taxAmount"] });
export type FinanceExpenseInput = z.infer<typeof financeExpenseInputSchema>;

export const financeExpenseListQuerySchema = z.object({
  q: optionalText(100),
  status: z.enum(values(FinanceExpenseStatus)).optional(),
  categoryId: z.string().uuid().optional(),
  city: optionalText(60),
  department: optionalText(60),
  vendorId: z.string().uuid().optional(),
  /** Expenses with at least one payment by this person. */
  paidByContributorId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).default("date_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type FinanceExpenseListQuery = z.infer<typeof financeExpenseListQuerySchema>;

export const financeExpenseReviewSchema = z.object({
  action: z.enum(["START_REVIEW", "APPROVE", "REJECT"]),
  note: optionalText(500),
});
export type FinanceExpenseReviewInput = z.infer<typeof financeExpenseReviewSchema>;

export const financeReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type FinanceReasonInput = z.infer<typeof financeReasonSchema>;

export const financeExpensePaymentSchema = z
  .object({
    amount: financeMoneySchema,
    paidOn: isoDate,
    payerType: z.enum(values(FinancePayerType)),
    accountId: z.string().uuid().optional(),
    contributorId: z.string().uuid().optional(),
    personalTreatment: z.enum(values(FinancePersonalTreatment)).optional(),
    method: z.enum(values(FinancePaymentMethod)),
    reference: optionalText(120),
    clientRequestId,
  })
  .superRefine((v, ctx) => {
    if (v.payerType === "COMPANY_ACCOUNT" && !v.accountId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the company account it was paid from.", path: ["accountId"] });
    if (v.payerType === "PERSON" && !v.contributorId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose who paid.", path: ["contributorId"] });
    if (v.payerType === "PERSON" && !v.personalTreatment)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose how this personal payment is treated.", path: ["personalTreatment"] });
  });
export type FinanceExpensePaymentInput = z.infer<typeof financeExpensePaymentSchema>;

export const financeFundingSchema = z.object({
  contributorId: z.string().uuid(),
  kind: z.enum(values(FinanceFundingKind)),
  classification: z.enum(values(FinanceFundingClassification)),
  date: isoDate,
  amount: financeMoneySchema,
  accountId: z.string().uuid(),
  method: z.enum(values(FinancePaymentMethod)),
  sourceAccount: optionalText(120),
  reference: optionalText(120),
  purpose: optionalText(300),
  remarks: optionalText(500),
  clientRequestId,
});
export type FinanceFundingInput = z.infer<typeof financeFundingSchema>;

export const financeReimbursementCreateSchema = z.object({
  expensePaymentId: z.string().uuid(),
  amountRequested: financeMoneySchema,
  note: optionalText(500),
  clientRequestId,
});
export type FinanceReimbursementCreateInput = z.infer<typeof financeReimbursementCreateSchema>;

export const financeReimbursementReviewSchema = z.object({
  action: z.enum(["START_REVIEW", "APPROVE", "REJECT"]),
  amountApproved: financeMoneySchema.optional(),
  note: optionalText(500),
});
export type FinanceReimbursementReviewInput = z.infer<typeof financeReimbursementReviewSchema>;

export const financePayoutSchema = z.object({
  amount: financeMoneySchema,
  paidOn: isoDate,
  accountId: z.string().uuid(),
  method: z.enum(values(FinancePaymentMethod)),
  reference: optionalText(120),
  clientRequestId,
});
export type FinancePayoutInput = z.infer<typeof financePayoutSchema>;

export const financeOverviewQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  categoryId: z.string().uuid().optional(),
  city: optionalText(60),
  department: optionalText(60),
  contributorId: z.string().uuid().optional(),
});
export type FinanceOverviewQuery = z.infer<typeof financeOverviewQuerySchema>;

// ---------------------------------------------------------------- DTOs

export interface FinanceCategoryDto {
  id: string;
  name: string;
  department: string | null;
  isSystem: boolean;
  isActive: boolean;
  subcategories: Array<{ id: string; name: string; isSystem: boolean; isActive: boolean }>;
}

export interface FinanceContributorDto {
  id: string;
  name: string;
  type: FinanceContributorType;
  userId: string | null;
  userEmail: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface FinanceAccountDto {
  id: string;
  name: string;
  type: FinanceAccountType;
  institution: string | null;
  accountLast4: string | null;
  openingBalance: string;
  openingBalanceDate: string;
  /** Opening balance plus every recorded movement — the actual cash in this account. */
  balance: string;
  isActive: boolean;
}

export interface FinanceVendorDto {
  id: string;
  name: string;
  category: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  paymentTerms: string | null;
  /** Only for roles with viewBankDetails; otherwise null. */
  bankDetails: string | null;
  isActive: boolean;
  totalPaid: string;
  outstanding: string;
  expenseCount: number;
}

export interface FinanceRef {
  id: string;
  name: string;
}

export interface FinanceExpensePaymentDto {
  id: string;
  amount: string;
  paidOn: string;
  payerType: FinancePayerType;
  account: FinanceRef | null;
  contributor: FinanceRef | null;
  personalTreatment: FinancePersonalTreatment | null;
  method: FinancePaymentMethod;
  reference: string | null;
  voided: boolean;
  voidReason: string | null;
  createdAt: string;
  createdBy: string | null;
  /** The open reimbursement claim on this payment, if any. */
  reimbursementId: string | null;
}

export interface FinanceAttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface FinanceExpenseDto {
  id: string;
  number: string;
  expenseDate: string;
  category: FinanceRef;
  subcategory: FinanceRef | null;
  customSubcategory: string | null;
  description: string;
  amount: string;
  taxAmount: string;
  currency: string;
  vendor: FinanceRef | null;
  department: string | null;
  city: string | null;
  project: string | null;
  reimbursementRequired: boolean;
  isRecurring: boolean;
  notes: string | null;
  status: FinanceExpenseStatus;
  paidAmount: string;
  /** People/accounts that paid (active payments only). */
  paidBy: string[];
  lastPaidOn: string | null;
  attachmentCount: number;
  createdBy: FinanceRef | null;
  approvedBy: FinanceRef | null;
  approvedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  /** What the current user may do with this expense. */
  can: { edit: boolean; submit: boolean; review: boolean; cancel: boolean; pay: boolean; delete: boolean };
}

export interface FinanceExpenseDetailDto extends FinanceExpenseDto {
  payments: FinanceExpensePaymentDto[];
  attachments: FinanceAttachmentDto[];
}

export interface FinanceExpensePageDto {
  items: FinanceExpenseDto[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: string;
}

export interface FinanceDuplicateCandidateDto {
  id: string;
  number: string;
  expenseDate: string;
  amount: string;
  description: string;
  status: FinanceExpenseStatus;
}

export interface FinanceAuditEventDto {
  id: string;
  action: string;
  actor: string | null;
  note: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export interface FinanceFundingDto {
  id: string;
  number: string;
  contributor: FinanceRef & { type: FinanceContributorType };
  kind: FinanceFundingKind;
  classification: FinanceFundingClassification;
  date: string;
  amount: string;
  account: FinanceRef;
  method: FinancePaymentMethod;
  sourceAccount: string | null;
  reference: string | null;
  purpose: string | null;
  remarks: string | null;
  voided: boolean;
  voidReason: string | null;
  createdAt: string;
}

export interface FinanceReimbursementDto {
  id: string;
  number: string;
  requestedBy: FinanceRef;
  expense: { id: string; number: string; description: string };
  expensePaymentId: string;
  paymentAmount: string;
  amountRequested: string;
  amountApproved: string | null;
  amountReimbursed: string;
  remaining: string;
  status: FinanceReimbursementStatus;
  reviewNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  submittedAt: string;
  payouts: Array<{ id: string; amount: string; paidOn: string; account: FinanceRef; method: FinancePaymentMethod; reference: string | null; voided: boolean }>;
  can: { review: boolean; pay: boolean; cancel: boolean };
}

/** Personal payments the current user (or anyone, for finance managers) can still claim. */
export interface FinanceClaimablePaymentDto {
  id: string;
  amount: string;
  paidOn: string;
  contributor: FinanceRef;
  expense: { id: string; number: string; description: string; status: FinanceExpenseStatus };
}

export interface FinanceLedgerEntryDto {
  date: string;
  kind: "FUNDING_IN" | "REPAYMENT" | "PERSONAL_PAYMENT" | "REIMBURSEMENT_PAYOUT";
  description: string;
  amount: string;
  /** Classification (funding) or treatment (personal payment). */
  label: string;
  reference: string | null;
}

export interface FinanceContributorLedgerDto {
  contributor: FinanceContributorDto;
  totals: {
    /** Cash received into company accounts from this person (all classifications). */
    fundedIntoCompany: string;
    byClassification: Partial<Record<FinanceFundingClassification, string>>;
    /** Company expenses this person paid from their own money. */
    paidPersonally: string;
    paidPersonallyByTreatment: Partial<Record<FinancePersonalTreatment, string>>;
    /** Reimbursable personal payments not yet reimbursed. */
    reimbursementOutstanding: string;
    reimbursed: string;
    /** Loans/advances (funding + personal payments treated as loan) minus repayments. */
    loanBalance: string;
    repaid: string;
    /** Everything the company owes this person right now. */
    netOwedByCompany: string;
    /** Funding + personal payments: the person's total financial contribution. */
    totalContributed: string;
  };
  entries: FinanceLedgerEntryDto[];
}

export interface FinanceBreakdownRowDto {
  key: string;
  label: string;
  amount: string;
  count: number;
}

export interface FinanceOverviewDto {
  period: { from: string; to: string };
  generatedAt: string;
  kpis: {
    totalFundsContributed: string;
    founderContributions: string;
    otherFunding: string;
    /** Company expenses paid personally (not company cash) — shown separately from funding. */
    paidPersonallyOnBehalf: string;
    totalExpensesIncurred: string;
    totalExpensesPaid: string;
    unpaidLiabilities: string;
    expensesThisMonth: string;
    expensesLastMonth: string;
    periodExpensesIncurred: string;
    periodFundingReceived: string;
    availableCash: string;
    averageGrossBurn: string | null;
    averageNetBurn: string | null;
    burnMonthsUsed: number;
    runway: FinanceRunway;
    pendingReimbursements: string;
    reimbursementsAwaitingReview: string;
    outstandingPayables: string;
    approvedUnpaidExpenses: string;
    expensesAwaitingApproval: string;
    periodNetCashFlow: string;
    /** Not connected yet: FastQue revenue records are not linked to finance (Phase 5). */
    revenueReceived: null;
    /** Not set up yet: budgets are Phase 4. */
    budgetUtilizationPercent: null;
  };
  byCategory: FinanceBreakdownRowDto[];
  byCity: FinanceBreakdownRowDto[];
  byDepartment: FinanceBreakdownRowDto[];
  byPaidBy: FinanceBreakdownRowDto[];
  byContributorFunding: FinanceBreakdownRowDto[];
  monthly: Array<{ month: string; incurred: string; companyCashOut: string; fundingIn: string }>;
  reimbursementsOwedByPerson: FinanceBreakdownRowDto[];
}

export interface FinanceMeDto {
  roles: { viewCompany: boolean; manage: boolean; approve: boolean; configure: boolean; bankDetails: boolean };
  contributorId: string | null;
}
