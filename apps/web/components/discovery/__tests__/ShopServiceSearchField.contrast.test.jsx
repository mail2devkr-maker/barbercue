import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ShopServiceSearchField } from '../ShopServiceSearchField';

// Regression for the service search dropdown on /search. The dark page uses pale
// label text, but the typeahead list is a white surface and must keep dark text.
describe('ShopServiceSearchField suggestion contrast', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('scopes the pale uppercase /search label style to direct label children', () => {
    const css = readFileSync(
      join(__dirname, '../../../app/(public)/search/search.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.field\s*>\s*span\s*\{/);
    expect(css).not.toMatch(/\.field\s+span\s*\{/);
  });

  it('shows dark suggestion names and muted dark categories on the light dropdown', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'FULL HANDS BLEACH', category: 'BLEACH & DETAN' }],
    });
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ShopServiceSearchField value="hands" onChange={jest.fn()} onSubmit={jest.fn()} />,
      );
    });
    await act(async () => {
      renderer.root.findByType('input').props.onFocus();
    });
    await act(async () => {
      jest.advanceTimersByTime(310);
      await Promise.resolve();
      await Promise.resolve();
    });
    const options = renderer.root.findAll((node) => node.type === 'li' && node.props.role === 'option');
    expect(options).toHaveLength(1);
    const button = options[0].findByType('button');
    const labels = button.findAllByType('span');
    expect(button.props.style.color).toBe('var(--bc-ink)');
    expect(labels[0].children.join('')).toBe('FULL HANDS BLEACH');
    expect(labels[0].props.style.color).toBe('var(--bc-ink)');
    expect(labels[1].children.join('')).toBe('BLEACH & DETAN');
    expect(labels[1].props.style.color).toBe('var(--bc-muted)');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
