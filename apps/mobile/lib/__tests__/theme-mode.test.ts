import { color, fastQue } from '../theme';
import { colorOnDark, fastQueOnLight, resolveTheme, themedStyles, tokensFor } from '../theme-mode';

describe('theme foundation', () => {
  it('each twin palette has exactly the same keys as the palette it mirrors', () => {
    expect(Object.keys(colorOnDark).sort()).toEqual(Object.keys(color).sort());
    expect(Object.keys(fastQueOnLight).sort()).toEqual(Object.keys(fastQue).sort());
  });

  it('"As designed" is exactly today\'s colours - no visual change by default', () => {
    const designed = tokensFor('designed');
    expect(designed.color).toBe(color);
    expect(designed.fastQue).toBe(fastQue);
    expect(designed.surface.card).toBe('#ffffff');
  });

  it('Light keeps the light palette and lightens the dark one; Dark the other way round', () => {
    expect(tokensFor('light').color).toBe(color);
    expect(tokensFor('light').fastQue).toBe(fastQueOnLight);
    expect(tokensFor('dark').fastQue).toBe(fastQue);
    expect(tokensFor('dark').color).toBe(colorOnDark);
    expect(tokensFor('dark').surface.statusBarOn).toBe('light');
  });

  it('"Same as phone" follows the phone setting, defaulting to light', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', null)).toBe('light');
    expect(resolveTheme('designed', 'dark')).toBe('designed');
  });

  it('builds a themed stylesheet once per theme and reuses it', () => {
    const factory = jest.fn(({ color: c }: { color: { ink: string } }) => ({ text: { color: c.ink } }));
    const a = themedStyles(factory as never, tokensFor('dark'));
    const b = themedStyles(factory as never, tokensFor('dark'));
    const c = themedStyles(factory as never, tokensFor('designed'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(factory).toHaveBeenCalledTimes(2);
    expect((a as { text: { color: string } }).text.color).toBe(colorOnDark.ink);
  });
});
