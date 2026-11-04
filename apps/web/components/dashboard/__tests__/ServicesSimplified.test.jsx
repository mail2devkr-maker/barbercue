import React, { act, Suspense } from 'react';
import TestRenderer from 'react-test-renderer';
import ServicesPage from '../../../app/(dashboard)/dashboard/salons/[salonId]/services/page';
import { SalonTypeSection } from '../SalonTypeSection';
import { apiFetch } from '../../../lib/api';

// Issue #376: the owner's Services page has no salon-type cards and no Basic/Standard/Advance packs;
// services are created only by the owner. The shop's customer-search type lives in Settings.
jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));
jest.mock('../../auth/RequireRole', () => ({ RequireRole: ({ children }) => <>{children}</> }));
jest.mock('../SetupNavigation', () => ({ SetupNavigation: () => null }));
jest.mock('../CatalogImportPanel', () => ({ CatalogImportPanel: () => <section>Import services from your own catalog (PDF / photo)</section> }));
jest.mock('../RemoveAllServicesControl', () => ({ RemoveAllServicesControl: () => null }));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const BASE = 'dashboard/salons/s1/services';
const existing = [
  { id: 'a', name: 'Fade Cut', price: 250, currency: 'INR', durationMinutes: 30, isActive: true, description: null, category: 'Hair', categoryId: null, subcategoryId: null },
  { id: 'b', name: 'Beard Trim', price: 120, currency: 'INR', durationMinutes: 15, isActive: true, description: null, category: 'Beard', categoryId: null, subcategoryId: null },
];

beforeEach(() => {
  apiFetch.mockReset();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function renderPage() {
  apiFetch.mockImplementation((path, init) => {
    if (path === BASE && !init) return Promise.resolve(existing);
    if (path.endsWith('/service-categories')) return Promise.reject(new Error('no tree'));
    if (path === BASE && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      return Promise.resolve({ id: 'new', currency: 'INR', isActive: true, categoryId: null, subcategoryId: null, category: body.category ?? null, description: body.description ?? null, ...body });
    }
    return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${path}`));
  });
  let tree;
  const params = Promise.resolve({ salonId: 's1' });
  await act(async () => {
    tree = TestRenderer.create(<Suspense fallback={<p>loading</p>}><ServicesPage params={params} /></Suspense>);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
  return tree;
}

describe('Services page without presets (#376)', () => {
  it('shows no salon-type cards, no service packs, no Select All and never asks for the salon type', async () => {
    const tree = await renderPage();
    const text = textOf(tree.root);
    for (const gone of ['Gents Parlor', 'Ladies Parlor', 'Unisex Salon', 'Select salon type', 'service pack', 'Basic Salon', 'Standard Salon', 'Advance Salon', 'Select all', 'Select All', 'presets', 'Choose common services']) {
      expect(text).not.toContain(gone);
    }
    expect(apiFetch.mock.calls.some(([p]) => String(p).includes('salon-type'))).toBe(false);
  });

  it('keeps Add a service, the owner catalog import and the existing services unchanged', async () => {
    const tree = await renderPage();
    const text = textOf(tree.root);
    expect(text).toContain('Add a service');
    expect(text).toContain('Import services from your own catalog');
    expect(text).toContain('Fade Cut');
    expect(text).toContain('Beard Trim');
    expect(text.indexOf('Add a service')).toBeLessThan(text.indexOf('Import services from your own catalog'));
  });

  it('an owner creates a service with their own name, price and duration; nothing else is created', async () => {
    const tree = await renderPage();
    const field = (id) => tree.root.find((n) => n.props.id === id);
    await act(async () => field('svc-name').props.onChange({ target: { value: 'Keratin Spa Deluxe' } }));
    await act(async () => field('svc-price').props.onChange({ target: { value: '1499' } }));
    await act(async () => field('svc-minutes').props.onChange({ target: { value: '75' } }));
    await act(async () => field('svc-description').props.onChange({ target: { value: 'Owner wording' } }));
    const form = tree.root.find((n) => n.type === 'form' && textOf(n).includes('Service name'));
    await act(async () => form.props.onSubmit({ preventDefault() {} }));
    const posts = apiFetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(BASE);
    expect(JSON.parse(posts[0][1].body)).toMatchObject({ name: 'Keratin Spa Deluxe', price: 1499, durationMinutes: 75, description: 'Owner wording' });
    expect(textOf(tree.root)).toContain('Keratin Spa Deluxe added.');
  });

  it('with no services there is no preset suggestion, only the owner path', async () => {
    apiFetch.mockImplementation((path) => (String(path).endsWith('/service-categories') ? Promise.reject(new Error('x')) : Promise.resolve([])));
    let tree;
    await act(async () => {
      tree = TestRenderer.create(<Suspense fallback={null}><ServicesPage params={Promise.resolve({ salonId: 's1' })} /></Suspense>);
    });
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
    expect(textOf(tree.root)).toContain('No active services yet. Add your first service above.');
    expect(apiFetch.mock.calls.every(([, init]) => !init || init.method === undefined)).toBe(true);
  });
});

describe('Shop type for customer search, in Settings (#376)', () => {
  const PATH = 'dashboard/salons/s1/services/salon-type';
  it('loads the type, says it is unconfirmed, and confirming it never touches services', async () => {
    apiFetch.mockImplementation((path, init) => {
      if (path === PATH && !init) return Promise.resolve({ salonType: 'UNISEX', salonTypeConfirmed: false });
      if (path === PATH && init?.method === 'PATCH') return Promise.resolve({ salonType: JSON.parse(init.body).salonType, salonTypeConfirmed: true });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    let tree;
    await act(async () => { tree = TestRenderer.create(<SalonTypeSection salonId="s1" />); });
    expect(textOf(tree.root)).toContain('Type not set');
    expect(textOf(tree.root)).toContain('It does not add, change or remove any of your services.');
    const gents = tree.root.find((n) => n.type === 'button' && textOf(n).includes('Gents salon'));
    await act(async () => gents.props.onClick());
    expect(apiFetch).toHaveBeenLastCalledWith(PATH, { method: 'PATCH', body: JSON.stringify({ salonType: 'GENTS' }) });
    expect(textOf(tree.root)).toContain('Your services did not change.');
    expect(textOf(tree.root)).not.toContain('Type not set');
    expect(apiFetch.mock.calls.every(([p]) => p === PATH)).toBe(true);
  });

  it('re-choosing the confirmed type does nothing; the unconfirmed default can be confirmed by tapping it', async () => {
    apiFetch.mockImplementation((path, init) => (init ? Promise.resolve({ salonType: 'UNISEX', salonTypeConfirmed: true }) : Promise.resolve({ salonType: 'UNISEX', salonTypeConfirmed: true })));
    let tree;
    await act(async () => { tree = TestRenderer.create(<SalonTypeSection salonId="s1" />); });
    await act(async () => tree.root.find((n) => n.type === 'button' && textOf(n).includes('Unisex salon')).props.onClick());
    expect(apiFetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  });
});
