import {
  buildInventoryMovementInput,
  inventoryMovementsPath,
  inventoryProductPath,
  inventoryProductsCollectionPath,
  inventoryProductsPath,
  inventoryReportPath,
  parseInventoryNumber,
} from '../inventory';

describe('owner inventory request helpers', () => {
  it('keeps inventory requests salon-scoped and encodes filter/cursor values', () => {
    expect(inventoryReportPath('salon/id')).toBe('dashboard/salons/salon%2Fid/inventory/report');
    expect(inventoryProductsCollectionPath('shop')).toBe('dashboard/salons/shop/inventory/products');
    expect(inventoryProductsPath('shop', { q: 'hair color', lowStock: true, cursor: 'cursor value' })).toContain('q=hair+color');
    expect(inventoryProductsPath('shop', { q: 'hair color', lowStock: true, cursor: 'cursor value' })).toContain('lowStock=true');
    expect(inventoryProductsPath('shop', { q: 'hair color', lowStock: true, cursor: 'cursor value' })).toContain('cursor=cursor+value');
    expect(inventoryProductPath('shop', 'product/id')).toBe('dashboard/salons/shop/inventory/products/product%2Fid/movements');
    expect(inventoryMovementsPath('shop', 'product')).toContain('productId=product');
  });

  it('rejects invalid numeric input without coercing blanks or non-finite values', () => {
    expect(parseInventoryNumber('', true)).toBeNull();
    expect(parseInventoryNumber('NaN', true)).toBeNull();
    expect(parseInventoryNumber('-1', true)).toBeNull();
    expect(parseInventoryNumber('0', false)).toBeNull();
    expect(parseInventoryNumber('0', true)).toBe(0);
    expect(parseInventoryNumber('1.25', false)).toBe(1.25);
  });

  it('builds only server-supported movement shapes', () => {
    expect(buildInventoryMovementInput('OPENING', '10', '2.5', 'INCREASE', '')).toEqual({ kind: 'OPENING', quantity: 10, unitCost: 2.5 });
    expect(buildInventoryMovementInput('PURCHASE', '1', '0', 'INCREASE', '')).toEqual({ kind: 'PURCHASE', quantity: 1, unitCost: 0 });
    expect(buildInventoryMovementInput('ADJUSTMENT', '2', '', 'DECREASE', 'counted stock')).toEqual({ kind: 'ADJUSTMENT', quantity: 2, adjustmentDirection: 'DECREASE', reason: 'counted stock' });
    expect(buildInventoryMovementInput('ADJUSTMENT', '2', '', 'DECREASE', '')).toBeNull();
    expect(buildInventoryMovementInput('PURCHASE', '2', '', 'INCREASE', '')).toBeNull();
    expect(buildInventoryMovementInput('PURCHASE', '0', '1', 'INCREASE', '')).toBeNull();
  });
});
