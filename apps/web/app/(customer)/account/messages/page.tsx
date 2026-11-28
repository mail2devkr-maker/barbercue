import { Suspense } from "react";
import { CustomerMessages } from "../../../../components/connect/CustomerMessages";

export default function Page() {
  return <Suspense><CustomerMessages /></Suspense>;
}
