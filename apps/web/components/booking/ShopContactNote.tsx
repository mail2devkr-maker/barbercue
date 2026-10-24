import { telHrefFor } from "@barbercue/shared";

/**
 * Where a customer should reach the shop about a reschedule or a cancellation charge (owner issue #45).
 *
 * It shows ONLY `shopPhone`, which the server sends exclusively when the owner chose to publish the
 * shop's business phone (Salon.showPhoneToCustomers). It never receives, and so can never show, the
 * owner's personal account number. With nothing dialable it renders nothing at all - no placeholder,
 * no invented number.
 */
export function ShopContactNote({
  shopPhone,
  salonName,
  purpose,
  className,
}: {
  shopPhone: string | null | undefined;
  salonName: string;
  purpose: "reschedule" | "charge";
  className?: string;
}) {
  const href = telHrefFor(shopPhone);
  if (!href) return null;
  const display = (shopPhone ?? "").trim();
  return (
    <p className={className} data-testid="shop-contact-note">
      {purpose === "charge"
        ? `To ask ${salonName} about this charge, call `
        : `To arrange a different change with ${salonName}, call `}
      <a href={href}>{display}</a>.
    </p>
  );
}
