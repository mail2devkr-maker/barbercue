// Multi-turn follow-ups for the Action Assistant.
//
// When the server needs a detail it answers NEEDS_INPUT with options, each carrying a complete command
// ("Deactivate staff Ramesh"). Tapping an option sends that command. A typed or spoken short answer
// ("Ramesh", "pehla wala", "2", "दूसरा") is matched here to exactly one option and sends that option's
// command instead. Anything longer or ambiguous is sent unchanged, so a new request is never hijacked.
// The server still interprets and re-authorizes the command it receives; nothing is granted here.

export interface FollowUpOption {
  label: string;
  text: string;
}

const ORDINALS: Array<string[]> = [
  [
    "1",
    "one",
    "first",
    "pehla",
    "pehli",
    "pahla",
    "pahli",
    "ek",
    "पहला",
    "पहली",
    "एक",
    "१",
  ],
  [
    "2",
    "two",
    "second",
    "doosra",
    "dusra",
    "doosri",
    "dusri",
    "do",
    "दूसरा",
    "दूसरी",
    "दो",
    "२",
  ],
  [
    "3",
    "three",
    "third",
    "teesra",
    "tisra",
    "teesri",
    "tisri",
    "teen",
    "तीसरा",
    "तीसरी",
    "तीन",
    "३",
  ],
  [
    "4",
    "four",
    "fourth",
    "chautha",
    "chauthi",
    "char",
    "चौथा",
    "चौथी",
    "चार",
    "४",
  ],
  [
    "5",
    "five",
    "fifth",
    "paanchva",
    "panchva",
    "paanch",
    "पांचवां",
    "पांचवा",
    "पाँच",
    "५",
  ],
];
// Words that carry no choice: "pehla wala", "option 2", "number do", "Ramesh ko", "the first one".
const FILLER = new Set([
  "wala",
  "wali",
  "vala",
  "vali",
  "wale",
  "option",
  "number",
  "no",
  "no.",
  "the",
  "one",
  "ko",
  "ka",
  "ki",
  "hai",
  "वाला",
  "वाली",
  "नंबर",
  "को",
  "please",
  "plz",
  "ji",
  "जी",
  "वाले",
]);

const norm = (s: string) =>
  s
    .toLocaleLowerCase("en-IN")
    .replace(/[.,!?;:"'()।]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function resolveFollowUp(
  said: string,
  options: readonly FollowUpOption[] | null | undefined,
): string | null {
  if (!options || options.length === 0) return null;
  const all = norm(said).split(" ").filter(Boolean);
  if (all.length === 0 || all.length > 5) return null;
  const words = all.filter((w) => !FILLER.has(w));
  if (words.length === 0) {
    // "the first one" leaves only fillers once "one" is dropped: read "one" as the ordinal then.
    if (all.includes("one")) return options[0]?.text ?? null;
    return null;
  }

  // 1. An ordinal on its own picks by position.
  if (words.length === 1) {
    const index = ORDINALS.findIndex((group) => group.includes(words[0]));
    if (index >= 0) return options[index]?.text ?? null;
  }

  // 2. A short answer that names exactly one option.
  if (words.length > 3) return null;
  const answer = words.join(" ");
  const labels = options.map((o) => norm(o.label));
  const exact = labels.filter((l) => l === answer);
  if (exact.length === 1) return options[labels.indexOf(exact[0])].text;
  const containing = options.filter((o, i) => {
    const tokens = labels[i].split(" ");
    return words.every(
      (w) => w.length >= 3 && tokens.some((t) => t === w || t.startsWith(w)),
    );
  });
  return containing.length === 1 ? containing[0].text : null;
}
