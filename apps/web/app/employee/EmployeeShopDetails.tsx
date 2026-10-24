"use client";

import { useState } from "react";
import { EMPLOYEE_PATHS, type EmployeeLeadShopDto } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { SalonImage } from "../../components/ui/SalonImage";
import styles from "./employee.module.css";

/**
 * Read-only details of a shop this employee onboarded (owner issue #28): address, photos and chairs, straight from the shop's own records.
 * Loaded only when asked for. It offers no editing - changing a shop is the owner's decision, so there is nothing here that can alter it.
 */
export function EmployeeShopDetails({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EmployeeLeadShopDto | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<EmployeeLeadShopDto>(`${EMPLOYEE_PATHS.employee}/${EMPLOYEE_PATHS.leads}/${leadId}/${EMPLOYEE_PATHS.shop}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the shop details.");
    } finally {
      setLoading(false);
    }
  }

  const shop = data?.shop ?? null;
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className={styles.smallButton} aria-expanded={open} onClick={() => void toggle()}>
        {open ? "Hide shop details" : "Shop details"}
      </button>
      {open && (
        <div role="region" aria-label="Shop details" style={{ marginTop: 8, display: "grid", gap: 8, minWidth: 240 }}>
          {loading && <small>Loading shop details…</small>}
          {error && <small role="alert">{error}</small>}
          {data && !shop && <small>This lead has no onboarded shop on record yet.</small>}
          {shop && (
            <>
              <div>
                <strong>{shop.name}</strong>
                <small style={{ display: "block" }}>
                  {shop.addressLine}
                  {shop.localityText ? `, ${shop.localityText}` : ""}, {shop.cityName}
                </small>
                <small style={{ display: "block" }}>
                  Status: {shop.status.toLowerCase()} ·{" "}
                  {shop.businessPhone ? <>Business phone {shop.businessPhone}</> : "No business phone published"}
                </small>
              </div>
              <div>
                <small>
                  Chairs: {shop.chairCounts.active} active of {shop.chairCounts.total}
                </small>
                {shop.chairs.length === 0 ? (
                  <small style={{ display: "block" }}>No chairs added yet.</small>
                ) : (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {shop.chairs.map((chair) => (
                      <li key={chair.id}>
                        <small>
                          {chair.label} — {chair.status.toLowerCase()}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <small>Photos: {shop.photos.length}</small>
                {shop.photos.length === 0 ? (
                  <small style={{ display: "block" }}>No photos uploaded yet.</small>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 6, marginTop: 4 }}>
                    {shop.photos.map((photo) => (
                      <SalonImage key={photo.id} url={photo.url} alt={photo.altText ?? `${shop.name} photo`} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
