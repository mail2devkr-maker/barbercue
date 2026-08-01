import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Phase 1 foundation: pass-through only. Complete authentication is explicitly out of scope for
// this phase. Once auth exists (Phase 2), this gates by role per ARCHITECTURE.md §5:
//   - /account/*            → requires an authenticated CUSTOMER
//   - /dashboard/admin/*    → requires PLATFORM_ADMIN
//   - /dashboard/salons/*   → requires SALON_STAFF or SALON_OWNER, scoped to that salonId
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by the Proxy function signature; used once role-gating lands
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/dashboard/:path*"],
};
