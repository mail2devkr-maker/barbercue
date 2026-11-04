/**
 * Issue #371: SIMULATED speech-recognizer outputs for the voice-check phrases. They are not the
 * owner's recordings (none were provided); they model the two documented failure shapes:
 *  - hi-IN recognition writing English words in Devanagari (चेयर्स, बुकिंग्स, क्यू);
 *  - en-IN recognition of Hinglish with common mis-spellings (cheyars, kyu, stuff).
 * Each entry: [recognized text, expected action id, expected page for navigation].
 * The real first-attempt measurement is the in-app voice check on the owner's own Chrome.
 */
export const ASR_FIXTURES: Array<[string, string, string?]> = [
  // ---- hi-IN, Devanagari
  ['व्हाट कैन यू डू', 'app.help'],
  ['हाउ कैन यू हेल्प मी', 'app.help'],
  ['आप क्या क्या कर सकते हो', 'app.help'],
  ['मेरी मदद करो', 'app.help'],
  ['कितनी चेयर्स फ्री हैं', 'chairs.list'],
  ['चेक करो कितनी चेयर्स अवेलेबल है', 'chairs.list'],
  ['खाली कुर्सी कितनी है', 'chairs.list'],
  ['आज क्यू में कितने लोग हैं', 'queue.status'],
  ['क्यू का स्टेटस बताओ', 'queue.status'],
  ['लाइन में कितने लोग हैं', 'queue.status'],
  ['सर्विसेज दिखाओ', 'services.list'],
  ['कौन कौन सी सर्विस है', 'services.list'],
  ['स्टाफ दिखाओ', 'staff.list'],
  ['कितने बार्बर हैं', 'staff.list'],
  ['आज की बुकिंग दिखाओ', 'schedule.view'],
  ['कल के अपॉइंटमेंट दिखाओ', 'schedule.view'],
  ['आज की कमाई कितनी हुई', 'insights.today'],
  ['आज की सेल्स बताओ', 'insights.today'],
  ['बुकिंग्स खोलो', 'app.navigate', 'bookings'],
  ['सर्विसेज पेज खोलो', 'app.navigate', 'services'],
  ['लाइव क्यू खोलो', 'app.navigate', 'queue'],
  ['चेयर्स पेज खोलो', 'app.navigate', 'chairs'],
  ['डैशबोर्ड पे जाओ', 'app.navigate', 'dashboard'],
  ['सेटिंग्स खोलो', 'app.navigate', 'settings'],
  ['वापस जाओ', 'app.navigateBack'],
  // ---- en-IN on Hinglish, common mis-spellings
  ['kitni cheyars free hai', 'chairs.list'],
  ['khali kursi kitni hai', 'chairs.list'],
  ['aaj kyu mein kitne log hai', 'queue.status'],
  ['servises dikhao', 'services.list'],
  ['stuff dikhao', 'staff.list'],
  ['bukings kholo', 'app.navigate', 'bookings'],
  ['services page khol do', 'app.navigate', 'services'],
  ['dashboard par jao', 'app.navigate', 'dashboard'],
  ['what can u do', 'app.help'],
  ['how can you help me', 'app.help'],
  ['go back', 'app.navigateBack'],
  ['chairs page kolo', 'app.navigate', 'chairs'],
  ['how many chairs are free', 'chairs.list'],
  ['how many people are waiting', 'queue.status'],
];
