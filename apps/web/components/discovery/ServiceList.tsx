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
    return <p style={{ color: "#6B6357" }}>No services listed yet.</p>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {services.map((s) => (
          <tr key={s.id} style={{ borderBottom: "1px solid #E7E0D3" }}>
            <td style={{ padding: "10px 0" }}>
              <div style={{ fontWeight: 600, color: "#1C1A17" }}>{s.name}</div>
              <div style={{ fontSize: "0.8rem", color: "#6B6357" }}>{s.durationMinutes} min</div>
            </td>
            <td style={{ padding: "10px 0", textAlign: "right", fontWeight: 600, color: "#1C1A17" }}>{formatMoney(s.price, currency, countryCode)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
