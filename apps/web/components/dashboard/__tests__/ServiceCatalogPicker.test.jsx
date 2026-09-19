import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ServiceCatalogPicker } from '../ServiceCatalogPicker';
import { apiFetch } from '../../../lib/api';
import { SERVICE_CATALOG } from '@barbercue/shared';

// Owner-onboarding Select All mission — this suite covers the ServiceCatalogPicker directly
// (the actual "Services selection tab" content rendered by dashboard/salons/[salonId]/services).
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));

let tree;

function textOf(instance) {
  if (typeof instance === 'string') return instance;
  return instance.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('');
}
function findByText(type, text) {
  return tree.root.findAllByType(type).find((i) => textOf(i) === text);
}
function findByTextIncludes(type, text) {
  return tree.root.findAllByType(type).find((i) => textOf(i).includes(text));
}
function checkboxFor(serviceName) {
  const label = tree.root.findAllByType('label').find((l) => textOf(l).includes(serviceName));
  return label.findByType('input');
}
function priceInputFor(item) {
  return tree.root.findByProps({ id: `catalog-price-${item.id}` });
}
function durationInputFor(item) {
  return tree.root.findByProps({ id: `catalog-duration-${item.id}` });
}

const noop = () => {};

function renderPicker(props = {}) {
  return TestRenderer.create(
    <ServiceCatalogPicker
      basePath="/dashboard/salons/s1/services"
      services={[]}
      currencyLabel=" (INR)"
      onCreated={noop}
      onReactivated={noop}
      onError={noop}
      {...props}
    />,
  );
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
});

it('Select All selects every available service in the full catalog, not just the current filter/search view', async () => {
  await act(async () => {
    tree = renderPicker();
  });

  // Narrow the visible list via search first — Select All must still act on the whole catalog.
  const search = tree.root.findByProps({ id: 'catalog-search' });
  await act(async () => search.props.onChange({ target: { value: 'haircut' } }));

  const selectAllButton = findByText('button', 'Select all services');
  expect(selectAllButton).toBeDefined();
  await act(async () => selectAllButton.props.onClick());

  expect(findByTextIncludes('span', `${SERVICE_CATALOG.length} selected`)).toBeDefined();
});

it('every service selected via Select All receives its canonical default duration, and price is left blank (no fabricated default exists)', async () => {
  await act(async () => {
    tree = renderPicker();
  });
  await act(async () => findByText('button', 'Select all services').props.onClick());

  for (const item of SERVICE_CATALOG) {
    expect(durationInputFor(item).props.value).toBe(String(item.defaultDurationMinutes));
    expect(priceInputFor(item).props.value).toBe('');
    expect(priceInputFor(item).props.required).toBe(true);
  }
});

it('an individually newly-selected service also receives its canonical default duration with a blank required price', async () => {
  const item = SERVICE_CATALOG[0];
  await act(async () => {
    tree = renderPicker();
  });
  await act(async () => checkboxFor(item.name).props.onChange());

  expect(durationInputFor(item).props.value).toBe(String(item.defaultDurationMinutes));
  expect(priceInputFor(item).props.value).toBe('');
});

it('Select All toggles to Clear all selections once every selectable service is selected, and clearing removes every draft (no stale hidden payload)', async () => {
  await act(async () => {
    tree = renderPicker();
  });
  await act(async () => findByText('button', 'Select all services').props.onClick());

  const clearButton = findByText('button', 'Clear all selections');
  expect(clearButton).toBeDefined();
  await act(async () => clearButton.props.onClick());

  expect(findByTextIncludes('span', '0 selected')).toBeDefined();
  expect(findByText('button', 'Select all services')).toBeDefined();
  // Nothing left to submit — the bulk-add bar must not render with zero drafts.
  expect(findByText('button', 'Add selected services')).toBeUndefined();
});

it('a manual price/duration edit survives Select All being clicked again for the remaining items', async () => {
  const [first, second] = SERVICE_CATALOG;
  await act(async () => {
    tree = renderPicker();
  });

  await act(async () => checkboxFor(first.name).props.onChange());
  await act(async () => priceInputFor(first).props.onChange({ target: { value: '999' } }));
  await act(async () => durationInputFor(first).props.onChange({ target: { value: '77' } }));

  // Selecting everything else must not touch the already-edited draft for `first`.
  await act(async () => findByText('button', 'Select all services').props.onClick());

  expect(priceInputFor(first).props.value).toBe('999');
  expect(durationInputFor(first).props.value).toBe('77');
  // A different, freshly-selected item still gets the untouched canonical default.
  expect(priceInputFor(second).props.value).toBe('');
  expect(durationInputFor(second).props.value).toBe(String(second.defaultDurationMinutes));
});

it('blocks submission with a blank price instead of silently treating it as 0', async () => {
  const item = SERVICE_CATALOG[0];
  const onError = jest.fn();
  await act(async () => {
    tree = renderPicker({ onError });
  });
  await act(async () => checkboxFor(item.name).props.onChange());

  await act(async () => findByText('button', 'Add selected services').props.onClick());

  expect(apiFetch).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining(item.name));
});

it('"Apply to all" fills every selected blank price without overwriting one already typed in individually', async () => {
  const [first, second] = SERVICE_CATALOG;
  await act(async () => {
    tree = renderPicker();
  });
  await act(async () => checkboxFor(first.name).props.onChange());
  await act(async () => checkboxFor(second.name).props.onChange());
  await act(async () => priceInputFor(first).props.onChange({ target: { value: '450' } }));

  const bulkInput = tree.root.findByProps({ id: 'catalog-bulk-price' });
  await act(async () => bulkInput.props.onChange({ target: { value: '300' } }));
  await act(async () => findByText('button', 'Apply to all').props.onClick());

  expect(priceInputFor(first).props.value).toBe('450');
  expect(priceInputFor(second).props.value).toBe('300');
});

it('submits the correct name/category/price/duration payload for every selected service on Add selected services', async () => {
  const [first, second] = SERVICE_CATALOG;
  apiFetch.mockImplementation(async (_path, init) => ({
    id: `created-${JSON.parse(init.body).name}`,
    ...JSON.parse(init.body),
    isActive: true,
    currency: 'INR',
  }));
  const onCreated = jest.fn();
  await act(async () => {
    tree = renderPicker({ onCreated });
  });
  await act(async () => checkboxFor(first.name).props.onChange());
  await act(async () => checkboxFor(second.name).props.onChange());
  await act(async () => priceInputFor(first).props.onChange({ target: { value: '350' } }));
  await act(async () => priceInputFor(second).props.onChange({ target: { value: '500' } }));

  await act(async () => findByText('button', 'Add selected services').props.onClick());

  expect(apiFetch).toHaveBeenCalledTimes(2);
  const bodies = apiFetch.mock.calls.map(([, init]) => JSON.parse(init.body));
  const firstBody = bodies.find((b) => b.name === first.name);
  const secondBody = bodies.find((b) => b.name === second.name);
  expect(firstBody).toMatchObject({
    name: first.name,
    category: first.category,
    price: 350,
    durationMinutes: first.defaultDurationMinutes,
  });
  expect(secondBody).toMatchObject({
    name: second.name,
    category: second.category,
    price: 500,
    durationMinutes: second.defaultDurationMinutes,
  });
  expect(onCreated).toHaveBeenCalledTimes(1);
  expect(onCreated.mock.calls[0][0]).toHaveLength(2);
});

it('Select All never re-selects a service already added to the shop', async () => {
  const existing = {
    id: 'existing-1',
    name: SERVICE_CATALOG[0].name,
    description: null,
    durationMinutes: SERVICE_CATALOG[0].defaultDurationMinutes,
    price: 100,
    category: SERVICE_CATALOG[0].category,
    isActive: true,
    currency: 'INR',
  };
  await act(async () => {
    tree = renderPicker({ services: [existing] });
  });
  await act(async () => findByText('button', 'Select all services').props.onClick());

  expect(findByTextIncludes('span', `${SERVICE_CATALOG.length - 1} selected`)).toBeDefined();
});
