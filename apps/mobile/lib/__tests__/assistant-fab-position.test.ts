import { clampFabOffset, parseFabOffset } from '../assistant-fab-position';

const bounds = { width: 400, height: 800, fabWidth: 132, fabHeight: 48, bottom: 120, top: 40 };

describe('assistant FAB position', () => {
  it('keeps the button fully on screen when dragged too far', () => {
    expect(clampFabOffset({ x: -9999, y: -9999 }, bounds)).toEqual({ x: -244, y: -584 });
    expect(clampFabOffset({ x: 9999, y: 9999 }, bounds)).toEqual({ x: 8, y: 8 });
  });

  it('leaves a position inside the safe area unchanged', () => {
    expect(clampFabOffset({ x: -100, y: -200 }, bounds)).toEqual({ x: -100, y: -200 });
  });

  it('never lets the button sit over the tab bar', () => {
    expect(clampFabOffset({ x: 0, y: 500 }, { ...bounds, bottom: 70 }).y).toBe(8);
  });

  it('parses stored offsets and ignores anything else', () => {
    expect(parseFabOffset('{"x":-30,"y":-50}')).toEqual({ x: -30, y: -50 });
    for (const bad of [null, undefined, '', 'nope', '{"x":"a","y":1}', '{"x":1}', '{"x":null,"y":2}']) expect(parseFabOffset(bad)).toBeNull();
  });
});
