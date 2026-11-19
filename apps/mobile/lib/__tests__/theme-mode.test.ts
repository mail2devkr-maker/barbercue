import { color, fastQue } from '../theme';
import { colorOnDark, colorOnLight, fastQueOnLight, resolveTheme, statusBarStyleFor, themedStyles, tokensFor } from '../theme-mode';

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
    expect(tokensFor('light').color).toBe(colorOnLight);
    // Light only deepens the brand coral (it is read as text there); every other value is as designed.
    expect({ ...colorOnLight, brandCoral: color.brandCoral }).toEqual(color);
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

  it('keeps the clock and battery readable: designed per screen, dark text in Light, light text in Dark', () => {
    expect(statusBarStyleFor('designed', 'light')).toBe('light');
    expect(statusBarStyleFor('designed', 'dark')).toBe('dark');
    expect(statusBarStyleFor('light', 'light')).toBe('dark');
    expect(statusBarStyleFor('dark', 'dark')).toBe('light');
  });
});

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe('theme contrast (owner: theme must read "very very fine")', () => {
  it('Light: accent text (coral, orange) reads on the light background', () => {
    expect(contrast(colorOnLight.brandCoral, fastQueOnLight.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fastQueOnLight.orange, fastQueOnLight.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('Dark: button text reads on the coral button fill', () => {
    expect(contrast(colorOnDark.accentContrast, colorOnDark.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
