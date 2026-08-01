"use client";

import type { ServiceDto } from "@barbercue/shared";

export function ServiceStep({
  services,
  selectedServiceId,
  onSelect,
}: {
  services: ServiceDto[];
  selectedServiceId: string | null;
  onSelect: (serviceId: string) => void;
}) {
  return (
    <section>
      <h2 style={{ fontSize: "1.1rem" }}>1. Choose a service</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {services.map((service) => (
          <button
            key={service.id}
            type="button"
            onClick={() => onSelect(service.id)}
            style={{
              textAlign: "left",
              padding: "12px 16px",
              borderRadius: 10,
              border: service.id === selectedServiceId ? "2px solid #B0413E" : "1px solid #E7E0D3",
              background: service.id === selectedServiceId ? "#FBEFEE" : "#fff",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{service.name}</strong>
              <span>₹{service.price}</span>
            </div>
            <div style={{ color: "#6B6357", fontSize: "0.85rem" }}>{service.durationMinutes} min</div>
          </button>
        ))}
      </div>
    </section>
  );
}
