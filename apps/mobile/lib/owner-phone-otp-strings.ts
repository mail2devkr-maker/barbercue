// Strings for the returning-owner phone sign-in screen. Kept next to the screen instead of in the shared UiStrings
// table (shared is owned by the backend team); they move there when that table is next extended.

export interface OwnerPhoneStrings {
  title: string;
  subtitle: string;
  dialCodeLabel: string;
  phoneLabel: string;
  phonePlaceholder: string;
  sendCode: string;
  codeLabel: string;
  verify: string;
  resend: string;
  resendIn: (seconds: number) => string;
  changeNumber: string;
  useEmailInstead: string;
  requestSent: (minutes: number) => string;
  invalidPhone: string;
  invalidCode: string;
  rateLimited: string;
  invalidOrExpired: string;
  unavailable: string;
  network: string;
  other: string;
  signInWithPhone: string;
  signInWithPhoneHint: string;
}

const EN: OwnerPhoneStrings = {
  title: 'Sign in with your phone',
  subtitle: 'Use the mobile number linked to your shop owner account.',
  dialCodeLabel: 'Code',
  phoneLabel: 'Mobile number',
  phonePlaceholder: '98765 43210',
  sendCode: 'Send code',
  codeLabel: '6-digit code',
  verify: 'Verify and sign in',
  resend: 'Resend code',
  resendIn: (s) => `Resend code in ${s}s`,
  changeNumber: 'Use a different number',
  useEmailInstead: 'Use email and password instead',
  requestSent: (m) => `If this number is linked to a shop owner account, we have sent a 6-digit code. It expires in ${m} minutes.`,
  invalidPhone: 'Enter a valid mobile number.',
  invalidCode: 'Enter the 6-digit code.',
  rateLimited: 'Too many attempts. Please wait a few minutes and try again.',
  invalidOrExpired: 'That code is not valid or has expired. Request a new code and try again.',
  unavailable: 'Phone sign-in is not available right now. Use your email and password instead.',
  network: 'Could not reach FastQue. Check your connection and try again.',
  other: 'Something went wrong. Please try again.',
  signInWithPhone: 'Sign in with phone',
  signInWithPhoneHint: 'Get a one-time code by SMS',
};

const HI: OwnerPhoneStrings = {
  title: 'अपने फ़ोन से साइन इन करें',
  subtitle: 'अपने शॉप ओनर अकाउंट से जुड़ा मोबाइल नंबर इस्तेमाल करें।',
  dialCodeLabel: 'कोड',
  phoneLabel: 'मोबाइल नंबर',
  phonePlaceholder: '98765 43210',
  sendCode: 'कोड भेजें',
  codeLabel: '6 अंकों का कोड',
  verify: 'सत्यापित करें और साइन इन करें',
  resend: 'कोड दोबारा भेजें',
  resendIn: (s) => `${s} सेकंड में कोड दोबारा भेजें`,
  changeNumber: 'दूसरा नंबर इस्तेमाल करें',
  useEmailInstead: 'ईमेल और पासवर्ड से साइन इन करें',
  requestSent: (m) => `अगर यह नंबर किसी शॉप ओनर अकाउंट से जुड़ा है, तो हमने 6 अंकों का कोड भेजा है। यह ${m} मिनट में समाप्त हो जाएगा।`,
  invalidPhone: 'सही मोबाइल नंबर दर्ज करें।',
  invalidCode: '6 अंकों का कोड दर्ज करें।',
  rateLimited: 'बहुत ज़्यादा कोशिशें हुईं। कुछ मिनट रुककर दोबारा कोशिश करें।',
  invalidOrExpired: 'यह कोड सही नहीं है या समाप्त हो चुका है। नया कोड मँगवाकर दोबारा कोशिश करें।',
  unavailable: 'अभी फ़ोन से साइन इन उपलब्ध नहीं है। कृपया ईमेल और पासवर्ड इस्तेमाल करें।',
  network: 'FastQue से कनेक्ट नहीं हो सका। इंटरनेट जाँचकर दोबारा कोशिश करें।',
  other: 'कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।',
  signInWithPhone: 'फ़ोन से साइन इन करें',
  signInWithPhoneHint: 'SMS से एक बार वाला कोड पाएँ',
};

export function ownerPhoneStrings(language: string): OwnerPhoneStrings {
  return String(language).toUpperCase() === 'HI' ? HI : EN;
}
