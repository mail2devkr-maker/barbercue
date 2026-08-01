import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href: string;
}

// Visual nav. The JSON-LD BreadcrumbList for the same trail is built by breadcrumbJsonLd() below
// from this exact same items array, so the visible breadcrumb and the structured data can never
// drift apart.
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: "0.8rem", color: "#6B6357", marginBottom: 16 }}>
      {items.map((item, i) => (
        <span key={item.href}>
          {i > 0 && " / "}
          {i === items.length - 1 ? (
            <span aria-current="page">{item.label}</span>
          ) : (
            <Link href={item.href} style={{ color: "#6B6357" }}>
              {item.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export function breadcrumbJsonLd(items: BreadcrumbItem[], siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      item: `${siteUrl}${item.href}`,
    })),
  };
}
