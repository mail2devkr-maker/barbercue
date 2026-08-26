// Shared inline-style constants for the shop-registration form and the location fields it is
// composed of. Extracted verbatim from RegisterSalonForm.tsx (Phase 6B) purely so CitySearchField
// can reuse the exact same input/hint styling instead of redefining a near-copy that would drift
// the moment either file is touched. No values changed.

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  border: "1px solid #D8D2C4",
  borderRadius: 8,
  // 16px minimum: anything smaller makes iOS Safari zoom the page on focus.
  fontSize: 16,
  boxSizing: "border-box",
};

export const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 14,
};

export const fieldWrapStyle: React.CSSProperties = { marginBottom: 18 };

export const hintStyle: React.CSSProperties = { fontSize: 13, color: "#6B6357", marginTop: 6 };

export const primaryButtonStyle: React.CSSProperties = {
  padding: "13px 20px",
  minHeight: 46, // comfortable thumb target on a phone
  borderRadius: 8,
  border: "none",
  background: "#1C1A17",
  color: "#fff",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};

export const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 16px",
  minHeight: 42,
  borderRadius: 8,
  border: "1px solid #D8D2C4",
  background: "#fff",
  fontSize: 14,
  cursor: "pointer",
};
