import { hasIntroPlayed, markIntroPlayed } from '../startup-intro';

describe('startup-intro session flag', () => {
  it('starts false — a fresh module evaluation (a genuinely new process) always replays', () => {
    expect(hasIntroPlayed()).toBe(false);
  });

  it('stays true for the rest of this module instance once marked — the same running session (e.g. after a background/foreground resume, which never re-evaluates this module) never replays', () => {
    markIntroPlayed();

    expect(hasIntroPlayed()).toBe(true);
    expect(hasIntroPlayed()).toBe(true);
  });
});
