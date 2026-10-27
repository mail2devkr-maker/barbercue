import { notFound } from "next/navigation";
import { PlannedFeature } from "../../../../../../components/admin/shell/PlannedFeature";
import { plannedItem } from "../../../../../../components/admin/shell/admin-nav";

// Sidebar entries from the Admin Dashboard 2.1 blueprint that need data FastQue does not record yet.
export default async function PlannedFeaturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = plannedItem(id);
  if (!item) notFound();
  return <PlannedFeature label={item.label} needs={item.needs ?? ""} />;
}
