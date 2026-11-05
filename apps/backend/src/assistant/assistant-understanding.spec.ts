import { AssistantActionId as A } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';

// Understanding regression set: realistic owner / customer phrasings in Hinglish, Hindi (Devanagari)
// and English -> the ONE action they must map to. Includes the three misunderstandings fixed here:
// a head-count of the line read as a customer search, a named staff deactivation not understood, and
// "queue se hata do mujhe" read as a status question.
const CASES: Array<[string, string, 'shop' | 'customer']> = [
  ['aaj kitne customer line mein hain', A.QUEUE_STATUS, 'shop'],
  ['queue mein kitne log hain', A.QUEUE_STATUS, 'shop'],
  ['लाइन में कितने लोग हैं', A.QUEUE_STATUS, 'shop'],
  ['how many people are waiting', A.QUEUE_STATUS, 'shop'],
  ['agla customer bulao', A.QUEUE_CALL_NEXT, 'shop'],
  ['next customer ko bulao', A.QUEUE_CALL_NEXT, 'shop'],
  ['अगले ग्राहक को बुलाओ', A.QUEUE_CALL_NEXT, 'shop'],
  ['call the next customer', A.QUEUE_CALL_NEXT, 'shop'],
  ['aaj ki kamai kitni hui', A.TODAY_INSIGHTS, 'shop'],
  ['आज कितनी कमाई हुई', A.TODAY_INSIGHTS, 'shop'],
  ["what is today's revenue", A.TODAY_INSIGHTS, 'shop'],
  ['is mahine ki revenue report dikhao', A.REVENUE_REPORT, 'shop'],
  ['haircut ka rate 150 kar do', A.SERVICE_SET_PRICE, 'shop'],
  ['हेयरकट का दाम 150 कर दो', A.SERVICE_SET_PRICE, 'shop'],
  ['change haircut price to 150', A.SERVICE_SET_PRICE, 'shop'],
  ['naya service add karo beard trim 80 rupees', A.SERVICE_ADD, 'shop'],
  ['services dikhao', A.SERVICE_LIST, 'shop'],
  ['सर्विस लिस्ट दिखाओ', A.SERVICE_LIST, 'shop'],
  ['staff list dikhao', A.STAFF_LIST, 'shop'],
  ['mere barber kaun kaun hain', A.STAFF_LIST, 'shop'],
  ['स्टाफ दिखाओ', A.STAFF_LIST, 'shop'],
  ['ramesh ko inactive kar do', A.STAFF_SET_STATUS, 'shop'],
  ['chair 2 band kar do', A.CHAIRS_SET_STATUS, 'shop'],
  ['kitni chairs hain', A.CHAIRS_LIST, 'shop'],
  ['ek nayi chair add karo', A.CHAIRS_ADD, 'shop'],
  ['dukan kab khulti hai', A.HOURS_VIEW, 'shop'],
  ['shop timing dikhao', A.HOURS_VIEW, 'shop'],
  ['दुकान का समय दिखाओ', A.HOURS_VIEW, 'shop'],
  ['sunday ko shop band rakho', A.HOURS_SET, 'shop'],
  ['aaj ki bookings dikhao', A.SCHEDULE_VIEW, 'shop'],
  ['kal ki appointments dikhao', A.SCHEDULE_VIEW, 'shop'],
  ['आज की बुकिंग दिखाओ', A.SCHEDULE_VIEW, 'shop'],
  ['reviews dikhao', A.REVIEWS_LIST, 'shop'],
  ['customer ne kya review diya', A.REVIEWS_LIST, 'shop'],
  ['notifications dikhao', A.NOTIFICATIONS_LIST, 'shop'],
  ['saare notification read kar do', A.NOTIFICATIONS_READ_ALL, 'shop'],
  ['offers dikhao', A.OFFERS_LIST, 'shop'],
  ['invoice dikhao', A.INVOICES_LIST, 'shop'],
  ['customer rahul ko dhundo', A.CUSTOMERS_FIND, 'shop'],
  ['auto assign chalu hai kya', A.AUTO_ASSIGN_VIEW, 'shop'],
  ['auto assign band karo', A.AUTO_ASSIGN_SET, 'shop'],
  ['walk in customer add karo amit', A.QUEUE_ADD_WALK_IN, 'shop'],
  ['services page kholo', A.NAVIGATE, 'shop'],
  ['staff page par le chalo', A.NAVIGATE, 'shop'],
  ['analytics kholo', A.NAVIGATE, 'shop'],
  ['inventory page kholo', A.NAVIGATE, 'shop'],
  ['settings mein jao', A.NAVIGATE, 'shop'],
  ['सेटिंग्स खोलो', A.NAVIGATE, 'shop'],
  ['go to bookings', A.NAVIGATE, 'shop'],
  ['peeche jao', A.NAVIGATE_BACK, 'shop'],
  ['go back', A.NAVIGATE_BACK, 'shop'],
  ['location kholo', A.NAVIGATE, 'shop'],
  ['लोकेशन खोलो', A.NAVIGATE, 'shop'],
  ['verification page kholo', A.NAVIGATE, 'shop'],
  ['open contacts', A.NAVIGATE, 'shop'],
  ['upi qr page kholo', A.NAVIGATE, 'shop'],
  ['tum kya kya kar sakte ho', A.HELP, 'shop'],
  ['help', A.HELP, 'shop'],
  ['meri booking dikhao', A.MY_BOOKINGS, 'customer'],
  ['मेरी बुकिंग दिखाओ', A.MY_BOOKINGS, 'customer'],
  ['meri booking cancel karo', A.MY_BOOKING_CANCEL, 'customer'],
  ['line mein mera number kya hai', A.MY_QUEUE_STATUS, 'customer'],
  ['queue se hata do mujhe', A.MY_QUEUE_LEAVE, 'customer'],
  ['paas mein salon dhundo', A.SALON_SEARCH, 'customer'],
  ['kal 5 baje haircut book karo', A.BOOK_APPOINTMENT, 'customer'],
];

describe('assistant understanding (Hinglish / Hindi / English)', () => {
  it.each(CASES)('%s', (text, want, surface) => {
    expect(parseAssistantText(text, surface)?.action ?? null).toBe(want);
  });

  it('a named deactivation is a staff status change; "active" stays the existing service-restore phrasing', () => {
    for (const t of [
      'ramesh ko inactive kar do',
      'suresh kumar ko deactivate kar do',
    ])
      expect(parseAssistantText(t, 'shop')).toEqual({
        action: A.STAFF_SET_STATUS,
        active: false,
      });
    expect(parseAssistantText('haircut ko active kar do', 'shop')?.action).toBe(
      A.SERVICE_RESTORE,
    );
  });

  it('customer searches still work when no head-count of the line is asked', () => {
    expect(parseAssistantText('customer rahul ko dhundo', 'shop')?.action).toBe(
      A.CUSTOMERS_FIND,
    );
    expect(
      parseAssistantText('customer amit line mein hai', 'shop')?.action,
    ).toBe(A.CUSTOMERS_FIND);
  });

  it('opens the location, verification, contacts and payment QR screens by voice', () => {
    expect(parseAssistantText('location kholo', 'shop')).toEqual({
      action: A.NAVIGATE,
      page: 'location',
    });
    expect(parseAssistantText('वेरिफिकेशन पेज खोलो', 'shop')).toEqual({
      action: A.NAVIGATE,
      page: 'verification',
    });
    expect(parseAssistantText('open contacts', 'shop')).toEqual({
      action: A.NAVIGATE,
      page: 'contacts',
    });
    expect(parseAssistantText('payment qr kholo', 'shop')).toEqual({
      action: A.NAVIGATE,
      page: 'paymentQr',
    });
    expect(parseAssistantText('payments kholo', 'shop')).toEqual({
      action: A.NAVIGATE,
      page: 'payments',
    });
    // A change is never navigation.
    expect(parseAssistantText('address badlo', 'shop')?.action).not.toBe(
      A.NAVIGATE,
    );
  });

  it('admin screens: open admin pages by voice; questions stay questions', () => {
    const admin = (t: string) => parseAssistantText(t, 'admin');
    expect(admin('live queue monitoring kholo')).toEqual({
      action: A.ADMIN_NAVIGATE,
      page: 'liveQueue',
    });
    expect(admin('all bookings page kholo')).toEqual({
      action: A.ADMIN_NAVIGATE,
      page: 'allBookings',
    });
    expect(admin('onboarding kholo')).toEqual({
      action: A.ADMIN_NAVIGATE,
      page: 'onboarding',
    });
    expect(admin('open verification queue')).toEqual({
      action: A.ADMIN_NAVIGATE,
      page: 'verification',
    });
    expect(admin('wapas jao')?.action).toBe(A.NAVIGATE_BACK);
    expect(admin('kitni shops open hain')?.action).toBe(A.ADMIN_SHOP_STATUS);
    expect(admin('aaj kaunsi shops busy hain')?.action).not.toBe(
      A.ADMIN_NAVIGATE,
    );
  });
});
