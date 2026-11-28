import { AssistantActionId } from "./assistant";

/**
 * Issue #371: the disclosed acceptance set for first-attempt voice accuracy. Each phrase is a
 * supported READ or navigation for a shop owner; the voice check in the Assistant asks the owner to
 * say each one ONCE and records whether the first attempt was understood. Typed, every phrase maps to
 * its expected action (enforced by a backend test), so a failure on voice is a recognition problem.
 */
export interface VoiceCheckPhrase {
  id: string;
  say: string;
  expect: AssistantActionId;
  /** Navigation phrases also expect this page in the route. */
  page?: string;
}

const A = AssistantActionId;
export const VOICE_CHECK_PHRASES: VoiceCheckPhrase[] = [
  { id: "help-en", say: "What can you do?", expect: A.HELP },
  { id: "help-en2", say: "How can you help me?", expect: A.HELP },
  { id: "help-hi", say: "Aap kya kya kar sakte ho?", expect: A.HELP },
  { id: "help-hi2", say: "Meri madad karo", expect: A.HELP },
  { id: "chairs-1", say: "Kitni chairs free hain?", expect: A.CHAIRS_LIST },
  { id: "chairs-2", say: "Check karo kitni chairs available hain", expect: A.CHAIRS_LIST },
  { id: "chairs-3", say: "Khali kursi kitni hain?", expect: A.CHAIRS_LIST },
  { id: "chairs-en", say: "How many chairs are free?", expect: A.CHAIRS_LIST },
  { id: "queue-1", say: "Aaj queue mein kitne log hain?", expect: A.QUEUE_STATUS },
  { id: "queue-2", say: "Queue ka status batao", expect: A.QUEUE_STATUS },
  { id: "queue-3", say: "Line mein kitne log hain?", expect: A.QUEUE_STATUS },
  { id: "queue-en", say: "How many people are waiting?", expect: A.QUEUE_STATUS },
  { id: "services-1", say: "Services dikhao", expect: A.SERVICE_LIST },
  { id: "services-2", say: "Kaun kaun si services hain?", expect: A.SERVICE_LIST },
  { id: "services-en", say: "Show services", expect: A.SERVICE_LIST },
  { id: "staff-1", say: "Staff dikhao", expect: A.STAFF_LIST },
  { id: "staff-2", say: "Kitne barber hain?", expect: A.STAFF_LIST },
  { id: "staff-en", say: "Show my staff", expect: A.STAFF_LIST },
  { id: "bookings-1", say: "Aaj ki bookings dikhao", expect: A.SCHEDULE_VIEW },
  { id: "bookings-2", say: "Kal ke appointments dikhao", expect: A.SCHEDULE_VIEW },
  { id: "bookings-en", say: "Show today's appointments", expect: A.SCHEDULE_VIEW },
  { id: "sales-1", say: "Aaj ki kamai kitni hui?", expect: A.TODAY_INSIGHTS },
  { id: "sales-2", say: "Aaj ki sales batao", expect: A.TODAY_INSIGHTS },
  { id: "nav-bookings", say: "Bookings kholo", expect: A.NAVIGATE, page: "bookings" },
  { id: "nav-services", say: "Services page kholo", expect: A.NAVIGATE, page: "services" },
  { id: "nav-queue", say: "Live queue kholo", expect: A.NAVIGATE, page: "queue" },
  { id: "nav-chairs", say: "Chairs page kholo", expect: A.NAVIGATE, page: "chairs" },
  { id: "nav-staff", say: "Open staff page", expect: A.NAVIGATE, page: "staff" },
  { id: "nav-dashboard", say: "Dashboard pe jao", expect: A.NAVIGATE, page: "dashboard" },
  { id: "nav-settings", say: "Settings kholo", expect: A.NAVIGATE, page: "settings" },
  { id: "nav-back", say: "Wapas jao", expect: A.NAVIGATE_BACK },
  { id: "nav-back-en", say: "Go back", expect: A.NAVIGATE_BACK },
];
