import {
  INVENTORY_PATHS,
  InventoryMovementKind,
  type CreateInventoryMovementInput,
} from '@barbercue/shared';

export function inventoryRootPath(salonId: string): string {
  return 'dashboard/salons/' + encodeURIComponent(salonId) + '/' + INVENTORY_PATHS.root;
}

export function inventoryReportPath(salonId: string): string {
  return inventoryRootPath(salonId) + '/' + INVENTORY_PATHS.report;
}

export function inventoryProductsCollectionPath(salonId: string): string {
  return inventoryRootPath(salonId) + '/' + INVENTORY_PATHS.products;
}

export function inventoryProductsPath(
  salonId: string,
  options: { q?: string; lowStock?: boolean; cursor?: string } = {},
): string {
  const query = new URLSearchParams();
  query.set('limit', '25');
  if (options.q) query.set('q', options.q);
  if (options.lowStock) query.set('lowStock', 'true');
  if (options.cursor) query.set('cursor', options.cursor);
  return inventoryRootPath(salonId) + '/' + INVENTORY_PATHS.products + '?' + query.toString();
}

export function inventoryProductPath(salonId: string, productId: string): string {
  return inventoryRootPath(salonId) + '/' + INVENTORY_PATHS.products + '/' + encodeURIComponent(productId) + '/' + INVENTORY_PATHS.movements;
}

export function inventoryMovementsPath(salonId: string, productId: string): string {
  const query = new URLSearchParams({ limit: '20', productId });
  return inventoryRootPath(salonId) + '/' + INVENTORY_PATHS.movements + '?' + query.toString();
}

export function parseInventoryNumber(value: string, allowZero: boolean): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) return null;
  return parsed;
}

export function buildInventoryMovementInput(
  kind: 'OPENING' | 'PURCHASE' | 'ADJUSTMENT',
  quantityValue: string,
  unitCostValue: string,
  direction: 'INCREASE' | 'DECREASE',
  reason: string,
): CreateInventoryMovementInput | null {
  const quantity = parseInventoryNumber(quantityValue, false);
  if (quantity === null) return null;
  if (kind === InventoryMovementKind.ADJUSTMENT) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) return null;
    return { kind, quantity, adjustmentDirection: direction, reason: normalizedReason };
  }
  const unitCost = parseInventoryNumber(unitCostValue, true);
  if (unitCost === null) return null;
  return { kind, quantity, unitCost };
}
