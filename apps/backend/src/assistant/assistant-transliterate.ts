/**
 * Speech-to-text often writes ENGLISH words in Devanagari when the browser recognizer runs in hi-IN
 * ("व्हाट कैन यू डू", "चेक करो कितनी चेयर्स अवेलेबल हैं") and Hindi words in either script. The rule
 * parser matches Latin/Hinglish keywords, so these sentences were "not understood" although every
 * word is a FastQue word (issue #368, owner QA screenshots).
 *
 * `romanize` maps whole Devanagari TOKENS (after normalizeText) to the Latin spelling the parser
 * already knows. It is a fixed dictionary - no phonetic guessing, no network - and tokens it does
 * not know are left exactly as they were, so names and Devanagari keywords keep working. It is only
 * used as a second reading of the sentence (see parseAssistantText); it never changes what is
 * allowed, and a write still needs a sealed on-screen confirmation.
 */

const WORDS: Record<string, string> = {};
function add(latin: string, ...devanagari: string[]) {
  for (const d of devanagari) WORDS[d] = latin;
}

// ---- English words, as hi-IN speech recognition spells them
add('what', 'व्हाट', 'वॉट', 'वाट', 'व्हॉट');
add('how', 'हाउ', 'हाऊ', 'हॉउ');
add('can', 'कैन', 'केन', 'कॅन');
add('could', 'कुड');
add('you', 'यू', 'यु', 'यूं');
add('your', 'योर', 'यौर', 'युअर');
add('do', 'डू', 'दू');
add('help', 'हेल्प', 'हैल्प', 'हेल्फ', 'हेल्पी');
add('me', 'मी');
add('i', 'आई');
add('who', 'हू');
add('are', 'आर');
add('is', 'इज', 'इज़');
add('the', 'द', 'दि');
add('a', 'ए');
add('of', 'ऑफ');
add('in', 'इन');
add('for', 'फॉर', 'फोर');
add('my', 'माय', 'माई');
add('please', 'प्लीज', 'प्लीज़', 'प्लिज');
add('tell', 'टेल');
add('show', 'शो', 'शॉ');
add('list', 'लिस्ट');
add('check', 'चेक', 'चैक');
add('open', 'ओपन');
add('go', 'गो');
add('to', 'टू');
add('back', 'बैक');
add('page', 'पेज', 'पेज़');
add('screen', 'स्क्रीन');
add('today', 'टुडे', 'टूडे');
add('now', 'नाउ');
add(
  'available',
  'अवेलेबल',
  'अवेलबल',
  'अवैलेबल',
  'अवेलेबिल',
  'अवेलेबल्स',
  'अवेलेबली',
);
add('availability', 'अवेलेबिलिटी', 'अवेलबिलिटी');
add('free', 'फ्री');
add('empty', 'एम्प्टी');
add('busy', 'बिजी', 'बिज़ी');
add('chair', 'चेयर', 'चेअर', 'चैयर', 'चियर');
add('chairs', 'चेयर्स', 'चेयरस', 'चेअर्स', 'चैयर्स', 'चेयरें');
add('queue', 'क्यू', 'क्यु', 'क्यूं', 'क्यूइ');
add('live', 'लाइव', 'लाईव');
add('booking', 'बुकिंग');
add('bookings', 'बुकिंग्स', 'बुकिंगस', 'बुकिंगें');
add('appointment', 'अपॉइंटमेंट', 'अपोइंटमेंट', 'अपॉइन्टमेंट');
add('appointments', 'अपॉइंटमेंट्स', 'अपोइंटमेंट्स');
add('service', 'सर्विस', 'सर्विज');
add('services', 'सर्विसेज', 'सर्विसेस', 'सर्विसेज़', 'सर्विसिस');
add('staff', 'स्टाफ', 'स्टॉफ');
add('barber', 'बार्बर', 'बारबर');
add('barbers', 'बार्बर्स', 'बारबर्स');
add('team', 'टीम');
add('revenue', 'रेवेन्यू', 'रेवन्यू');
add('sales', 'सेल्स', 'सेल');
add('earning', 'अर्निंग');
add('earnings', 'अर्निंग्स');
add('dashboard', 'डैशबोर्ड', 'डेशबोर्ड');
add('home', 'होम');
add('settings', 'सेटिंग्स', 'सेटिंग');
add('customer', 'कस्टमर');
add('customers', 'कस्टमर्स');
add('offer', 'ऑफर', 'आफर');
add('offers', 'ऑफर्स', 'आफर्स');
add('review', 'रिव्यू');
add('reviews', 'रिव्यूज', 'रिव्यूज़');
add('invoice', 'इनवॉइस', 'इनवाइस');
add('invoices', 'इनवॉइसेस', 'इनवाइसेस');
add('schedule', 'शेड्यूल', 'शेड्यूल्ड');
add('timing', 'टाइमिंग');
add('timings', 'टाइमिंग्स');
add('hours', 'आवर्स');
add('price', 'प्राइस');
add('haircut', 'हेयरकट', 'हेयर कट');
add('shave', 'शेव');
add('hello', 'हेलो', 'हैलो', 'हलो');
add('hi', 'हाय', 'हाई');
add('hey', 'हे');
add('thanks', 'थैंक्स', 'थैंक्यू');
add('ok', 'ओके');
add('stop', 'स्टॉप');
add('next', 'नेक्स्ट');
add('cancel', 'कैंसिल', 'कैन्सल', 'केंसल');
add('cancellations', 'कैंसिलेशन', 'कैंसिलेशंस');
add('inventory', 'इन्वेंटरी', 'इनवेंटरी');
add('notifications', 'नोटिफिकेशन', 'नोटिफिकेशंस');
add('analytics', 'एनालिटिक्स');
add('location', 'लोकेशन');
add('address', 'एड्रेस', 'ऐड्रेस');
add('verification', 'वेरिफिकेशन', 'वैरिफिकेशन');
add('contacts', 'कॉन्टैक्ट्स', 'कांटेक्ट्स', 'कॉन्टेक्ट्स');
add('contact', 'कॉन्टैक्ट', 'कांटेक्ट');
add('qr', 'क्यूआर');
add('report', 'रिपोर्ट');
add('total', 'टोटल');

// ---- Hindi words (Devanagari) -> the Hinglish spelling the parser matches
add('kitni', 'कितनी');
add('kitne', 'कितने');
add('kitna', 'कितना');
add('hain', 'हैं');
add('hai', 'है');
add('karo', 'करो', 'करें', 'कीजिए', 'करिए');
add('kar', 'कर');
add('do', 'दो');
add('dikhao', 'दिखाओ', 'दिखाइए', 'दिखायें', 'दिखाएं');
add('batao', 'बताओ', 'बताइए', 'बताएं', 'बतायें');
add('kholo', 'खोलो', 'खोलिए', 'खोलें');
add('jao', 'जाओ', 'जाइए', 'जाएं');
add('chalo', 'चलो', 'चलिए');
add('aaj', 'आज');
add('log', 'लोग');
add('mein', 'में', 'मे');
add('kya', 'क्या');
add('kaun', 'कौन');
add('kaise', 'कैसे');
add('sakte', 'सकते');
add('sakti', 'सकती');
add('sakta', 'सकता');
add('ho', 'हो');
add('aap', 'आप');
add('tum', 'तुम');
add('meri', 'मेरी');
add('mera', 'मेरा');
add('mere', 'मेरे');
add('mujhe', 'मुझे');
add('madad', 'मदद');
add('khali', 'खाली');
add('kursi', 'कुर्सी');
add('kursiyan', 'कुर्सियां', 'कुर्सियाँ');
add('abhi', 'अभी');
add('kal', 'कल');
add('wala', 'वाला');
add('wapas', 'वापस');
add('peeche', 'पीछे');
add('page', 'पन्ना');
add('ki', 'की');
add('ka', 'का');
add('ke', 'के');
add('ko', 'को');
add('se', 'से');
add('aur', 'और');
add('hui', 'हुई');
add('hua', 'हुआ');
add('kamai', 'कमाई');
add('naam', 'नाम');
add('sab', 'सब');
add('saari', 'सारी');
add('saare', 'सारे');

/** The same sentence with every known Devanagari token written in Latin. Unknown tokens are kept. */
/**
 * Issue #371: Latin spellings that speech recognition produces for FastQue words (en-IN on
 * Hinglish, accents, fast speech). Exact whole-word mappings only, to READ/navigation vocabulary;
 * nothing maps INTO a change word (add, delete, cancel, price...), so a mishearing can never turn
 * a question into an edit. Used only in the second reading, like the Devanagari map.
 */
const LATIN: Record<string, string> = {};
function fix(latin: string, ...heard: string[]) {
  for (const h of heard) LATIN[h] = latin;
}
fix(
  'chairs',
  'chears',
  'cheyars',
  'cheyers',
  'chiars',
  'chers',
  'chares',
  'chairz',
  'chayars',
  'chear',
);
fix('chair', 'cheyar', 'cheyer', 'chiar', 'chayar');
fix('queue', 'kyu', 'kyoo', 'kew', 'cue', 'que', 'qeue', 'quew');
fix(
  'bookings',
  'bukings',
  'bookins',
  'bookingz',
  'buckings',
  'bokings',
  'bookingss',
);
fix('booking', 'buking', 'bukking', 'boking');
fix(
  'services',
  'servises',
  'servicez',
  'sarvices',
  'sarvises',
  'servisez',
  'survices',
);
fix('service', 'servis', 'servise', 'sarvis', 'sarvice', 'survice');
fix('staff', 'stuff', 'staf', 'staaf', 'stafe');
fix(
  'available',
  'availble',
  'avelable',
  'avalable',
  'avilable',
  'availabe',
  'evailable',
);
fix('free', 'fri', 'phree');
fix('kholo', 'khol', 'kholdo', 'khulo', 'kholiye', 'kolo', 'kohlo');
fix(
  'dikhao',
  'dikha',
  'dikhado',
  'dikhaao',
  'dekhao',
  'dikhaiye',
  'dikhaye',
  'dikao',
);
fix('batao', 'batado', 'bataao', 'bataiye', 'batayein', 'btao');
fix('kitni', 'kitani', 'kitny');
fix('kitne', 'kitane', 'kitnay');
fix('dashboard', 'dash', 'deshboard', 'dashbord');
fix('revenue', 'revenu', 'revnue', 'revinue');
fix('help', 'halp', 'hellp');

/** The same sentence with every known Devanagari token written in Latin and known mishearings fixed. */
export function romanize(normalized: string): string {
  return normalized
    .split(' ')
    .map((t) => WORDS[t] ?? LATIN[t] ?? t)
    .join(' ');
}
