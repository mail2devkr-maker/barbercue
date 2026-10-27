/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Linking, Text } from 'react-native';
import { PasswordChangeRequiredNotice } from '../PasswordChangeRequiredNotice';

const labelOf = (node: any): string => node.findAllByType(Text).map((t: any) => collect(t.props.children)).join(' ');
const pressables = (r: any): any[] => r.root.findAll((n: any) => typeof n.props.onPress === 'function' && n.findAllByType(Text).length > 0);
const collect = (node: unknown): string => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collect).join(' ');
  return collect((node as { children?: unknown }).children);
};

describe('PasswordChangeRequiredNotice (Android handoff for a temporary password)', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  function mount(onSignOut = jest.fn()) {
    let r!: any;
    act(() => {
      r = TestRenderer.create(createElement(PasswordChangeRequiredNotice, { onSignOut }));
    });
    return { r, onSignOut };
  }

  it('explains what to do and shows no password input', () => {
    const { r } = mount();
    const text = collect(r.toJSON());
    expect(text).toContain('Choose your own password first');
    expect(text).toContain('temporary password');
    expect(r.root.findAll((n: any) => (n.type as unknown) === 'TextInput')).toHaveLength(0);
  });

  it('opens the website change-password page, and nothing else, from the main button', () => {
    const { r } = mount();
    const buttons = pressables(r);
    const open = buttons.find((b: any) => /website/i.test(labelOf(b)))!;
    act(() => open.props.onPress());
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(String((Linking.openURL as jest.Mock).mock.calls[0][0])).toMatch(/\/change-password-required$/);
  });

  it('lets the person sign out', () => {
    const { r, onSignOut } = mount();
    const out = pressables(r).find((b: any) => /Sign out/.test(labelOf(b)))!;
    act(() => out.props.onPress());
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(r.root.findAllByType(Text).length).toBeGreaterThan(2);
  });
});
