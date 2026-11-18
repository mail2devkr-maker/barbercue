import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { Role } from '@barbercue/shared';
import { AdminInventoryUpload } from '../AdminInventoryUpload';
import { eanModules, productIdFromQr, productQrPayload } from '../../../inventory/ProductCodes';
import { apiFetch } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';

jest.mock('qrcode.react', () => ({ QRCodeSVG: () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }) => <a href={href} className={className}>{children}</a> }));
jest.mock('../../../../lib/api', () => ({ apiFetch: jest.fn(), apiFetchBlob: jest.fn(), ApiError: class extends Error {} }));
jest.mock('../../../../lib/auth-context', () => ({ useAuth: jest.fn() }));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const button = (tree, label) => tree.root.find((n) => n.type === 'button' && textOf(n).startsWith(label));

const preview = {
  jobId: '11111111-1111-4111-8111-111111111111',
  fileName: 'products.xlsx',
  fileType: 'XLSX',
  sheetName: '100 Test Products',
  sheets: ['100 Test Products', 'Read Me'],
  headerRow: 1,
  headers: ['EAN-13 Test Number', 'Product Name', 'Salon Name'],
  mapping: ['barcode', 'name', 'shop_name'],
  fieldLabels: {},
  fileWarnings: ['2 barcode pictures matched to product rows.'],
  summary: { totalRows: 3, createGlobal: 1, createShop: 0, linkShop: 1, unchanged: 0, skipped: 0, review: 1, errors: 0, warnings: 0, globalRows: 1, shopRows: 2, embeddedImages: 2 },
  rows: [
    { rowNumber: 2, action: 'CREATE_GLOBAL', barcode: '2000000000015', symbology: 'EAN-13', name: 'Daily Shampoo', shop: null, shopText: null, isTestData: true, issues: [] },
    { rowNumber: 3, action: 'LINK_SHOP', barcode: '2000000000015', symbology: 'EAN-13', name: 'Daily Shampoo', shop: { id: 's1', name: 'Ayushi Shop' }, shopText: 'Ayushi Shop', isTestData: true, issues: [] },
    { rowNumber: 4, action: 'REVIEW', barcode: '2000000000022', symbology: 'EAN-13', name: 'Gel', shop: null, shopText: 'Nowhere Salon', isTestData: false, issues: [{ severity: 'REVIEW', code: 'SHOP_NAME_UNKNOWN', field: 'shop_name', message: 'No FastQue shop is called "Nowhere Salon".' }] },
  ],
  previousImports: [],
  testDataInProductionBlocked: false,
};

beforeEach(() => apiFetch.mockReset());

describe('admin Upload Inventory', () => {
  it('previews a file (nothing saved), then commits that job only after confirmation', async () => {
    useAuth.mockReturnValue({ user: { roles: [Role.PLATFORM_ADMIN] } });
    apiFetch.mockImplementation((path) => {
      if (path.endsWith('/preview')) return Promise.resolve(preview);
      if (path.endsWith('/commit')) return Promise.resolve({ id: preview.jobId, fileName: 'products.xlsx', status: 'COMPLETED_WITH_ERRORS', createdCount: 1, linkedCount: 1, unchangedCount: 0, skippedCount: 0, reviewCount: 1, errorCount: 0 });
      return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    });
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminInventoryUpload />); });
    expect(textOf(tree.root)).toContain('Upload Product Database');
    const input = tree.root.find((n) => n.type === 'input' && n.props.type === 'file');
    const file = new File(['x'], 'products.xlsx');
    await act(async () => input.props.onChange({ target: { files: [file], value: '' } }));
    const [path, init] = apiFetch.mock.calls.find(([p]) => p.endsWith('/preview'));
    expect(path).toBe('admin/inventory-uploads/preview');
    expect(init.body.get('file')).toBe(file);
    const text = textOf(tree.root);
    expect(text).toContain('nothing has been saved yet');
    expect(text).toContain('No FastQue shop is called "Nowhere Salon".');
    expect(text).toContain('TEST DATA');
    expect(apiFetch.mock.calls.some(([p]) => p.endsWith('/commit'))).toBe(false);
    await act(async () => button(tree, 'Confirm import (2 rows)').props.onClick());
    expect(apiFetch.mock.calls.some(([p]) => p === `admin/inventory-uploads/${preview.jobId}/commit`)).toBe(true);
    expect(textOf(tree.root)).toContain('Imported with issues');
  });

  it('viewers cannot upload', async () => {
    useAuth.mockReturnValue({ user: { roles: [Role.PLATFORM_VIEWER] } });
    apiFetch.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    let tree;
    await act(async () => { tree = TestRenderer.create(<AdminInventoryUpload />); });
    expect(textOf(tree.root)).toContain('Only platform admins and co-founders can upload products.');
    expect(tree.root.findAll((n) => n.type === 'input' && n.props.type === 'file')).toHaveLength(0);
  });
});

describe('product codes', () => {
  it('encodes EAN-13 / UPC-A / EAN-8 into the right number of modules and rejects bad check digits', () => {
    expect(eanModules('2000000000015').bits).toHaveLength(95);
    expect(eanModules('2000000000015').bits.slice(0, 3)).toBe('101');
    expect(eanModules('012345678905').bits).toHaveLength(95);
    expect(eanModules('96385074').bits).toHaveLength(67);
    expect(eanModules('2000000000016')).toBeNull();
  });
  it('QR payload carries the FastQue product id, distinct from any barcode', () => {
    const id = '0b0f5f2e-6c2a-4a8e-9b1c-2f3e4d5c6b7a';
    expect(productQrPayload(id)).toBe(`fastque:product:${id}`);
    expect(productIdFromQr(productQrPayload(id))).toBe(id);
    expect(productIdFromQr('2000000000015')).toBeNull();
  });
});
