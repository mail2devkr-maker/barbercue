"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { formatPaise, HOME_STATUS_LABEL, type HomeBookingStatus } from "@barbercue/shared";
import { ApiError, apiFetch } from "./api";
import { useAuth } from "./auth-context";
import { newIdempotencyKey } from "./idempotency";

/** FastQue Home client helpers. Prices, availability and permissions are always decided by the server. */
export const money = formatPaise;
export type Lang = "en" | "hi";

type Method = "GET" | "POST" | "PUT" | "DELETE";
export function homeApi<T>(path: string, method: Method = "GET", body?: unknown, opts: { guest?: string | null; idempotent?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.guest) headers["X-Home-Access"] = opts.guest;
  if (opts.idempotent) headers["Idempotency-Key"] = opts.idempotent;
  return apiFetch<T>(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
export const newKey = newIdempotencyKey;

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues;
    if (issues?.length) return issues.map((i) => i.message).join(" · ");
    const missing = (err.details as { missing?: string[] } | undefined)?.missing;
    return missing?.length ? `${err.message} ${missing.join(", ")}` : err.message;
  }
  return "Something went wrong. Please try again.";
}

export function useLoad<T>(path: string | null, guest?: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    homeApi<T>(path, "GET", undefined, { guest })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [path, guest]);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

const IST = { timeZone: "Asia/Kolkata" } as const;
export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" });
export const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const istDate = (offset = 0) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
/** "35–45 minutes" style window, from now. */
export function etaText(from: string, to: string): string {
  const a = Math.max(0, Math.round((new Date(from).getTime() - Date.now()) / 60_000));
  const b = Math.max(5, Math.round((new Date(to).getTime() - Date.now()) / 60_000));
  return b > 180 ? `${time(from)} – ${time(to)}` : `${a}–${b} minutes`;
}

// ---------- Per-browser storage (language, location, bag, guest links). Never prices. ----------
function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
function store<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window: the page keeps working without it */
  }
  listeners.forEach((l) => l());
}
function snapshot<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  const value = raw ? read(key, fallback) : fallback;
  cache.set(key, { raw, value });
  return value;
}
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot(key, fallback),
    () => fallback,
  );
  return [value, (v: T) => store(key, v)];
}

export interface HomePlace {
  pincode?: string;
  locality?: string;
  city?: string;
  lat?: number;
  lng?: number;
}
export interface BagItem {
  offeringId?: string;
  serviceCode: string;
  name: string;
  quantity: number;
  variantCode?: string;
  professionalId?: string;
  providerId?: string;
  providerName?: string;
}
const NO_PLACE: HomePlace = {};
const NO_BAG: BagItem[] = [];
const NO_GUEST: Record<string, string> = {};
export const usePlace = () => useStored<HomePlace>("fq-home-place", NO_PLACE);
export const useBag = () => useStored<BagItem[]>("fq-home-bag", NO_BAG);
export const useGuestLinks = () => useStored<Record<string, string>>("fq-home-guest", NO_GUEST);

export function placeQuery(p: HomePlace): string {
  const q = new URLSearchParams();
  if (p.pincode) q.set("pincode", p.pincode);
  if (p.locality) q.set("locality", p.locality);
  if (p.city) q.set("city", p.city);
  if (p.lat != null && p.lng != null) {
    q.set("lat", String(p.lat));
    q.set("lng", String(p.lng));
  }
  return q.toString();
}
export const hasPlace = (p: HomePlace) => !!(p.pincode || p.locality || p.city || p.lat != null);

// ---------- Language ----------
const T = {
  tagline: ["Your Favourite Salon, At Your Doorstep", "आपका पसंदीदा सैलून, आपके घर पर"],
  bookNow: ["Book now", "अभी बुक करें"],
  schedule: ["Schedule", "समय चुनें"],
  where: ["Where should we come?", "हम कहाँ आएँ?"],
  useLocation: ["Use my location", "मेरी लोकेशन लें"],
  pincode: ["PIN code", "पिन कोड"],
  setPlace: ["Set place", "जगह चुनें"],
  find: ["Find professionals", "प्रोफेशनल खोजें"],
  search: ["Search a service or name", "सेवा या नाम खोजें"],
  bag: ["Your services", "आपकी सेवाएँ"],
  add: ["Add", "जोड़ें"],
  remove: ["Remove", "हटाएँ"],
  continue: ["Continue", "आगे बढ़ें"],
  address: ["Service address", "सेवा का पता"],
  house: ["House / flat number", "मकान / फ्लैट नंबर"],
  building: ["Building / society", "बिल्डिंग / सोसाइटी"],
  street: ["Street", "गली / सड़क"],
  locality: ["Locality", "इलाका"],
  landmark: ["Landmark", "लैंडमार्क"],
  city: ["City", "शहर"],
  state: ["State", "राज्य"],
  access: ["Access instructions", "पहुँचने के निर्देश"],
  name: ["Your name", "आपका नाम"],
  mobile: ["Mobile number", "मोबाइल नंबर"],
  payment: ["How will you pay?", "भुगतान कैसे करेंगे?"],
  cash: ["Cash after service", "सेवा के बाद नकद"],
  upi: ["Direct UPI to the provider", "प्रदाता को सीधे UPI"],
  other: ["Other offline method", "अन्य ऑफ़लाइन तरीका"],
  total: ["Total to pay", "कुल भुगतान"],
  confirm: ["Send booking request", "बुकिंग अनुरोध भेजें"],
  notConfirmed: ["This sends a request. It is confirmed only after a professional accepts.", "यह एक अनुरोध है। प्रोफेशनल के स्वीकार करने पर ही बुकिंग पक्की होगी।"],
  eta: ["Estimated arrival", "अनुमानित पहुँच"],
  approx: ["Approximate – no live traffic data", "अनुमानित – लाइव ट्रैफ़िक डेटा नहीं"],
  startCode: ["Show start code", "स्टार्ट कोड दिखाएँ"],
  startCodeHint: ["Share only when the professional is at your door.", "प्रोफेशनल के दरवाज़े पर आने पर ही बताएँ।"],
  cancel: ["Cancel booking", "बुकिंग रद्द करें"],
  reschedule: ["Change time", "समय बदलें"],
  rebook: ["Book again", "फिर बुक करें"],
  support: ["Get help", "मदद लें"],
  safety: ["Report a safety concern", "सुरक्षा की शिकायत करें"],
  emergency: ["In danger, call 112. This button reports to FastQue staff; it does not send help.", "खतरे में 112 पर कॉल करें। यह बटन FastQue स्टाफ़ को सूचना देता है; तुरंत मदद नहीं भेजता।"],
  policies: ["I have read the cancellation policy", "मैंने रद्द करने की नीति पढ़ ली है"],
  guardian: ["I am the parent/guardian and will be present", "मैं माता-पिता/अभिभावक हूँ और मौजूद रहूँगा/रहूँगी"],
  alternatives: ["If they cannot come, ask another eligible professional (never at a higher price)", "अगर वे न आ सकें तो दूसरे योग्य प्रोफेशनल से पूछें (कीमत कभी ज़्यादा नहीं)"],
  goOnline: ["Go online", "ऑनलाइन हों"],
  goOffline: ["Go offline", "ऑफ़लाइन हों"],
  accept: ["Accept", "स्वीकार करें"],
  decline: ["Decline", "मना करें"],
  prepare: ["Getting ready", "तैयारी शुरू"],
  onTheWay: ["On the way", "रास्ते में हूँ"],
  arrived: ["I have arrived", "मैं पहुँच गया/गई"],
  enterCode: ["Customer's start code", "ग्राहक का स्टार्ट कोड"],
  verify: ["Verify code", "कोड जाँचें"],
  start: ["Start service", "सेवा शुरू करें"],
  complete: ["Complete service", "सेवा पूरी करें"],
  recordPayment: ["Record payment received", "मिला भुगतान दर्ज करें"],
  requests: ["Requests", "अनुरोध"],
  today: ["Today", "आज"],
  upcoming: ["Upcoming", "आने वाली"],
  active: ["Active service", "चालू सेवा"],
  availability: ["My availability", "मेरी उपलब्धता"],
  earnings: ["Earnings", "कमाई"],
  reviews: ["Reviews", "समीक्षाएँ"],
  settings: ["Settings", "सेटिंग"],
  fullName: ["Full name", "पूरा नाम"],
  register: ["Register as an independent professional", "स्वतंत्र प्रोफेशनल के रूप में जुड़ें"],
  adult: ["I am 18 or older", "मेरी उम्र 18 वर्ष या अधिक है"],
  consent: ["I agree to join FastQue Home and show my profile to customers", "मैं FastQue Home से जुड़ने और ग्राहकों को अपनी प्रोफ़ाइल दिखाने की सहमति देता/देती हूँ"],
  submit: ["Submit", "जमा करें"],
  save: ["Save", "सहेजें"],
} as const;
export type TKey = keyof typeof T;

export function useLang(): { lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string; status: (s: HomeBookingStatus) => string } {
  const { user } = useAuth();
  const [stored, setLang] = useStored<Lang | null>("fq-home-lang", null);
  const lang: Lang = stored ?? ((user as { preferredLanguage?: string } | null)?.preferredLanguage === "HI" ? "hi" : "en");
  return { lang, setLang, t: (k) => T[k][lang === "hi" ? 1 : 0], status: (s) => HOME_STATUS_LABEL[s]?.[lang] ?? s };
}

// ---------- DTOs ----------
export interface HomeOption {
  professionalId: string;
  professionalName: string;
  photoUrl: string | null;
  providerId: string;
  providerName: string;
  kind: "SALON_MANAGED" | "INDEPENDENT_PROFESSIONAL";
  label: string;
  rating: number | null;
  reviewCount: number;
  badges: { scope: string; label: string }[];
  serviceStart: string;
  serviceEnd: string;
  durationMinutes: number;
  eta: { from: string; to: string; confidence: string; approximate: boolean; roadKm: number | null };
  price: { lines: { code: string; label: string; paise: number }[]; totalPaise: number };
  reasons: string[];
  paymentCollectedBy: string;
  invoiceIssuedBy: string;
  upiVpa: boolean;
  items: { name: string; quantity: number; safety: string | null; preparation: string | null; customerProducts: boolean; eligibility: string | null }[];
}
export interface HomeQuoteDto {
  options: HomeOption[];
  unavailable: { reason: string; text: string; count: number }[];
  policies: { cancellation: string; cancellationHi: string; reService: string };
}
export interface HomeCard {
  id: string;
  providerId: string;
  kind: string;
  label: string;
  salonName: string | null;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  yearsExperience: number | null;
  skills: string[];
  languages: string[];
  city: string;
  locality: string | null;
  online: boolean;
  badges: { scope: string; label: string }[];
  rating: number | null;
  reviewCount: number;
  completedServices: number;
  fromPaise: number | null;
  services: { offeringId: string; code: string; name: string; nameHi: string; pricePaise: number; productPaise: number; durationMinutes: number; variants: { code: string; name: string; pricePaise: number }[] }[];
}
export interface HomeBookingDto {
  id?: string;
  code: string;
  viewer: string;
  status: HomeBookingStatus;
  paymentStatus: string;
  complaintStatus: string;
  mode: string;
  serviceStart: string;
  serviceEnd: string;
  rescheduleTo: string | null;
  eta: { from: string; to: string; confidence: string | null; approximate: boolean; updatedAt: string } | null;
  delayMinutes: number;
  provider: { id: string; kind: string; name: string; label: string; salonPhone: string | null };
  professional: { id: string; name: string; photoUrl: string | null; badges: { label: string }[]; phone: string | null } | null;
  address: { locality: string; city: string; postalCode: string; full: null | { house: string; building: string | null; street: string | null; landmark: string | null; accessNotes: string | null; lat: number | null; lng: number | null } };
  customer: { name: string | null; phone: string | null } | null;
  guestVerificationNeeded: boolean;
  notes: string | null;
  items: { id: string; name: string; quantity: number; lineTotalPaise: number; durationMinutes: number; safety: string | null }[];
  price: { lines: { code: string; label: string; paise: number }[] };
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  paymentMethod: string;
  collectedBy: string;
  invoiceIssuedBy: string;
  upiVpa: string | null;
  payments: { id: string; method: string; amountPaise: number; createdAt: string; customerConfirmedAt: string | null; disputedAt: string | null; voided: boolean }[];
  adjustments: { id: string; description: string; amountPaise: number; minutes: number; status: string }[];
  replacementProposedId: string | null;
  invitations?: { name: string; status: string; expiresAt: string }[];
  policies: { cancellation?: string };
  review: { overall: number; comment: string | null; response: string | null } | null;
  tickets: { id: string; number: number; category: string; status: string }[];
  hygiene: { stage: string; complete: boolean }[];
  can: { cancel: boolean; reschedule: boolean; track: boolean; review: boolean; rebook: boolean };
  history: { kind: string; to: string | null; by: string; note: string | null; at: string }[];
}
