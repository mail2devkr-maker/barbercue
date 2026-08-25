import Link from "next/link";
import type { SalonListItemDto } from "@barbercue/shared";
import { formatMoney } from "@barbercue/shared";

// styleName is optional and only ever set by the search page when the visitor arrived via the AI
// Style Advisor's "Try This Look" hand-off — forwarded into the link so the chosen style survives
// through to the salon profile page's "Book an appointment" CTA, and from there into the booking
// form. Every other caller (landing page's Featured Shops, plain search) omits it and behaves
// exactly as before.
export function SalonCard({ salon, styleName }: { salon: SalonListItemDto; styleName?: string }) {
  const href = `/${salon.countryCode.toLowerCase()}/${salon.citySlug}/${salon.slug}${styleName ? `?style=${encodeURIComponent(styleName)}` : ""}`;
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E7E0D3",
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#1C1A17" }}>{salon.name}</h3>
        <p style={{ margin: "4px 0", fontSize: "0.85rem", color: "#6B6357" }}>{salon.addressLine}</p>
        <div style={{ display: "flex", gap: 12, fontSize: "0.85rem", color: "#6B6357" }}>
          {salon.ratingAverage !== null && (
            <span>
              ★ {salon.ratingAverage.toFixed(1)} ({salon.ratingCount})
            </span>
          )}
          {salon.priceMin !== null && (
            <span>
              {formatMoney(salon.priceMin, salon.currency, salon.countryCode)}
              {salon.priceMax !== null && salon.priceMax !== salon.priceMin
                ? `–${formatMoney(salon.priceMax, salon.currency, salon.countryCode)}`
                : ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
