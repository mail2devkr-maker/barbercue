export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bc-surface)",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#FFFFFF",
          borderRadius: "var(--bc-radius-lg)",
          border: "1px solid var(--bc-border)",
          boxShadow: "var(--bc-shadow-lg)",
          padding: "2rem",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "var(--bc-ink)",
            letterSpacing: "-0.01em",
            marginBottom: subtitle ? 4 : 24,
          }}
        >
          {title}
        </h1>
        {subtitle && <p style={{ fontSize: "0.875rem", color: "var(--bc-muted)", marginBottom: 24 }}>{subtitle}</p>}
        {children}
      </div>
    </main>
  );
}

export const authInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.7rem 0.75rem",
  borderRadius: "var(--bc-radius-sm)",
  border: "1px solid var(--bc-border)",
  fontFamily: "var(--font-body)",
  color: "var(--bc-ink)",
  // Exactly 1rem, not 0.95: below 16px, iOS Safari zooms the whole page in when the field is
  // focused and never zooms back out. Every auth screen is a phone-first screen — a barber
  // redeeming their invitation on /reset-password most of all.
  fontSize: "1rem",
  marginBottom: 12,
  boxSizing: "border-box",
};

export const authButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  borderRadius: "var(--bc-radius-sm)",
  border: "none",
  background: "var(--bc-accent)",
  color: "var(--bc-accent-contrast)",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  fontSize: "0.95rem",
  cursor: "pointer",
  marginTop: 4,
  transition: "box-shadow 0.15s ease, transform 0.15s ease",
};

export const authErrorStyle: React.CSSProperties = {
  color: "var(--bc-accent)",
  fontSize: "0.85rem",
  marginBottom: 12,
};
