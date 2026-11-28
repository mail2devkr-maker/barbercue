import { Suspense } from "react";
import { OwnerConnect } from "../../../../components/connect/OwnerConnect";

// An independent FastQue Home professional's chats with their customers.
export default function Page() {
  return <Suspense><OwnerConnect provider /></Suspense>;
}
