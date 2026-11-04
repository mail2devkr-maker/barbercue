import { AssistantActionId, VOICE_CHECK_PHRASES } from '@barbercue/shared';
import { ASSISTANT_ACTIONS } from './actions/catalog';
import { chooseReading } from './assistant-hearing';
import { parseAssistantText } from './assistant-parser';
import { ASR_FIXTURES } from './voice-asr-fixtures';

const interpret = (t: string) => Promise.resolve(parseAssistantText(t, 'shop'));

describe('chooseReading (issue #371: speech alternatives)', () => {
  it('correct first: the top transcript is used and alternatives are ignored', async () => {
    const r = await chooseReading(interpret, 'Bookings kholo', ['books colo']);
    expect(r).toMatchObject({ text: 'Bookings kholo', usedAlternative: false });
    expect(r.parsed?.action).toBe(AssistantActionId.NAVIGATE);
  });
  it('top wrong, alternative right: the alternative is used for a READ/navigation', async () => {
    const r = await chooseReading(interpret, 'book in school', [
      'bookings kholo',
      'staff dikhao',
    ]);
    expect(r).toMatchObject({ text: 'bookings kholo', usedAlternative: true });
    expect(r.parsed).toEqual({
      action: AssistantActionId.NAVIGATE,
      page: 'bookings',
    });
    expect(r.top).toBeNull();
  });
  it('all hypotheses wrong: nothing is chosen', async () => {
    const r = await chooseReading(interpret, 'mausam kaisa', [
      'mosam kesa',
      'mausam kesa hai',
    ]);
    expect(r.parsed).toBeNull();
    expect(r.usedAlternative).toBe(false);
  });
  it('the browser returned no alternatives: plain top-transcript behaviour', async () => {
    expect(
      (await chooseReading(interpret, 'staff dikhao', undefined)).parsed
        ?.action,
    ).toBe(AssistantActionId.STAFF_LIST);
    expect((await chooseReading(interpret, 'xyz', [])).parsed).toBeNull();
  });
  it('a misheard CHANGE in an alternative is never used; it is only offered as a suggestion', async () => {
    const r = await chooseReading(interpret, 'to hot a do', [
      'chair 2 hatao',
      'Haircut ka price 150 karo',
    ]);
    expect(r.parsed).toBeNull();
    expect(r.usedAlternative).toBe(false);
    expect(r.writeSuggestions).toEqual([
      'chair 2 hatao',
      'Haircut ka price 150 karo',
    ]);
  });
  it('a read alternative wins over a write alternative listed before it, and the write is not run', async () => {
    const r = await chooseReading(interpret, 'blah', [
      'booking cancel karo',
      'bookings kholo',
    ]);
    expect(r.parsed?.action).toBe(AssistantActionId.NAVIGATE);
    expect(r.writeSuggestions).toEqual(['booking cancel karo']);
  });
  it('a change heard as the TOP transcript keeps the normal flow (gate, preview, confirmation)', async () => {
    const r = await chooseReading(interpret, 'Haircut ka price 150 karo', [
      'bookings kholo',
    ]);
    expect(r.parsed?.action).toBe(AssistantActionId.SERVICE_SET_PRICE);
    expect(r.usedAlternative).toBe(false);
  });
  it('mixed scripts in alternatives', async () => {
    const r = await chooseReading(interpret, 'चेक करो कितनी', [
      'चेक करो कितनी चेयर्स अवेलेबल हैं',
    ]);
    expect(r.parsed?.action).toBe(AssistantActionId.CHAIRS_LIST);
  });
  it('at most 4 alternatives are considered', async () => {
    const r = await chooseReading(interpret, 'x', [
      'a',
      'b',
      'c',
      'd',
      'staff dikhao',
    ]);
    expect(r.parsed).toBeNull();
  });
});

describe('simulated recognizer outputs (hi-IN Devanagari, en-IN mis-spellings)', () => {
  it.each(ASR_FIXTURES.map(([t, w, p]) => [t, w, p ?? null] as const))(
    '%s -> %s',
    (text, want, page) => {
      const r = parseAssistantText(text, 'shop') as {
        action?: string;
        page?: string;
      } | null;
      expect(r?.action).toBe(want);
      if (page) expect(r?.page).toBe(page);
    },
  );
  it('no mishearing alias turns a question into a change', () => {
    for (const [text] of ASR_FIXTURES) {
      const r = parseAssistantText(text, 'shop');
      expect(r && r.action !== 'unreleased' ? r.action : null).not.toMatch(
        /add|set|cancel|archive|rename|restore|call|complete|noShow|markArrived/,
      );
    }
  });
});

describe('voice check acceptance set (shared with the in-app check)', () => {
  it.each(
    VOICE_CHECK_PHRASES.map((p) => [p.say, p.expect, p.page ?? null] as const),
  )('typed "%s" maps to %s', (say, want, page) => {
    const r = parseAssistantText(say, 'shop') as {
      action?: string;
      page?: string;
    } | null;
    expect(r?.action).toBe(want);
    if (page) expect(r?.page).toBe(page);
  });
  it('every phrase is a READ or navigation (the check never runs a change)', () => {
    for (const p of VOICE_CHECK_PHRASES)
      expect(ASSISTANT_ACTIONS[p.expect].kind).toBe('READ');
  });
});
