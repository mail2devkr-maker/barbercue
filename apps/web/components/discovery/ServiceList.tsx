import type { ServiceDto } from "@barbercue/shared";
import { formatMoney } from "@barbercue/shared";

export function ServiceList({
  services,
  currency,
  countryCode,
}: {
  services: ServiceDto[];
  // Threaded from the owning salon: ServiceDto carries a bare amount, and the currency it is
  // denominated in belongs to the salon, not the service.
  currency: string | null;
  countryCode?: string | null;
}) {
  if (services.length === 0) {
    return <p style={{ color: "var(--bc-muted)" }}>No services listed yet.</p>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {services.map((s) => (
          <tr key={s.id} style={{ borderBottom: "1px solid var(--bc-border)" }}>
            <td style={{ padding: "16px 0" }}>
              <div style={{ fontWeight: 600, fontSize: "1.02rem", color: "var(--bc-ink)" }}>{s.name}</div>
              <div style={{ fontSize: "0.85rem", color: "var(--bc-muted)", marginTop: 2 }}>{s.durationMinutes} min</div>
            </td>
            <td style={{ padding: "16px 0", textAlign: "right", fontWeight: 600, fontSize: "1.02rem", color: "var(--bc-ink)", whiteSpace: "nowrap" }}>
              {formatMoney(s.price, currency, countryCode)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
