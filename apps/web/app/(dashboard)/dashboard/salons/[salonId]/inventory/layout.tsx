import type { ReactNode } from "react";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { PageHead } from "../../../../../../components/owner/parts";
import { InventoryTabs } from "../../../../../../components/owner/inventory/shared";

export default async function InventoryLayout({ children, params }: { children: ReactNode; params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Inventory">
        <PageHead eyebrow="Shop" title="Inventory" sub="Track the products you keep: what you bought, what you used and what is left. Stock only changes through recorded entries." />
        <InventoryTabs salonId={salonId} />
        {children}
      </main>
    </OwnerOnly>
  );
}
