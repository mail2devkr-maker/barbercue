import { act, type ReactElement } from 'react';
import TestRenderer from 'react-test-renderer';

// react-test-renderer is declared untyped in this project (types/react-test-renderer.d.ts), so the
// few members these helpers rely on are described here.
export interface ReactTestInstance {
  type: unknown;
  props: Record<string, any>;
  children: Array<ReactTestInstance | string>;
  findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  findByType(type: unknown): ReactTestInstance;
}
export interface ReactTestRenderer {
  root: ReactTestInstance;
  unmount(): void;
  update(element: ReactElement): void;
}

/**
 * Minimal react-test-renderer helpers (this project drives react-test-renderer directly: see
 * lib/__tests__/language-context.test.tsx for why @testing-library's act bridge is avoided).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

export function byTestId(renderer: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return renderer.root.findAll((node) => node.props.testID === testID && typeof node.type !== 'string');
}

export function byTestIdPrefix(renderer: ReactTestRenderer, prefix: string): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) => typeof node.props.testID === 'string' && node.props.testID.startsWith(prefix) && typeof node.type !== 'string',
  );
}

export function has(renderer: ReactTestRenderer, testID: string): boolean {
  return byTestId(renderer, testID).length > 0;
}

export async function press(renderer: ReactTestRenderer, testID: string): Promise<void> {
  const [node] = byTestId(renderer, testID);
  if (!node) throw new Error(`No element with testID "${testID}"`);
  await act(async () => {
    node.props.onPress();
  });
}

export async function type(renderer: ReactTestRenderer, testID: string, text: string): Promise<void> {
  const [node] = byTestId(renderer, testID);
  if (!node) throw new Error(`No element with testID "${testID}"`);
  await act(async () => {
    node.props.onChangeText(text);
  });
}

/** All text rendered anywhere in the tree, joined — enough for "does the screen say X". */
export function allText(renderer: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestInstance | string) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    node.children.forEach(walk);
  };
  renderer.root.children.forEach(walk);
  return out.join(' | ');
}
