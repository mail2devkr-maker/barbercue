"use client";

import {
  normalizeContactName,
  normalizeContactPhone,
  type JoinQueueInput,
} from "@barbercue/shared";
import styles from "./queue.module.css";

// The shop must be able to identify and reach everyone in its queue. FastQue stores no customer
// name, and a Google-sign-in account has no phone, so both are collected on every join.

export const CONTACT_NAME_ERROR = "Please enter your name (at least 2 letters).";
export const CONTACT_PHONE_ERROR =
  "Enter a valid mobile number, with a country code if it is not an Indian number.";

/** Validates the two fields; returns the normalized join contact or a user-facing error. */
export function resolveContactInput(
  name: string,
  phone: string,
): { ok: true; contact: Required<Pick<JoinQueueInput, "contactName" | "contactPhone">> } | { ok: false; error: string } {
  const contactName = normalizeContactName(name);
  if (!contactName) return { ok: false, error: CONTACT_NAME_ERROR };
  const contactPhone = normalizeContactPhone(phone);
  if (!contactPhone) return { ok: false, error: CONTACT_PHONE_ERROR };
  return { ok: true, contact: { contactName, contactPhone } };
}

export function QueueContactFields({
  idPrefix,
  name,
  phone,
  onNameChange,
  onPhoneChange,
}: {
  idPrefix: string;
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label className={styles.fieldLabel} htmlFor={`${idPrefix}-name`}>
        Your name
      </label>
      <input
        id={`${idPrefix}-name`}
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className={styles.select}
        autoComplete="name"
        maxLength={60}
        required
      />
      <label className={styles.fieldLabel} htmlFor={`${idPrefix}-phone`} style={{ marginTop: 12 }}>
        Mobile number
      </label>
      <input
        id={`${idPrefix}-phone`}
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        className={styles.select}
        autoComplete="tel"
        maxLength={20}
        required
      />
      <p className={styles.reassure}>The shop uses this to reach you about your turn.</p>
    </div>
  );
}
