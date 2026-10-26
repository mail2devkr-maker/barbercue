import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ShopNameSearchField } from '../ShopNameSearchField';

describe('ShopNameSearchField', () => {
  const savedFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = savedFetch;
  });

  it('fetches only real shop-name matches and submits the selected shop on Enter', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { id: 's1', name: 'Studio 25 Salons' },
          { id: 's2', name: 'Studio 44 Salon' },
        ],
        nextCursor: null,
      }),
    });
    const onChange = jest.fn();
    const onSubmit = jest.fn();
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ShopNameSearchField value="Studio" onChange={onChange} onSubmit={onSubmit} labelledBy="shop-label" />,
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
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(new URL(calledUrl, 'http://localhost').searchParams.get('shopName')).toBe('Studio');
    expect(new URL(calledUrl, 'http://localhost').searchParams.has('service')).toBe(false);
    const input = renderer.root.findByType('input');
    expect(input.props.placeholder).toContain('shop name');
    expect(input.props['aria-labelledby']).toBe('shop-label');
    const opts = renderer.root.findAll((x) => x.type === 'button' && x.props.role === 'option');
    expect(opts.map((o) => o.props.children)).toEqual(['Studio 25 Salons', 'Studio 44 Salon']);
    expect(opts[0].props.style.color).toBe('var(--bc-ink)');
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', preventDefault: jest.fn() });
    });
    expect(onChange).toHaveBeenCalledWith('Studio 25 Salons');
    expect(onSubmit).toHaveBeenCalledWith('Studio 25 Salons');
  });

  it('does not query before two letters are entered', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ShopNameSearchField value="S" onChange={jest.fn()} onSubmit={jest.fn()} labelledBy="shop-label" />,
      );
    });
    await act(async () => {
      renderer.root.findByType('input').props.onFocus();
      jest.advanceTimersByTime(1000);
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
