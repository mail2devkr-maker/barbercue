import { ASSISTANT_ACTIONS } from './actions/catalog';
import type { ParsedIntent } from './assistant-parser';

/**
 * Issue #371: which reading of a spoken sentence to act on.
 *
 *  - The top transcript wins whenever it is understood. That includes a change, which still goes
 *    through the release gate, its preview and an on-screen confirmation.
 *  - Otherwise the first ALTERNATIVE that maps to a READ or navigation is used.
 *  - An alternative that maps to a change is NEVER used. It is only returned as a suggestion the
 *    user must tap, which then starts the normal preview-and-confirm flow.
 */
export interface Reading {
  parsed: ParsedIntent | null;
  text: string;
  usedAlternative: boolean;
  writeSuggestions: string[];
  /** What the top transcript alone mapped to. */
  top: ParsedIntent | null;
}

export async function chooseReading(
  interpret: (text: string) => Promise<ParsedIntent | null>,
  text: string,
  alternatives: string[] | undefined,
): Promise<Reading> {
  const top = await interpret(text);
  const writeSuggestions: string[] = [];
  if (top || !alternatives?.length)
    return { parsed: top, text, usedAlternative: false, writeSuggestions, top };
  for (const alt of alternatives.slice(0, 4)) {
    if (alt === text) continue;
    const p = await interpret(alt);
    if (!p || p.action === 'unreleased') continue;
    if (ASSISTANT_ACTIONS[p.action].kind === 'READ')
      return {
        parsed: p,
        text: alt,
        usedAlternative: true,
        writeSuggestions,
        top,
      };
    if (!writeSuggestions.includes(alt)) writeSuggestions.push(alt);
  }
  return { parsed: null, text, usedAlternative: false, writeSuggestions, top };
}
