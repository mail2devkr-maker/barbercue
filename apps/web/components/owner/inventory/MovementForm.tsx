"use client";

import { useState } from "react";
import { INVENTORY_PATHS } from "@barbercue/shared";
import type { InventoryMovementDto, InventoryProductDto, InventorySupplierDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import {
  EMPTY_MOVEMENT,
  buildMovement,
  kindLabel,
  movementErrorText,
  movementSummary,
  newMovementKey,
  quantityText,
  unitShort,
  type MovementErrors,
  type MovementForm as Form,
  type MovementKind,
} from "../../../lib/inventory";
import { inventoryBase } from "../../../lib/use-inventory-lookups";
import { Banner, Btn, Dialog, Field } from "../parts";
import { ProductPicker } from "./shared";
import ui from "../owner.module.css";

interface Recorded {
  movement: InventoryMovementDto;
  created: boolean;
}

/**
 * One stock movement: opening stock, a purchase, stock used, or an adjustment. The owner picks a product, enters what happened,
 * reviews a plain sentence, and confirms. The server decides whether it is allowed (for example, not enough stock) and returns
 * the balance after it: that returned balance is the only balance shown. One attempt carries one Idempotency-Key, kept when the
 * same attempt is retried after a network failure and renewed whenever the entry changes, so a repeat can never record twice.
 */
export function MovementForm({
  salonId,
  kind,
  suppliers = [],
  fixedProduct = null,
  onRecorded,
}: {
  salonId: string;
  kind: MovementKind;
  suppliers?: InventorySupplierDto[];
  /** A product already chosen by the page (for example "Record opening stock" on a product row). */
  fixedProduct?: InventoryProductDto | null;
  onRecorded?: (result: Recorded) => void;
}) {
  const [product, setProduct] = useState<InventoryProductDto | null>(fixedProduct);
  const [form, setForm] = useState<Form>(EMPTY_MOVEMENT);
  const [errors, setErrors] = useState<MovementErrors>({});
  const [attemptKey, setAttemptKey] = useState(() => newMovementKey());
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<(Recorded & { unit: string }) | null>(null);

  const built = product ? buildMovement(kind, form) : null;
  const incoming = kind === "OPENING" || kind === "PURCHASE";

  function edit(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }));
    setAttemptKey(newMovementKey()); // a changed entry is a new attempt
    setSubmitError(null);
    setRecorded(null);
  }

  function chooseProduct(next: InventoryProductDto | null) {
    setProduct(next);
    setAttemptKey(newMovementKey());
    setSubmitError(null);
    setRecorded(null);
  }

  function review() {
    setSubmitError(null);
    setRecorded(null);
    if (!product) {
      setErrors({ quantity: "Choose a product first." });
      return;
    }
    const result = buildMovement(kind, form);
    setErrors(result.errors);
    if (result.body) setConfirming(true);
  }

  async function submit() {
    if (!product || !built?.body) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await apiFetch<Recorded>(`${inventoryBase(salonId)}/${INVENTORY_PATHS.products}/${product.id}/${INVENTORY_PATHS.movements}`, {
        method: "POST",
        headers: { "Idempotency-Key": attemptKey },
        body: JSON.stringify(built.body),
      });
      setRecorded({ ...result, unit: product.unit });
      setConfirming(false);
      setForm(EMPTY_MOVEMENT);
      setErrors({});
      setAttemptKey(newMovementKey());
      // The balance shown next to a pre-chosen product is the one the server just returned.
      if (fixedProduct) setProduct({ ...product, stockOnHand: result.movement.stockAfter });
      else setProduct(null);
      onRecorded?.(result);
    } catch (err) {
      setConfirming(false);
      setSubmitError(err instanceof ApiError ? movementErrorText(err.code, err.message) : "Could not reach the server. Nothing was confirmed; you can press the same button again safely.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <ProductPicker salonId={salonId} value={product} onChange={chooseProduct} id={`picker-${kind}`} />

      {product && (
        <div className={ui.mt12}>
          <div className={ui.rowWrap}>
            <Field label={`Quantity (${unitShort(product.unit)})`} htmlFor={`qty-${kind}`} hint={errors.quantity}>
              <input id={`qty-${kind}`} className={ui.input} inputMode="decimal" value={form.quantity} onChange={(e) => edit({ quantity: e.target.value })} aria-invalid={Boolean(errors.quantity)} autoComplete="off" />
            </Field>
            {incoming && (
              <Field label={`Cost per ${unitShort(product.unit)}`} htmlFor={`cost-${kind}`} hint={errors.unitCost ?? "What you paid for one unit."}>
                <input id={`cost-${kind}`} className={ui.input} inputMode="decimal" value={form.unitCost} onChange={(e) => edit({ unitCost: e.target.value })} aria-invalid={Boolean(errors.unitCost)} autoComplete="off" />
              </Field>
            )}
            {kind === "PURCHASE" && (
              <Field label="Supplier (optional)" htmlFor={`supplier-${kind}`}>
                <select id={`supplier-${kind}`} className={ui.input} value={form.supplierId} onChange={(e) => edit({ supplierId: e.target.value })}>
                  <option value="">No supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {kind === "ADJUSTMENT" && (
              <Field label="Stock goes" htmlFor={`dir-${kind}`} hint={errors.direction}>
                <select id={`dir-${kind}`} className={ui.input} value={form.direction} onChange={(e) => edit({ direction: e.target.value as Form["direction"] })} aria-invalid={Boolean(errors.direction)}>
                  <option value="">Choose…</option>
                  <option value="INCREASE">Up (found more than recorded)</option>
                  <option value="DECREASE">Down (lost, damaged, expired…)</option>
                </select>
              </Field>
            )}
          </div>
          {(kind === "ADJUSTMENT" || kind === "CONSUMPTION" || kind === "PURCHASE") && (
            <div className={ui.rowWrap}>
              <Field label={kind === "ADJUSTMENT" ? "Reason (required)" : "Note (optional)"} htmlFor={`reason-${kind}`} hint={errors.reason}>
                <input id={`reason-${kind}`} className={ui.input} maxLength={300} value={form.reason} onChange={(e) => edit({ reason: e.target.value })} aria-invalid={Boolean(errors.reason)} autoComplete="off" />
              </Field>
              <Field label="Reference (optional)" htmlFor={`ref-${kind}`} hint={errors.reference ?? "An invoice or bill number."}>
                <input id={`ref-${kind}`} className={ui.input} maxLength={120} value={form.reference} onChange={(e) => edit({ reference: e.target.value })} autoComplete="off" />
              </Field>
            </div>
          )}
          {kind === "CONSUMPTION" && <p className={ui.cardSub}>The server refuses this if there is not enough stock, and then nothing is recorded.</p>}
          {kind === "OPENING" && <p className={ui.cardSub}>Opening stock can be recorded once per product. After that, use purchases and adjustments.</p>}
        </div>
      )}

      {submitError && <div className={ui.mt12}><Banner tone="error">{submitError}</Banner></div>}
      <div role="status" aria-live="polite">
        {recorded && (
          <div className={ui.mt12}>
            <Banner tone="ok">
              {recorded.created ? `${kindLabel(recorded.movement.kind)} recorded.` : "This had already been recorded, so nothing was added again."}{" "}
              Stock of {recorded.movement.productName} is now {quantityText(recorded.movement.stockAfter, recorded.unit)} as reported by the server.
            </Banner>
          </div>
        )}
      </div>
      <div className={`${ui.rowWrap} ${ui.mt12}`}>
        <Btn variant="primary" onClick={review} disabled={submitting || !product}>Review</Btn>
      </div>

      {confirming && product && built?.body && (
        <Dialog title={`Confirm: ${kindLabel(kind).toLowerCase()}`} onClose={() => !submitting && setConfirming(false)}>
          <p>{movementSummary(kind, product, built.body)}</p>
          <p className={ui.cardSub}>Entries cannot be edited or deleted afterwards. A mistake is corrected with an adjustment.</p>
          <div className={`${ui.rowWrap} ${ui.mt12}`}>
            <Btn variant="primary" onClick={() => void submit()} disabled={submitting}>{submitting ? "Recording…" : "Confirm and record"}</Btn>
            <Btn variant="quiet" onClick={() => setConfirming(false)} disabled={submitting}>Back</Btn>
          </div>
        </Dialog>
      )}
    </div>
  );
}
