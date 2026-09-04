// Phase 14 (Localization & Voice Operations), extended for Issue 9 (mobile launch mission) to
// also cover the core customer-journey UI strings (UiStrings/UI_STRINGS/uiStringsFor below), and
// further extended after a Build 9 physical-device test proved app-owned English strings were
// still reaching Hindi-selected screens: bottom tab labels, owner/staff account + Manage Shop +
// Bookings-filter labels (UiStrings), the in-app Notification Center's per-type title
// (NotificationTypeLabels/notificationTypeLabel), and the OS push notification title/body
// (PushCopy/pushCopyFor) all now go through this module. Long-form/secondary owner-only copy not
// covered by an explicit key here still stays English-only — a real, narrower slice than "the
// whole app," not silently regressed to "translate nothing."
//
// Extensibility contract: adding a language means adding one Language enum value (../enums) plus
// one complete VoiceAnnouncements object, one complete UiStrings object, one complete
// NotificationTypeLabels object, one complete PushCopy object, one SPEECH_LOCALE entry and one
// LANGUAGE_LABELS entry below — TypeScript's Record<Language, ...> makes an incomplete addition a
// compile error, not a silent English fallback for the new language.

import { Language } from '../enums';
import { NOTIFICATION_TYPES, type NotificationType } from '../types';

export interface VoiceAnnouncements {
  /** Customer: a booked appointment's queue turn is about to come up. */
  turnApproaching(): string;
  /** Customer: the estimated wait shifted enough to be worth a fresh alert. */
  waitTimeChanged(): string;
  /**
   * Owner/staff: a new booking just landed on this salon. `barberName` is the actual assigned
   * barber if one exists yet, else the customer's selected preference, else null when the
   * customer chose "Any staff" and no one has been assigned yet — callers must never invent a
   * name for that null case (see formatVoiceBarberDate below for how `date`/`time` are produced).
   */
  newBookingReceived(
    serviceName: string | null,
    barberName: string | null,
    salonName: string | null,
    date: string | null,
    time: string | null,
  ): string;
  /** Owner/staff: a booking on this salon was just cancelled. */
  bookingCancelled(): string;
  /** Owner/staff: a walk-in just joined the live queue. */
  newCustomerJoined(tokenNumber: number, serviceName: string | null): string;
  /** Spoken once, immediately, when an owner/staff member turns voice announcements on — the only
   * way speechSynthesis/Speech.speak can be confirmed working without waiting for a real event. */
  voiceAnnouncementsOn(): string;
}

const en: VoiceAnnouncements = {
  turnApproaching: () => 'Your turn is almost here.',
  waitTimeChanged: () => 'Your wait time has changed.',
  newBookingReceived: (serviceName, barberName, salonName, date, time) => {
    const service = serviceName ? `New ${serviceName} service booked` : 'New booking received';
    const who = barberName ? ` for ${barberName}` : '';
    const where = salonName ? ` at ${salonName}` : '';
    const when = [date ? `on ${date}` : null, time ? `at ${time}` : null].filter(Boolean).join(' ');
    const whenClause = when ? ` ${when}` : '';
    const sentence = `${service}${who}${where}${whenClause}.`;
    return barberName ? sentence : `${sentence} Barber not assigned yet.`;
  },
  bookingCancelled: () => 'Booking cancelled.',
  newCustomerJoined: (tokenNumber, serviceName) =>
    `New customer joined the queue. Token number ${tokenNumber}${serviceName ? `, ${serviceName}` : ''}.`,
  voiceAnnouncementsOn: () => 'Voice announcements on.',
};

// Hindi, Devanagari script — expo-speech / speechSynthesis both accept UTF-8 text directly, no
// transliteration needed as long as the utterance's `lang`/voice is set to a Hindi locale (see
// SPEECH_LOCALE below), which is the caller's responsibility, not this module's. Proper nouns
// (service/barber/salon names) and the date/time string stay exactly as passed in — they are
// already Latin-script/English data throughout the rest of this product, matching how the
// pre-existing entries below already embed `serviceName`/`tokenNumber` untranslated.
const hi: VoiceAnnouncements = {
  turnApproaching: () => 'आपकी बारी जल्द आने वाली है।',
  waitTimeChanged: () => 'आपके प्रतीक्षा समय में बदलाव हुआ है।',
  newBookingReceived: (serviceName, barberName, salonName, date, time) => {
    const parts = [`नई ${serviceName ?? 'बुकिंग'} सेवा`];
    if (barberName) parts.push(`${barberName} के लिए`);
    if (salonName) parts.push(`${salonName} में`);
    if (date) parts.push(`${date} को`);
    if (time) parts.push(`${time} बजे`);
    parts.push('बुक हुई।');
    const sentence = parts.join(' ');
    return barberName ? sentence : `${sentence} अभी तक बार्बर तय नहीं हुआ है।`;
  },
  bookingCancelled: () => 'बुकिंग रद्द कर दी गई है।',
  newCustomerJoined: (tokenNumber, serviceName) =>
    `कतार में नया ग्राहक जुड़ा। टोकन नंबर ${tokenNumber}${serviceName ? `, ${serviceName}` : ''}।`,
  voiceAnnouncementsOn: () => 'आवाज़ में सूचनाएं चालू हैं।',
};

export const VOICE_ANNOUNCEMENTS: Readonly<Record<Language, VoiceAnnouncements>> = {
  [Language.EN]: en,
  [Language.HI]: hi,
};

/** Never throws on an unrecognised value — falls back to English, matching every other
 * "unknown/unset preference" default in this codebase. */
export function voiceAnnouncementsFor(language: Language | null | undefined): VoiceAnnouncements {
  return (language && VOICE_ANNOUNCEMENTS[language]) || VOICE_ANNOUNCEMENTS[Language.EN];
}

/** BCP-47 tags for Speech.speak()'s `language` option / SpeechSynthesisUtterance.lang — the `-IN`
 * region keeps both English and Hindi announcements in an Indian accent/voice where the platform
 * offers one, matching COUNTRY_LOCALE's existing en-IN convention in ../locale. */
export const SPEECH_LOCALE: Readonly<Record<Language, string>> = {
  [Language.EN]: 'en-IN',
  [Language.HI]: 'hi-IN',
};

/** Shown in the language switcher itself — each language's own name, in its own script. */
export const LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
  [Language.EN]: 'English',
  [Language.HI]: 'हिन्दी',
};

/** "1st" / "2nd" / "3rd" / "4th" ... "11th"-"13th" are always -th regardless of the last digit. */
export function ordinalDay(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * Voice/push booking announcements must speak the SALON's local date/time, never the listening
 * device's — a booking made from a phone in a different timezone must announce the same wall-
 * clock time an owner physically in that salon would recognize as their own. Pure: takes the IANA
 * zone the caller already resolved (apps/*'s own dashboard/salons/:salonId/timezone lookup),
 * never infers one itself.
 *
 * `date` is "5th September" (ordinal day + full month name, no year — a booking is always for the
 * near future). `time` drops a redundant ":00" ("10 AM") but keeps real minutes ("10:30 AM") —
 * built from Intl.DateTimeFormat parts rather than string-slicing the formatted output, so it
 * can't silently drift for locales/hour-cycles this file doesn't anticipate.
 */
export function formatVoiceDateTime(isoUtc: string, timeZone: string): { date: string; time: string } {
  const when = new Date(isoUtc);
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'long',
  }).formatToParts(when);
  const day = Number(dateParts.find((p) => p.type === 'day')?.value ?? '');
  const month = dateParts.find((p) => p.type === 'month')?.value ?? '';
  const date = Number.isFinite(day) && month ? `${ordinalDay(day)} ${month}` : '';

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }).formatToParts(when);
  const hour = timeParts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = timeParts.find((p) => p.type === 'minute')?.value ?? '0';
  const dayPeriod = timeParts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  // Intl's `minute: 'numeric'` still zero-pads ("00", not "0") in this runtime's ICU data — compare
  // the numeric value, not the raw string, so an on-the-hour slot reliably drops the ":00".
  const time = hour ? `${hour}${Number(minute) !== 0 ? `:${minute.padStart(2, '0')}` : ''} ${dayPeriod}`.trim() : '';

  return { date, time };
}

/**
 * Issue 9 (mobile launch mission) — the customer-journey strings a direct, pre-auth-reachable
 * language switcher actually needs. Deliberately a flat, keyed dictionary (not a template/ICU
 * system) — every value here is a short label or a fixed short sentence, never one built from
 * interpolated user data (booking/salon/service names stay in their own source language
 * regardless of UI language, same as the voice announcements above).
 */
export interface UiStrings {
  city: string;
  service: string;
  search: string;
  searchPlaceholder: string;
  nearMe: string;
  book: string;
  joinQueue: string;
  confirm: string;
  cancel: string;
  keepBooking: string;
  waiting: string;
  yourTurn: string;
  called: string;
  inService: string;
  signIn: string;
  signInWithGoogle: string;
  notifications: string;
  noNotifications: string;
  markAllRead: string;
  retry: string;
  open: string;
  closed: string;
  noResults: string;
  loading: string;
  outstandingDue: string;
  freeCancellation: string;
  statusConfirmed: string;
  statusPendingPayment: string;
  statusCancelled: string;
  statusCompleted: string;
  statusNoShow: string;
  statusExpired: string;
  genericError: string;
  offline: string;

  // Bottom tab labels — shown on every screen, so a gap here is the most visible kind of
  // half-translated app. One flat set reused across the customer/owner/staff tab bars rather than
  // three near-duplicate keys per role.
  tabHome: string;
  tabSearch: string;
  tabBookings: string;
  tabQueue: string;
  tabAccount: string;
  tabDashboard: string;
  tabShop: string;
  tabToday: string;

  // Account (customer + owner/staff DashboardAccountScreen share this set where the underlying
  // concept is identical — "account", "signed-in devices", etc. are role-agnostic).
  yourAccount: string;
  email: string;
  phone: string;
  accountType: string;
  signedInDevices: string;
  thisDevice: string;
  signOut: string;
  signOutThisDevice: string;
  language: string;

  // Owner/staff operational surfaces (Dashboard, Manage Shop, Bookings filters/status).
  dashboardTitle: string;
  manageShop: string;
  servicesLabel: string;
  chairsLabel: string;
  staffLabel: string;
  hoursLabel: string;
  photosLabel: string;
  customersLabel: string;
  customerLabel: string;
  addService: string;
  addChair: string;
  addBarber: string;
  addPhoto: string;
  saveAction: string;
  editAction: string;
  removeAction: string;
  cancelAction: string;
  activateAction: string;
  deactivateAction: string;
  viewCustomers: string;
  todayTitle: string;
  filterToday: string;
  filterUpcoming: string;
  filterCompleted: string;
  filterCancelled: string;
  filterNoShow: string;
  filterHistory: string;
  loadMore: string;

  // RoleSelectScreen (the pre-auth landing screen) — a real Build 9 physical-device screenshot
  // showed this exact screen half-translated: the browse card's own `t.city`/`t.book`/etc. calls
  // resolved to Hindi, but "Find a shop", "Already know your account?" and the three role
  // titles/subtitles sitting right next to them were hardcoded English literals never wired to
  // this module at all — the most visible possible half-translated-app symptom.
  findAShop: string;
  browseHint: string;
  orContinueAs: string;
  alreadyKnowAccount: string;
  roleCustomer: string;
  roleCustomerSubtitle: string;
  roleOwner: string;
  roleOwnerSubtitle: string;
  roleStaff: string;
  roleStaffSubtitle: string;

  // HomeScreen (the first screen a signed-in customer sees).
  welcomeBack: string;
  welcomeSubtitle: string;
  liveQueueLabel: string;
  tokenNumberPrefix: string;
  calledMessage: string;
  positionPrefix: string;
  positionSuffix: string;
  viewQueueStatus: string;
  upcomingBookingLabel: string;
  viewBookingAction: string;
  bookAheadKicker: string;
  reserveChair: string;
  serviceBarberTime: string;
  joinLiveKicker: string;
  skipTheWait: string;
  findShopJoinQueue: string;
  myBookings: string;
  aiStyleAdvisor: string;
  accountAndPremium: string;

  notSet: string;
  unknownDevice: string;
  signedInOnPrefix: string;
  signingOut: string;

  // OwnerDashboardScreen.
  statusPrefix: string;
  activeService: string;
  activeChair: string;
  activeBarber: string;
  closeShop: string;
  openShop: string;
  todaysBookings: string;
  completedTodayLabel: string;
  cancelledNoShowToday: string;
  liveQueue: string;
  registerShopHint: string;

  bookingsTitle: string;
  newBookingReceivedBanner: string;
  bookingCancelledBanner: string;
  noShopSelected: string;
  selectShopHint: string;
  noBookingsTitle: string;
  noBookingsHint: string;
  newBadge: string;
  preferredPrefix: string;

  // OwnerShopScreen (Manage Shop).
  selectShopTitle: string;
  chooseShopHint: string;
  shopSubtitle: string;
  noServicesYet: string;
  noChairsYet: string;
  noBarbersYet: string;
  customersHint: string;
  coverPhotoHint: string;
  noPhotosYet: string;
  replaceCoverPhoto: string;
  addCoverPhoto: string;
  addGalleryPhoto: string;

  // StaffTodayScreen.
  noShopYetTitle: string;
  noShopYetHint: string;
  todaysQueue: string;

  // Navigation stack header titles (customer + auth stacks) — shown at the top of literally
  // every screen below the tab root, so a gap here is maximally visible.
  findASalonTitle: string;
  salonTitle: string;
  chooseABarberTitle: string;
  chooseADateTitle: string;
  chooseATimeTitle: string;
  confirmTitle: string;
  queueTitle: string;
  bookingTitle: string;
  signInTitle: string;
  passwordRecoveryTitle: string;
  homeButtonLabel: string;

  // AccountScreen (customer) + shared role labels.
  accountDetailsCard: string;
  contactDetailsSubtitle: string;
  couldNotLoadSessions: string;
  couldNotSignOutSession: string;
  couldNotSignOutOtherSessions: string;
  voiceHint: string;
  premiumActive: string;
  premiumInactive: string;
  noActiveSessions: string;
  signOutOtherSessions: string;
  roleCustomerLabel: string;
  roleStaffLabel: string;
  roleOwnerLabel: string;
  roleAdminLabel: string;
  premiumLabel: string;

  // Core booking flow: DateSelect, SlotSelect, StaffSelect, ConfirmBooking, BookingDetail,
  // MyBookings, WalkInJoin, QueueScreen, QueueStatusPanel, SalonSearch, SalonProfile.
  anyStaffOption: string;
  staffSelectHint: string;
  slotsClosedLabel: string;
  noSlotsTitle: string;
  noSlotsHint: string;
  availableLegend: string;
  occupiedLegend: string;
  availableWord: string;
  occupiedWord: string;
  timeAvailabilityLegend: string;
  couldNotLoadTimes: string;
  couldNotLoadStaff: string;
  getDirections: string;
  shareAction: string;
  shareOnWhatsApp: string;
  bookAgainAction: string;
  cancelBookingAction: string;
  hideRescheduleAction: string;
  rescheduleAction: string;
  cancelBookingConfirmTitle: string;
  confirmCancellationAction: string;
  checkInAction: string;
  statusLabelPrefix: string;
  preferredBarberPrefix: string;
  styleLabelPrefix: string;
  prepaymentRequiredPrefix: string;
  cancellationChargePrefix: string;
  bookingIdPrefix: string;
  couldNotLoadBooking: string;
  couldNotShare: string;
  couldNotLoadCancellationPolicy: string;
  couldNotCancelBooking: string;
  couldNotCheckIn: string;
  couldNotCreateBooking: string;
  bookingConfirmedTitle: string;
  confirmBookingTitle: string;
  viewMyBookings: string;
  freeCancellationUpTo: string;
  beforeYourAppointment: string;
  hoursSingular: string;
  hoursPlural: string;
  minutesSuffix: string;
  myBookingsTitle: string;
  noBookingsYetTitle: string;
  noBookingsYetHint: string;
  viewDetailsAction: string;
  couldNotLoadBookings: string;
  couldNotJoinQueue: string;
  alreadyInQueueTitle: string;
  alreadyInQueueHint: string;
  youreInLineTitle: string;
  joinTheQueueTitle: string;
  serviceOptional: string;
  anyServiceOption: string;
  queueStatusTitle: string;
  noActiveQueueTitle: string;
  noActiveQueueHint: string;
  findASalonAction: string;
  couldNotLoadQueueStatus: string;
  tokenNumberLabel: string;
  estimatedWaitLabel: string;
  headOverNowMessage: string;
  withBarberPrefix: string;
  turnAlmostHereToast: string;
  waitChangedToast: string;
  findASalonSearchTitle: string;
  searchAction: string;
  locatingAction: string;
  nearMeFound: string;
  couldNotSearchSalons: string;
  locationDenied: string;
  couldNotGetLocation: string;
  noSalonsFoundTitle: string;
  noSalonsFoundHint: string;
  openNowLabel: string;
  closedNowLabel: string;
  kmAwaySuffix: string;
  couldNotLoadSalon: string;
  salonNotFound: string;
  photoGalleryHint: string;
  photosTapToView: string;
  verifiedBadge: string;
  reviewsSuffix: string;
  joinQueueNow: string;
  meetTheTeam: string;
  bookingForTheLookPrefix: string;
  bookingForTheLookSuffix: string;
  searchByNamePlaceholder: string;
  reviewsTitle: string;

  // PhoneOtpLoginScreen (customer sign-in).
  continueWithGoogle: string;
  couldNotSignInWithGoogle: string;
  signInUnavailableNotice: string;
  orDivider: string;
  invalidPhoneNumber: string;
  couldNotSendOtp: string;
  newCodeSent: string;
  couldNotResendCode: string;
  invalidCode: string;
  couldNotVerifyOtp: string;
  otpSubtitleGoogleOnly: string;
  otpSubtitleBoth: string;
  enterCodeSentToPrefix: string;
  phoneOtpUnavailableNotice: string;
  phoneNumberPlaceholder: string;
  otpCodePlaceholder: string;
  sendOtpAction: string;
  verifyAndContinueAction: string;
  resendOtpAction: string;
  resendOtpInPrefix: string;
  resendOtpInSuffix: string;
  cancellingWillChargePrefix: string;
  cancellingWillChargeSuffix: string;
  noChargeFreeWindow: string;
  barberPrefix: string;
  minutesAbbrev: string;
  yearsExpAbbrev: string;
  yearsExperienceWord: string;
}

const enUi: UiStrings = {
  city: 'City',
  service: 'Service',
  search: 'Search',
  searchPlaceholder: 'Search shops or services…',
  nearMe: 'Near me',
  book: 'Book an appointment',
  joinQueue: 'Join live queue',
  confirm: 'Confirm booking',
  cancel: 'Cancel booking',
  keepBooking: 'Keep booking',
  waiting: 'Waiting',
  yourTurn: "It's your turn",
  called: "You're being called",
  inService: 'In service',
  signIn: 'Sign in',
  signInWithGoogle: 'Sign in with Google',
  notifications: 'Notifications',
  noNotifications: "You're all caught up",
  markAllRead: 'Mark all read',
  retry: 'Try again',
  open: 'Open now',
  closed: 'Closed',
  noResults: 'No results found',
  loading: 'Loading…',
  outstandingDue: 'Outstanding due',
  freeCancellation: 'Free cancellation',
  statusConfirmed: 'Confirmed',
  statusPendingPayment: 'Payment pending',
  statusCancelled: 'Cancelled',
  statusCompleted: 'Completed',
  statusNoShow: 'No-show',
  statusExpired: 'Expired',
  genericError: 'Something went wrong. Please try again.',
  offline: "You appear to be offline.",

  tabHome: 'Home',
  tabSearch: 'Search',
  tabBookings: 'Bookings',
  tabQueue: 'Queue',
  tabAccount: 'Account',
  tabDashboard: 'Dashboard',
  tabShop: 'Shop',
  tabToday: 'Today',

  yourAccount: 'Your account',
  email: 'Email',
  phone: 'Phone',
  accountType: 'Account type',
  signedInDevices: 'Signed-in devices',
  thisDevice: 'this device',
  signOut: 'Sign out',
  signOutThisDevice: 'Log out of this device',
  language: 'Language',

  dashboardTitle: 'Dashboard',
  manageShop: 'Manage shop',
  servicesLabel: 'Services',
  chairsLabel: 'Chairs',
  staffLabel: 'Staff',
  hoursLabel: 'Hours',
  photosLabel: 'Photos',
  customersLabel: 'Customers',
  customerLabel: 'Customer',
  addService: 'Add service',
  addChair: 'Add chair',
  addBarber: 'Add barber',
  addPhoto: 'Add photo',
  saveAction: 'Save',
  editAction: 'Edit',
  removeAction: 'Remove',
  cancelAction: 'Cancel',
  activateAction: 'Activate',
  deactivateAction: 'Deactivate',
  viewCustomers: 'View customers',
  todayTitle: 'Today',
  filterToday: 'Today',
  filterUpcoming: 'Upcoming',
  filterCompleted: 'Completed',
  filterCancelled: 'Cancelled',
  filterNoShow: 'No-show',
  filterHistory: 'History',
  loadMore: 'Load more',

  findAShop: 'Find a shop',
  browseHint: 'Book or join a live queue — no sign-in needed to look around.',
  orContinueAs: 'Or continue as',
  alreadyKnowAccount: 'Already know your account?',
  roleCustomer: 'Customer',
  roleCustomerSubtitle: 'Book a chair or join a live queue',
  roleOwner: 'Shop Owner',
  roleOwnerSubtitle: 'Run your salon, queue, and team',
  roleStaff: 'Barber / Staff',
  roleStaffSubtitle: "Work today's queue and bookings",

  welcomeBack: 'Welcome back',
  welcomeSubtitle: 'Book ahead, or join a live queue near you.',
  liveQueueLabel: 'Live queue',
  tokenNumberPrefix: 'Token #',
  calledMessage: "You're being called — please head to the counter!",
  positionPrefix: 'Position ',
  positionSuffix: ' in line',
  viewQueueStatus: 'View queue status',
  upcomingBookingLabel: 'Upcoming booking',
  viewBookingAction: 'View booking',
  bookAheadKicker: 'Book ahead',
  reserveChair: 'Reserve a chair',
  serviceBarberTime: 'Service → barber → time',
  joinLiveKicker: 'Join live',
  skipTheWait: 'Skip the wait',
  findShopJoinQueue: 'Find a shop, join the queue',
  myBookings: 'My bookings',
  aiStyleAdvisor: 'AI Style Advisor',
  accountAndPremium: 'Account & Premium',

  notSet: 'Not set',
  unknownDevice: 'Unknown device',
  signedInOnPrefix: 'Signed in ',
  signingOut: 'Signing out…',

  statusPrefix: 'Status: ',
  activeService: 'Active service',
  activeChair: 'Active chair',
  activeBarber: 'Active barber',
  closeShop: 'Close shop',
  openShop: 'Open shop',
  todaysBookings: "Today's bookings",
  completedTodayLabel: 'Completed today',
  cancelledNoShowToday: 'Cancelled / no-show today',
  liveQueue: 'Live queue',
  registerShopHint: 'Register a shop on the FastQue web dashboard to manage it here.',

  bookingsTitle: 'Bookings',
  newBookingReceivedBanner: 'New booking received',
  bookingCancelledBanner: 'Booking cancelled',
  noShopSelected: 'No shop selected',
  selectShopHint: 'Select a shop from the Dashboard tab to see its bookings.',
  noBookingsTitle: 'No bookings',
  noBookingsHint: 'Nothing in this view yet.',
  newBadge: 'NEW',
  preferredPrefix: 'Pref: ',

  selectShopTitle: 'Select a shop',
  chooseShopHint: 'Choose a shop from the Dashboard tab first.',
  shopSubtitle: 'Services, chairs, staff, and hours',
  noServicesYet: 'No services yet.',
  noChairsYet: 'No chairs yet.',
  noBarbersYet: 'No barbers added yet.',
  customersHint: 'Visit history, dues, and no-show waivers for everyone who has booked at your shop.',
  coverPhotoHint: 'Your cover photo is what customers see first when they find you.',
  noPhotosYet: 'No photos yet.',
  replaceCoverPhoto: 'Replace cover photo',
  addCoverPhoto: 'Add cover photo',
  addGalleryPhoto: 'Add gallery photo',

  noShopYetTitle: 'No shop yet',
  noShopYetHint: 'Ask your shop owner to add you as staff on the FastQue web dashboard.',
  todaysQueue: "Today's queue",

  findASalonTitle: 'Find a salon',
  salonTitle: 'Salon',
  chooseABarberTitle: 'Choose a barber',
  chooseADateTitle: 'Choose a date',
  chooseATimeTitle: 'Choose a time',
  confirmTitle: 'Confirm',
  queueTitle: 'Queue',
  bookingTitle: 'Booking',
  signInTitle: 'Sign in',
  passwordRecoveryTitle: 'Password recovery',
  homeButtonLabel: 'Home',

  accountDetailsCard: 'Account details',
  contactDetailsSubtitle: 'Contact details, security, and shortcuts.',
  couldNotLoadSessions: 'Could not load your sessions.',
  couldNotSignOutSession: 'Could not sign out that session.',
  couldNotSignOutOtherSessions: 'Could not sign out other sessions.',
  voiceHint: 'Also controls voice announcements read aloud on this device.',
  premiumActive: 'Active',
  premiumInactive: 'Not subscribed — manage on web',
  noActiveSessions: 'No active sessions were returned for this account.',
  signOutOtherSessions: 'Sign out of other sessions',
  roleCustomerLabel: 'Customer',
  roleStaffLabel: 'Salon Staff',
  roleOwnerLabel: 'Salon Owner',
  roleAdminLabel: 'Platform Admin',
  premiumLabel: 'Premium',

  anyStaffOption: 'Any Staff',
  staffSelectHint: 'This is a preference, not a guarantee — the salon assigns the actual barber and chair when you check in.',
  slotsClosedLabel: 'Closed',
  noSlotsTitle: 'No slots on this day',
  noSlotsHint: 'Try a different date.',
  availableLegend: '● Available',
  occupiedLegend: '● Occupied',
  availableWord: 'available',
  occupiedWord: 'occupied',
  timeAvailabilityLegend: 'Time availability legend',
  couldNotLoadTimes: 'Could not load available times.',
  couldNotLoadStaff: 'Could not load staff.',
  getDirections: 'Get Directions',
  shareAction: 'Share',
  shareOnWhatsApp: 'Share on WhatsApp',
  bookAgainAction: 'Book again',
  cancelBookingAction: 'Cancel booking',
  hideRescheduleAction: 'Hide reschedule',
  rescheduleAction: 'Reschedule',
  cancelBookingConfirmTitle: 'Cancel booking?',
  confirmCancellationAction: 'Confirm cancellation',
  checkInAction: 'Check in',
  statusLabelPrefix: 'Status: ',
  preferredBarberPrefix: 'Preferred barber: ',
  styleLabelPrefix: 'Style: ',
  prepaymentRequiredPrefix: 'Prepayment required: ',
  cancellationChargePrefix: 'Cancellation charge: ',
  bookingIdPrefix: 'Booking ID: ',
  couldNotLoadBooking: 'Could not load this booking.',
  couldNotShare: 'Could not open the share sheet.',
  couldNotLoadCancellationPolicy: 'Could not load the cancellation policy.',
  couldNotCancelBooking: 'Could not cancel this booking.',
  couldNotCheckIn: 'Could not check in. Please try again.',
  couldNotCreateBooking: 'Could not create the booking. Please try again.',
  bookingConfirmedTitle: 'Booking confirmed',
  confirmBookingTitle: 'Confirm booking',
  viewMyBookings: 'View my bookings',
  freeCancellationUpTo: 'Free cancellation up to ',
  beforeYourAppointment: ' before your appointment.',
  hoursSingular: 'hour',
  hoursPlural: 'hours',
  minutesSuffix: 'minutes',
  myBookingsTitle: 'My bookings',
  noBookingsYetTitle: 'No bookings yet',
  noBookingsYetHint: 'Find a salon and book your next visit.',
  viewDetailsAction: 'View details',
  couldNotLoadBookings: 'Could not load your bookings.',
  couldNotJoinQueue: 'Could not join the queue. Please try again.',
  alreadyInQueueTitle: 'Already in a queue',
  alreadyInQueueHint: 'You already have an active queue token at another salon. Finish or cancel it before joining here.',
  youreInLineTitle: "You're in line",
  joinTheQueueTitle: 'Join the queue',
  serviceOptional: 'Service (optional)',
  anyServiceOption: 'Any service',
  queueStatusTitle: 'Queue status',
  noActiveQueueTitle: 'No active queue',
  noActiveQueueHint: 'Join a live queue at a nearby shop and follow your position here.',
  findASalonAction: 'Find a salon',
  couldNotLoadQueueStatus: 'Could not load your queue status.',
  tokenNumberLabel: 'Token #',
  estimatedWaitLabel: 'Estimated wait: ',
  headOverNowMessage: "Please head over now — you're almost up.",
  withBarberPrefix: 'With ',
  turnAlmostHereToast: 'Your turn is almost here! Tap to dismiss.',
  waitChangedToast: 'Your wait time changed. Tap to dismiss.',
  findASalonSearchTitle: 'Find a salon',
  searchAction: 'Search',
  locatingAction: 'Locating…',
  nearMeFound: 'Near me ✓',
  couldNotSearchSalons: 'Could not search salons.',
  locationDenied: 'Location permission was denied. Try searching by name instead.',
  couldNotGetLocation: "Couldn't get your location. Try searching by name instead.",
  noSalonsFoundTitle: 'No salons found',
  noSalonsFoundHint: 'Try a different name, or clear the search to browse everything.',
  openNowLabel: 'Open now',
  closedNowLabel: 'Closed now',
  kmAwaySuffix: ' km away',
  couldNotLoadSalon: 'Could not load this salon.',
  salonNotFound: 'Salon not found.',
  photoGalleryHint: 'Opens full-screen photo gallery',
  photosTapToView: 'photo(s) · tap to view',
  verifiedBadge: '✓ Verified',
  reviewsSuffix: 'review(s)',
  joinQueueNow: 'Join queue now',
  meetTheTeam: 'Meet the team',
  bookingForTheLookPrefix: 'Booking for the ',
  bookingForTheLookSuffix: ' look — pick a shop to continue.',
  searchByNamePlaceholder: 'Search by name…',
  reviewsTitle: 'Reviews',

  continueWithGoogle: 'Continue with Google',
  couldNotSignInWithGoogle: 'Could not sign in with Google. Please try again.',
  signInUnavailableNotice: 'Sign-in is temporarily unavailable. Please try again shortly.',
  orDivider: 'or',
  invalidPhoneNumber: 'Invalid phone number.',
  couldNotSendOtp: 'Could not send OTP. Please try again.',
  newCodeSent: 'A new code has been sent.',
  couldNotResendCode: 'Could not resend the code. Please try again.',
  invalidCode: 'Invalid code.',
  couldNotVerifyOtp: 'Could not verify OTP. Please try again.',
  otpSubtitleGoogleOnly: 'Continue with Google. New here? This creates your account automatically.',
  otpSubtitleBoth: 'Continue with Google, or use a one-time code. New here? This creates your account automatically.',
  enterCodeSentToPrefix: 'Enter the code sent to ',
  phoneOtpUnavailableNotice: "Phone sign-in is temporarily unavailable. Please continue with Google above — it's the same account either way.",
  phoneNumberPlaceholder: '+919876543210',
  otpCodePlaceholder: '6-digit code',
  sendOtpAction: 'Send OTP',
  verifyAndContinueAction: 'Verify & Continue',
  resendOtpAction: 'Resend OTP',
  resendOtpInPrefix: 'Resend OTP in ',
  resendOtpInSuffix: 's',
  cancellingWillChargePrefix: 'Cancelling now will charge ',
  cancellingWillChargeSuffix: ' (outside the free cancellation window).',
  noChargeFreeWindow: "No charge — you're within the free cancellation window.",
  barberPrefix: 'Barber: ',
  minutesAbbrev: 'min',
  yearsExpAbbrev: 'yr(s) exp.',
  yearsExperienceWord: 'years experience',
};

const hiUi: UiStrings = {
  city: 'शहर',
  service: 'सेवा',
  search: 'खोजें',
  searchPlaceholder: 'दुकान या सेवा खोजें…',
  nearMe: 'मेरे पास',
  book: 'अपॉइंटमेंट बुक करें',
  joinQueue: 'लाइव कतार में शामिल हों',
  confirm: 'बुकिंग की पुष्टि करें',
  cancel: 'बुकिंग रद्द करें',
  keepBooking: 'बुकिंग रखें',
  waiting: 'प्रतीक्षा में',
  yourTurn: 'आपकी बारी आ गई है',
  called: 'आपको बुलाया जा रहा है',
  inService: 'सेवा जारी है',
  signIn: 'साइन इन करें',
  signInWithGoogle: 'Google से साइन इन करें',
  notifications: 'सूचनाएं',
  noNotifications: 'आप पूरी तरह अपडेट हैं',
  markAllRead: 'सभी को पढ़ा हुआ चिह्नित करें',
  retry: 'फिर कोशिश करें',
  open: 'अभी खुला है',
  closed: 'बंद है',
  noResults: 'कोई परिणाम नहीं मिला',
  loading: 'लोड हो रहा है…',
  outstandingDue: 'बकाया राशि',
  freeCancellation: 'मुफ़्त रद्दीकरण',
  statusConfirmed: 'पुष्टि हो गई',
  statusPendingPayment: 'भुगतान लंबित',
  statusCancelled: 'रद्द',
  statusCompleted: 'पूर्ण',
  statusNoShow: 'नो-शो',
  statusExpired: 'समाप्त',
  genericError: 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।',
  offline: 'लगता है आप ऑफ़लाइन हैं।',

  tabHome: 'होम',
  tabSearch: 'खोजें',
  tabBookings: 'बुकिंग्स',
  tabQueue: 'कतार',
  tabAccount: 'खाता',
  tabDashboard: 'डैशबोर्ड',
  tabShop: 'दुकान',
  tabToday: 'आज',

  yourAccount: 'आपका खाता',
  email: 'ईमेल',
  phone: 'फ़ोन',
  accountType: 'खाता प्रकार',
  signedInDevices: 'साइन-इन डिवाइस',
  thisDevice: 'यह डिवाइस',
  signOut: 'साइन आउट करें',
  signOutThisDevice: 'इस डिवाइस से लॉग आउट करें',
  language: 'भाषा',

  dashboardTitle: 'डैशबोर्ड',
  manageShop: 'दुकान प्रबंधित करें',
  servicesLabel: 'सेवाएं',
  chairsLabel: 'कुर्सियां',
  staffLabel: 'स्टाफ',
  hoursLabel: 'समय',
  photosLabel: 'फ़ोटो',
  customersLabel: 'ग्राहक',
  customerLabel: 'ग्राहक',
  addService: 'सेवा जोड़ें',
  addChair: 'कुर्सी जोड़ें',
  addBarber: 'बार्बर जोड़ें',
  addPhoto: 'फ़ोटो जोड़ें',
  saveAction: 'सहेजें',
  editAction: 'संपादित करें',
  removeAction: 'हटाएं',
  cancelAction: 'रद्द करें',
  activateAction: 'सक्रिय करें',
  deactivateAction: 'निष्क्रिय करें',
  viewCustomers: 'ग्राहक देखें',
  todayTitle: 'आज',
  filterToday: 'आज',
  filterUpcoming: 'आगामी',
  filterCompleted: 'पूर्ण',
  filterCancelled: 'रद्द',
  filterNoShow: 'नो-शो',
  filterHistory: 'इतिहास',
  loadMore: 'और लोड करें',

  findAShop: 'दुकान खोजें',
  browseHint: 'बुक करें या लाइव कतार में शामिल हों — देखने के लिए साइन-इन ज़रूरी नहीं।',
  orContinueAs: 'या इस रूप में जारी रखें',
  alreadyKnowAccount: 'क्या आपके पास पहले से खाता है?',
  roleCustomer: 'ग्राहक',
  roleCustomerSubtitle: 'कुर्सी बुक करें या लाइव कतार में शामिल हों',
  roleOwner: 'दुकान मालिक',
  roleOwnerSubtitle: 'अपना सैलून, कतार और टीम चलाएं',
  roleStaff: 'बार्बर / स्टाफ',
  roleStaffSubtitle: 'आज की कतार और बुकिंग्स संभालें',

  welcomeBack: 'वापसी पर स्वागत है',
  welcomeSubtitle: 'पहले से बुक करें, या पास की लाइव कतार में शामिल हों।',
  liveQueueLabel: 'लाइव कतार',
  tokenNumberPrefix: 'टोकन #',
  calledMessage: 'आपको बुलाया जा रहा है — कृपया काउंटर पर आएं!',
  positionPrefix: 'लाइन में स्थान ',
  positionSuffix: '',
  viewQueueStatus: 'कतार की स्थिति देखें',
  upcomingBookingLabel: 'आगामी बुकिंग',
  viewBookingAction: 'बुकिंग देखें',
  bookAheadKicker: 'पहले से बुक करें',
  reserveChair: 'कुर्सी आरक्षित करें',
  serviceBarberTime: 'सेवा → बार्बर → समय',
  joinLiveKicker: 'लाइव में शामिल हों',
  skipTheWait: 'प्रतीक्षा छोड़ें',
  findShopJoinQueue: 'दुकान खोजें, कतार में शामिल हों',
  myBookings: 'मेरी बुकिंग्स',
  aiStyleAdvisor: 'AI स्टाइल सलाहकार',
  accountAndPremium: 'खाता और प्रीमियम',

  notSet: 'सेट नहीं है',
  unknownDevice: 'अज्ञात डिवाइस',
  signedInOnPrefix: 'साइन-इन किया ',
  signingOut: 'साइन आउट हो रहा है…',

  statusPrefix: 'स्थिति: ',
  activeService: 'सक्रिय सेवा',
  activeChair: 'सक्रिय कुर्सी',
  activeBarber: 'सक्रिय बार्बर',
  closeShop: 'दुकान बंद करें',
  openShop: 'दुकान खोलें',
  todaysBookings: 'आज की बुकिंग्स',
  completedTodayLabel: 'आज पूर्ण हुईं',
  cancelledNoShowToday: 'आज रद्द / नो-शो',
  liveQueue: 'लाइव कतार',
  registerShopHint: 'इसे प्रबंधित करने के लिए FastQue वेब डैशबोर्ड पर अपनी दुकान पंजीकृत करें।',

  bookingsTitle: 'बुकिंग्स',
  newBookingReceivedBanner: 'नई बुकिंग प्राप्त हुई',
  bookingCancelledBanner: 'बुकिंग रद्द हुई',
  noShopSelected: 'कोई दुकान चयनित नहीं',
  selectShopHint: 'इसकी बुकिंग्स देखने के लिए डैशबोर्ड टैब से एक दुकान चुनें।',
  noBookingsTitle: 'कोई बुकिंग नहीं',
  noBookingsHint: 'इस दृश्य में अभी कुछ नहीं है।',
  newBadge: 'नई',
  preferredPrefix: 'पसंदीदा: ',

  selectShopTitle: 'एक दुकान चुनें',
  chooseShopHint: 'पहले डैशबोर्ड टैब से एक दुकान चुनें।',
  shopSubtitle: 'सेवाएं, कुर्सियां, स्टाफ और समय',
  noServicesYet: 'अभी कोई सेवा नहीं है।',
  noChairsYet: 'अभी कोई कुर्सी नहीं है।',
  noBarbersYet: 'अभी कोई बार्बर नहीं जोड़ा गया।',
  customersHint: 'आपकी दुकान पर बुकिंग करने वाले हर ग्राहक का विज़िट इतिहास, बकाया और नो-शो छूट।',
  coverPhotoHint: 'आपकी कवर फ़ोटो वह है जिसे ग्राहक आपको खोजते समय सबसे पहले देखते हैं।',
  noPhotosYet: 'अभी कोई फ़ोटो नहीं है।',
  replaceCoverPhoto: 'कवर फ़ोटो बदलें',
  addCoverPhoto: 'कवर फ़ोटो जोड़ें',
  addGalleryPhoto: 'गैलरी फ़ोटो जोड़ें',

  noShopYetTitle: 'अभी कोई दुकान नहीं',
  noShopYetHint: 'अपने दुकान मालिक से FastQue वेब डैशबोर्ड पर आपको स्टाफ के रूप में जोड़ने के लिए कहें।',
  todaysQueue: 'आज की कतार',

  findASalonTitle: 'सैलून खोजें',
  salonTitle: 'सैलून',
  chooseABarberTitle: 'बार्बर चुनें',
  chooseADateTitle: 'तारीख चुनें',
  chooseATimeTitle: 'समय चुनें',
  confirmTitle: 'पुष्टि करें',
  queueTitle: 'कतार',
  bookingTitle: 'बुकिंग',
  signInTitle: 'साइन इन करें',
  passwordRecoveryTitle: 'पासवर्ड पुनर्प्राप्ति',
  homeButtonLabel: 'होम',

  accountDetailsCard: 'खाता विवरण',
  contactDetailsSubtitle: 'संपर्क विवरण, सुरक्षा और शॉर्टकट।',
  couldNotLoadSessions: 'आपके सत्र लोड नहीं हो सके।',
  couldNotSignOutSession: 'उस सत्र से साइन आउट नहीं हो सका।',
  couldNotSignOutOtherSessions: 'अन्य सत्रों से साइन आउट नहीं हो सका।',
  voiceHint: 'यह डिवाइस पर बोली जाने वाली आवाज़ सूचनाओं को भी नियंत्रित करता है।',
  premiumActive: 'सक्रिय',
  premiumInactive: 'सदस्यता नहीं है — वेब पर प्रबंधित करें',
  noActiveSessions: 'इस खाते के लिए कोई सक्रिय सत्र नहीं मिला।',
  signOutOtherSessions: 'अन्य सत्रों से साइन आउट करें',
  roleCustomerLabel: 'ग्राहक',
  roleStaffLabel: 'सैलून स्टाफ',
  roleOwnerLabel: 'सैलून मालिक',
  roleAdminLabel: 'प्लेटफ़ॉर्म एडमिन',
  premiumLabel: 'प्रीमियम',

  anyStaffOption: 'कोई भी स्टाफ',
  staffSelectHint: 'यह एक पसंद है, गारंटी नहीं — चेक-इन के समय सैलून ही असली बार्बर और कुर्सी तय करता है।',
  slotsClosedLabel: 'बंद है',
  noSlotsTitle: 'इस दिन कोई स्लॉट नहीं',
  noSlotsHint: 'कोई और तारीख आज़माएं।',
  availableLegend: '● उपलब्ध',
  occupiedLegend: '● व्यस्त',
  availableWord: 'उपलब्ध',
  occupiedWord: 'व्यस्त',
  timeAvailabilityLegend: 'समय उपलब्धता सूचक',
  couldNotLoadTimes: 'उपलब्ध समय लोड नहीं हो सके।',
  couldNotLoadStaff: 'स्टाफ लोड नहीं हो सका।',
  getDirections: 'दिशा-निर्देश पाएं',
  shareAction: 'शेयर करें',
  shareOnWhatsApp: 'WhatsApp पर शेयर करें',
  bookAgainAction: 'फिर से बुक करें',
  cancelBookingAction: 'बुकिंग रद्द करें',
  hideRescheduleAction: 'पुनर्निर्धारण छुपाएं',
  rescheduleAction: 'पुनर्निर्धारित करें',
  cancelBookingConfirmTitle: 'बुकिंग रद्द करें?',
  confirmCancellationAction: 'रद्दीकरण की पुष्टि करें',
  checkInAction: 'चेक इन करें',
  statusLabelPrefix: 'स्थिति: ',
  preferredBarberPrefix: 'पसंदीदा बार्बर: ',
  styleLabelPrefix: 'स्टाइल: ',
  prepaymentRequiredPrefix: 'अग्रिम भुगतान आवश्यक: ',
  cancellationChargePrefix: 'रद्दीकरण शुल्क: ',
  bookingIdPrefix: 'बुकिंग आईडी: ',
  couldNotLoadBooking: 'यह बुकिंग लोड नहीं हो सकी।',
  couldNotShare: 'शेयर शीट नहीं खुल सकी।',
  couldNotLoadCancellationPolicy: 'रद्दीकरण नीति लोड नहीं हो सकी।',
  couldNotCancelBooking: 'यह बुकिंग रद्द नहीं हो सकी।',
  couldNotCheckIn: 'चेक इन नहीं हो सका। कृपया फिर कोशिश करें।',
  couldNotCreateBooking: 'बुकिंग नहीं बन सकी। कृपया फिर कोशिश करें।',
  bookingConfirmedTitle: 'बुकिंग की पुष्टि हो गई',
  confirmBookingTitle: 'बुकिंग की पुष्टि करें',
  viewMyBookings: 'मेरी बुकिंग्स देखें',
  freeCancellationUpTo: 'मुफ़्त रद्दीकरण अपॉइंटमेंट से ',
  beforeYourAppointment: ' पहले तक।',
  hoursSingular: 'घंटा',
  hoursPlural: 'घंटे',
  minutesSuffix: 'मिनट',
  myBookingsTitle: 'मेरी बुकिंग्स',
  noBookingsYetTitle: 'अभी कोई बुकिंग नहीं',
  noBookingsYetHint: 'सैलून खोजें और अपनी अगली विज़िट बुक करें।',
  viewDetailsAction: 'विवरण देखें',
  couldNotLoadBookings: 'आपकी बुकिंग्स लोड नहीं हो सकीं।',
  couldNotJoinQueue: 'कतार में शामिल नहीं हो सके। कृपया फिर कोशिश करें।',
  alreadyInQueueTitle: 'पहले से कतार में',
  alreadyInQueueHint: 'आपके पास पहले से किसी और सैलून में सक्रिय कतार टोकन है। यहां शामिल होने से पहले उसे पूरा करें या रद्द करें।',
  youreInLineTitle: 'आप कतार में हैं',
  joinTheQueueTitle: 'कतार में शामिल हों',
  serviceOptional: 'सेवा (वैकल्पिक)',
  anyServiceOption: 'कोई भी सेवा',
  queueStatusTitle: 'कतार की स्थिति',
  noActiveQueueTitle: 'कोई सक्रिय कतार नहीं',
  noActiveQueueHint: 'पास की किसी दुकान की लाइव कतार में शामिल हों और यहां अपनी स्थिति देखें।',
  findASalonAction: 'सैलून खोजें',
  couldNotLoadQueueStatus: 'आपकी कतार स्थिति लोड नहीं हो सकी।',
  tokenNumberLabel: 'टोकन #',
  estimatedWaitLabel: 'अनुमानित प्रतीक्षा: ',
  headOverNowMessage: 'कृपया अभी आएं — आपकी बारी लगभग आ गई है।',
  withBarberPrefix: 'साथ में ',
  turnAlmostHereToast: 'आपकी बारी लगभग आने वाली है! खारिज करने के लिए टैप करें।',
  waitChangedToast: 'आपका प्रतीक्षा समय बदल गया है। खारिज करने के लिए टैप करें।',
  findASalonSearchTitle: 'सैलून खोजें',
  searchAction: 'खोजें',
  locatingAction: 'स्थान ढूंढ रहे हैं…',
  nearMeFound: 'मेरे पास ✓',
  couldNotSearchSalons: 'सैलून खोजे नहीं जा सके।',
  locationDenied: 'लोकेशन अनुमति अस्वीकृत हुई। नाम से खोजने का प्रयास करें।',
  couldNotGetLocation: 'आपका स्थान नहीं मिल सका। नाम से खोजने का प्रयास करें।',
  noSalonsFoundTitle: 'कोई सैलून नहीं मिला',
  noSalonsFoundHint: 'कोई और नाम आज़माएं, या सब कुछ देखने के लिए खोज साफ़ करें।',
  openNowLabel: 'अभी खुला है',
  closedNowLabel: 'अभी बंद है',
  kmAwaySuffix: ' किमी दूर',
  couldNotLoadSalon: 'यह सैलून लोड नहीं हो सका।',
  salonNotFound: 'सैलून नहीं मिला।',
  photoGalleryHint: 'पूर्ण-स्क्रीन फ़ोटो गैलरी खोलता है',
  photosTapToView: 'फ़ोटो · देखने के लिए टैप करें',
  verifiedBadge: '✓ सत्यापित',
  reviewsSuffix: 'समीक्षा',
  joinQueueNow: 'अभी कतार में शामिल हों',
  meetTheTeam: 'टीम से मिलें',
  bookingForTheLookPrefix: '',
  bookingForTheLookSuffix: ' लुक के लिए बुकिंग — जारी रखने के लिए दुकान चुनें।',
  searchByNamePlaceholder: 'नाम से खोजें…',
  reviewsTitle: 'समीक्षाएं',

  continueWithGoogle: 'Google से जारी रखें',
  couldNotSignInWithGoogle: 'Google से साइन इन नहीं हो सका। कृपया फिर कोशिश करें।',
  signInUnavailableNotice: 'साइन-इन अस्थायी रूप से उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।',
  orDivider: 'या',
  invalidPhoneNumber: 'अमान्य फ़ोन नंबर।',
  couldNotSendOtp: 'OTP भेजा नहीं जा सका। कृपया फिर कोशिश करें।',
  newCodeSent: 'नया कोड भेज दिया गया है।',
  couldNotResendCode: 'कोड फिर से नहीं भेजा जा सका। कृपया फिर कोशिश करें।',
  invalidCode: 'अमान्य कोड।',
  couldNotVerifyOtp: 'OTP सत्यापित नहीं हो सका। कृपया फिर कोशिश करें।',
  otpSubtitleGoogleOnly: 'Google से जारी रखें। नए हैं? इससे आपका खाता अपने आप बन जाएगा।',
  otpSubtitleBoth: 'Google से जारी रखें, या वन-टाइम कोड का उपयोग करें। नए हैं? इससे आपका खाता अपने आप बन जाएगा।',
  enterCodeSentToPrefix: 'भेजा गया कोड डालें ',
  phoneOtpUnavailableNotice: 'फ़ोन साइन-इन अस्थायी रूप से उपलब्ध नहीं है। कृपया ऊपर Google से जारी रखें — यह वही खाता है।',
  phoneNumberPlaceholder: '+919876543210',
  otpCodePlaceholder: '6-अंकीय कोड',
  sendOtpAction: 'OTP भेजें',
  verifyAndContinueAction: 'सत्यापित करें और जारी रखें',
  resendOtpAction: 'OTP फिर भेजें',
  resendOtpInPrefix: 'OTP फिर भेजें ',
  resendOtpInSuffix: ' सेकंड में',
  cancellingWillChargePrefix: 'अभी रद्द करने पर ',
  cancellingWillChargeSuffix: ' शुल्क लगेगा (मुफ़्त रद्दीकरण विंडो के बाहर)।',
  noChargeFreeWindow: 'कोई शुल्क नहीं — आप मुफ़्त रद्दीकरण विंडो में हैं।',
  barberPrefix: 'बार्बर: ',
  minutesAbbrev: 'मिनट',
  yearsExpAbbrev: 'वर्ष अनुभव',
  yearsExperienceWord: 'वर्ष अनुभव',
};

export const UI_STRINGS: Readonly<Record<Language, UiStrings>> = {
  [Language.EN]: enUi,
  [Language.HI]: hiUi,
};

/** Never throws on an unrecognised value — same "unknown/unset -> English" default as
 * voiceAnnouncementsFor, so a fresh/anonymous session always renders something correct. */
export function uiStringsFor(language: Language | null | undefined): UiStrings {
  return (language && UI_STRINGS[language]) || UI_STRINGS[Language.EN];
}

/**
 * In-app Notification Center list labels, keyed by the same NotificationType every backend
 * `notify()` call already produces (see notifications.service.ts's TYPE_CATEGORY — this is that
 * same exhaustiveness guarantee applied to display copy instead of category routing). Fixes a
 * real Build 9 physical-device defect: NotificationsScreen previously kept its own
 * English-only `TYPE_LABEL` map entirely outside the language system, so the screen heading could
 * read in Hindi while every notification title underneath it stayed English regardless of the
 * owner's selected language.
 */
export type NotificationTypeLabels = Readonly<Record<NotificationType, string>>;

const enNotificationTypeLabels: NotificationTypeLabels = {
  'booking.confirmed': 'Booking confirmed',
  'booking.cancelled': 'Booking cancelled',
  'booking.no_show': 'Marked as no-show',
  'booking.expired': 'Booking expired',
  'booking.reminder': 'Upcoming appointment',
  'queue.turn_approaching': 'Your turn is approaching',
  'owner.booking.created': 'New booking',
  'owner.booking.cancelled': 'Booking cancelled',
  'owner.booking.no_show': 'Customer no-show',
  'owner.booking.expired': 'Booking expired',
  'owner.walk_in.joined': 'New walk-in',
  'staff.assigned': 'You were assigned a customer',
};

const hiNotificationTypeLabels: NotificationTypeLabels = {
  'booking.confirmed': 'बुकिंग की पुष्टि हुई',
  'booking.cancelled': 'बुकिंग रद्द हुई',
  'booking.no_show': 'नो-शो के रूप में चिह्नित',
  'booking.expired': 'बुकिंग समाप्त हो गई',
  'booking.reminder': 'आगामी अपॉइंटमेंट',
  'queue.turn_approaching': 'आपकी बारी आने वाली है',
  'owner.booking.created': 'नई बुकिंग',
  'owner.booking.cancelled': 'बुकिंग रद्द हुई',
  'owner.booking.no_show': 'ग्राहक नो-शो',
  'owner.booking.expired': 'बुकिंग समाप्त हो गई',
  'owner.walk_in.joined': 'नया वॉक-इन',
  'staff.assigned': 'आपको एक ग्राहक सौंपा गया',
};

export const NOTIFICATION_TYPE_LABELS: Readonly<Record<Language, NotificationTypeLabels>> = {
  [Language.EN]: enNotificationTypeLabels,
  [Language.HI]: hiNotificationTypeLabels,
};

/** Never throws on an unrecognised type/language — falls back to English labels, then to the raw
 * type string itself, so a future NotificationType added to the enum without a translation entry
 * degrades to something readable rather than crashing the list. */
export function notificationTypeLabel(
  language: Language | null | undefined,
  type: NotificationType,
): string {
  const table = (language && NOTIFICATION_TYPE_LABELS[language]) || NOTIFICATION_TYPE_LABELS[Language.EN];
  return table[type] ?? enNotificationTypeLabels[type] ?? type;
}

/**
 * OS push notification title/body — generated server-side (bookings.service.ts), so unlike every
 * other string in this file it is never rendered through a client-side React tree. Split out from
 * VoiceAnnouncements/UiStrings because a push payload is title+body, not a single sentence, and
 * because the backend is the only caller. Fixes a real Build 9 physical-device defect: the push
 * title/body were previously hardcoded English literals at the dispatchToUser call site,
 * completely bypassing the recipient owner's preferredLanguage.
 */
export interface PushCopy {
  newBooking(serviceName: string | null): { title: string; body: string };
  bookingCancelled(serviceName: string | null): { title: string; body: string };
}

const enPush: PushCopy = {
  newBooking: (serviceName) => ({
    title: 'New booking',
    body: serviceName ? `${serviceName} booked for your shop.` : 'A new booking was made for your shop.',
  }),
  bookingCancelled: (serviceName) => ({
    title: 'Booking cancelled',
    body: serviceName ? `${serviceName} booking was cancelled.` : 'A booking at your shop was cancelled.',
  }),
};

const hiPush: PushCopy = {
  newBooking: (serviceName) => ({
    title: 'नई बुकिंग',
    body: serviceName ? `आपकी दुकान के लिए ${serviceName} बुक हुई।` : 'आपकी दुकान के लिए एक नई बुकिंग हुई।',
  }),
  bookingCancelled: (serviceName) => ({
    title: 'बुकिंग रद्द हुई',
    body: serviceName ? `${serviceName} बुकिंग रद्द कर दी गई।` : 'आपकी दुकान की एक बुकिंग रद्द कर दी गई।',
  }),
};

export const PUSH_COPY: Readonly<Record<Language, PushCopy>> = {
  [Language.EN]: enPush,
  [Language.HI]: hiPush,
};

/** Same never-throws fallback-to-English convention as voiceAnnouncementsFor/uiStringsFor. */
export function pushCopyFor(language: Language | null | undefined): PushCopy {
  return (language && PUSH_COPY[language]) || PUSH_COPY[Language.EN];
}
