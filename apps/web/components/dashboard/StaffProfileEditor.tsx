"use client";

import { useState } from "react";
import { DASHBOARD_PATHS, updateSalonStaffSchema } from "@barbercue/shared";
import type { SalonStaffDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

/**
 * Phase 17 (Barber Professional Profile) — owner-editable bio/photo/experience for one barber,
 * shown to customers on the salon's public profile ("Meet the team") and the booking flow's
 * barber picker. Submits directly against the member the parent list already holds (no separate
 * GET) since PATCH dashboard/salons/:salonId/staff/:staffId already returns the full SalonStaffDto.
 */
export function StaffProfileEditor({
  salonId,
  member,
  onSaved,
}: {
  salonId: string;
  member: SalonStaffDto;
  onSaved: (updated: SalonStaffDto) => void;
}) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}/${member.id}`;
  const [bio, setBio] = useState(member.bio ?? "");
  const [photoUrl, setPhotoUrl] = useState(member.photoUrl ?? "");
  const [yearsExperience, setYearsExperience] = useState(
    member.yearsExperience !== null ? String(member.yearsExperience) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    const parsed = updateSalonStaffSchema.safeParse({
      bio,
      photoUrl,
      ...(yearsExperience.trim() ? { yearsExperience: Number(yearsExperience) } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the profile details.");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<SalonStaffDto>(base, {
        method: "PATCH",
        body: JSON.stringify(parsed.data),
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--bc-border)" }}>
      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      <div className={styles.fieldWrap} style={{ marginBottom: 10 }}>
        <label className={styles.fieldLabel} htmlFor={`bio-${member.id}`}>Bio</label>
        <textarea
          id={`bio-${member.id}`}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="A short professional bio customers will see on your shop's profile."
          className={styles.input}
        />
      </div>
      <div className={styles.fieldWrap} style={{ marginBottom: 10 }}>
        <label className={styles.fieldLabel} htmlFor={`photo-${member.id}`}>Photo URL</label>
        <input
          id={`photo-${member.id}`}
          type="url"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          placeholder="https://…"
          className={styles.input}
        />
        <p className={styles.hint}>Link an already-hosted photo — a link to Instagram, Google Business, or any https image works.</p>
      </div>
      <div className={styles.fieldWrap} style={{ marginBottom: 10, maxWidth: 200 }}>
        <label className={styles.fieldLabel} htmlFor={`years-${member.id}`}>Years of experience</label>
        <input
          id={`years-${member.id}`}
          type="number"
          min={0}
          max={80}
          value={yearsExperience}
          onChange={(e) => setYearsExperience(e.target.value)}
          className={styles.input}
        />
      </div>
      <Button type="button" variant="outline" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Saving…" : "Save profile"}
      </Button>
    </div>
  );
}
