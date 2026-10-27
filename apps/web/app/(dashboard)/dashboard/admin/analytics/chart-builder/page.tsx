import { Suspense } from "react";
import { ChartBuilder } from "../../../../../../components/admin/charts/ChartBuilder";

export default function ChartBuilderPage() {
  return (
    <Suspense fallback={null}>
      <ChartBuilder />
    </Suspense>
  );
}
