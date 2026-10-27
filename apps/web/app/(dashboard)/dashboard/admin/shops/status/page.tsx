import { Suspense } from "react";
import { ShopStatusBoard } from "../../../../../../components/admin/shops/ShopStatusBoard";

export default function ShopStatusPage() {
  return (
    <Suspense fallback={null}>
      <ShopStatusBoard />
    </Suspense>
  );
}
