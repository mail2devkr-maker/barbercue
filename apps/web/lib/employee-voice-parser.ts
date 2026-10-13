/**
 * Small, deterministic hints only. Voice recognition is provided by the user's browser and may
 * mishear Hindi/English code-switching. No LLM, audio upload, automatic publish or price guess.
 * Every detected service/price MUST be checked and confirmed by the employee.
 */
export interface ServiceSuggestion {
  name: string;
  priceInr: number;
}

const hindiDigits = '०१२३४५६७८९';
function digitsToAscii(input: string): string {
  return input.replace(/[०-९]/g, (digit) => String(hindiDigits.indexOf(digit)));
}

const aliases: Array<[RegExp, string]> = [
  [/^(?:hair\s*cut|हेयर\s*कट|बाल\s*कटिंग|कटिंग)$/i, 'Haircut'],
  [/^(?:beard|beard\s*trim|दाढ़ी|दाढ़ी|बियर्ड)$/i, 'Beard trim'],
  [/^(?:head\s*massage|हेड\s*मसाज|सिर\s*मालिश)$/i, 'Head massage'],
  [/^(?:massage|मसाज|मालिश)$/i, 'Massage'],
  [/^(?:shave|shaving|शेविंग|शेव)$/i, 'Shaving'],
  [/^(?:facial|फेशियल)$/i, 'Facial'],
  [/^(?:clean\s*up|क्लीन\s*अप)$/i, 'Cleanup'],
  [/^(?:hair\s*spa|हेयर\s*स्पा)$/i, 'Hair spa'],
  [/^(?:hair\s*color|hair\s*colour|हेयर\s*कलर)$/i, 'Hair colour'],
  [/^(?:shampoo|शैम्पू|शैंपू)$/i, 'Shampoo'],
  [/^(?:waxing|वैक्सिंग)$/i, 'Waxing'],
  [/^(?:threading|थ्रेडिंग)$/i, 'Threading'],
  [/^(?:manicure|मैनीक्योर)$/i, 'Manicure'],
  [/^(?:pedicure|पेडीक्योर)$/i, 'Pedicure'],
];

// Longest alternatives precede shorter ones (head massage before massage).
const serviceNamePattern =
  '(?:hair\\s*cut|हेयर\\s*कट|बाल\\s*कटिंग|कटिंग|beard\\s*trim|beard|दाढ़ी|दाढ़ी|बियर्ड|' +
  'head\\s*massage|हेड\\s*मसाज|सिर\\s*मालिश|massage|मसाज|मालिश|shaving|shave|शेविंग|शेव|' +
  'facial|फेशियल|clean\\s*up|क्लीन\\s*अप|hair\\s*spa|हेयर\\s*स्पा|' +
  'hair\\s*colou?r|हेयर\\s*कलर|shampoo|शैम्पू|शैंपू|waxing|वैक्सिंग|' +
  'threading|थ्रेडिंग|manicure|मैनीक्योर|pedicure|पेडीक्योर)';
const serviceWithAmount = new RegExp(
  '(' + serviceNamePattern + ')' +
  '(?:\\s+(?:की|का|के|का\\s+रेट|price|rate|charges?|for|is|at|में|रुपये|रुपए|rs\\.?|inr)){0,4}' +
  '\\s*(?:₹\\s*)?([0-9०-९]{1,7})(?=$|[\\s,;।.!])',
  'giu',
);

export function parseOnboardingServices(text: string): ServiceSuggestion[] {
  const source = digitsToAscii(text);
  const matches: ServiceSuggestion[] = [];
  for (const match of source.matchAll(serviceWithAmount)) {
    const label = match[1].trim();
    const name = aliases.find(([pattern]) => pattern.test(label))?.[1];
    const priceInr = Number(match[2]);
    if (name && Number.isSafeInteger(priceInr) && priceInr >= 0 && priceInr <= 1_000_000) {
      matches.push({ name, priceInr });
    }
  }
  return matches;
}

/** Only obvious numeric chair/staff phrases are extracted; never infer an unknown count. */
export function suggestOnboardingCounts(text: string): { chairCount?: number; staffCount?: number } {
  const source = digitsToAscii(text);
  const result: { chairCount?: number; staffCount?: number } = {};
  const chair = /(?:chairs?|चेयर|कुर्सी)\s*(?:हैं|है|is|are|total|कुल)?\s*([0-9]{1,4})/iu.exec(source);
  const staff = /(?:staff|barbers?|स्टाफ|बार्बर|नाई)\s*(?:हैं|है|is|are|total|कुल)?\s*([0-9]{1,5})/iu.exec(source);
  if (chair && Number(chair[1]) <= 1000) result.chairCount = Number(chair[1]);
  if (staff && Number(staff[1]) <= 10000) result.staffCount = Number(staff[1]);
  return result;
}
