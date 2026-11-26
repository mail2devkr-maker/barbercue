import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ShopProductDetailDto } from "@barbercue/shared";
import { ShopProduct } from "../../../../../components/shop/ShopProduct";
import { ViTrackEvent } from "../../../../../components/analytics/VisitorIntelTracker";
import { fetchDiscoveryOrNull } from "../../../../../lib/discovery-api";
import { SITE_URL } from "../../../../../lib/seo";

export const revalidate = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string): Promise<ShopProductDetailDto | null> {
  if (!UUID.test(id)) return null;
  return fetchDiscoveryOrNull<ShopProductDetailDto>(`shop/products/${id}`, revalidate).catch(() => null);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await load(id);
  if (!p) return { title: "Product not found", robots: { index: false } };
  const title = [p.brand, p.name, p.variant].filter(Boolean).join(" ");
  return {
    title,
    description: `${title}${p.fromPrice ? ` from ₹${Number(p.fromPrice)}` : ""} at FastQue partner salons. ${p.category ?? "Beauty"} — compare salon prices and pick up nearby.`,
    alternates: { canonical: `/shop/p/${p.id}` },
    // Synthetic test products are never meant for search engines.
    ...(p.isTestData ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function ShopProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await load(id);
  if (!product) notFound();
  // Product structured data only for real products with real, in-stock offers.
  const offers = product.offers.filter((o) => o.availableQuantity > 0);
  const jsonLd =
    !product.isTestData && offers.length
      ? {
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
          ...(product.barcodes[0]?.symbology === "EAN-13" ? { gtin13: product.barcodes[0].display } : {}),
          category: product.category ?? undefined,
          url: `${SITE_URL}/shop/p/${product.id}`,
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "INR",
            lowPrice: Math.min(...offers.map((o) => Number(o.price))).toFixed(2),
            highPrice: Math.max(...offers.map((o) => Number(o.price))).toFixed(2),
            offerCount: offers.length,
            availability: "https://schema.org/InStock",
          },
        }
      : null;
  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <ViTrackEvent type="product_view" entityType="product" entityId={id} module="MARKETPLACE" />
      <ShopProduct initial={product} />
    </>
  );
}
