export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F6F2EA",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#FFFFFF",
          borderRadius: 12,
          border: "1px solid #E7E0D3",
          padding: "2rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1C1A17", marginBottom: subtitle ? 4 : 24 }}>
          {title}
        </h1>
        {subtitle && <p style={{ fontSize: "0.875rem", color: "#6B6357", marginBottom: 24 }}>{subtitle}</p>}
        {children}
      </div>
    </main>
  );
}

export const authInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.75rem",
  borderRadius: 8,
  border: "1px solid #E7E0D3",
  fontSize: "0.95rem",
  marginBottom: 12,
};

export const authButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  borderRadius: 8,
  border: "none",
  background: "#B0413E",
  color: "#FFFFFF",
  fontWeight: 600,
  fontSize: "0.95rem",
  cursor: "pointer",
  marginTop: 4,
};

export const authErrorStyle: React.CSSProperties = {
  color: "#E24B4A",
  fontSize: "0.85rem",
  marginBottom: 12,
};
