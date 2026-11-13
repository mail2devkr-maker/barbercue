/// <reference types="jest" />
import { KEYBOARD_FIELD_GAP, keyboardOverlap } from '../keyboard-aware';

describe('keyboardOverlap (owner report, 13 Nov: fields hidden behind the keyboard)', () => {
  it('scrolls a covered field to sit just above the keyboard', () => {
    expect(keyboardOverlap(700, 500)).toBe(200 + KEYBOARD_FIELD_GAP);
  });
  it('scrolls a field that is visible but touching the keyboard', () => {
    expect(keyboardOverlap(490, 500)).toBe(KEYBOARD_FIELD_GAP - 10);
  });
  it('never moves a field that is already clearly visible', () => {
    expect(keyboardOverlap(300, 500)).toBe(0);
  });
});
