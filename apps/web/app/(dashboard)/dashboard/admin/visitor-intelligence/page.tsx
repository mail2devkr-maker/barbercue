import { Suspense } from "react";
import { VisitorIntelligence } from "../../../../../components/admin/visitor-intel/VisitorIntelligence";

export default function VisitorIntelligencePage() {
  return (
    <Suspense fallback={null}>
      <VisitorIntelligence />
    </Suspense>
  );
}
