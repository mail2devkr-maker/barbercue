import type { Metadata } from "next";
import { Role } from "@barbercue/shared";
import BackendStatus from "./BackendStatus";

export const metadata: Metadata = {
  title: "BarberCue — Find a barbershop near you",
  description:
    "Discover nearby barbershops, see the current wait, and book your chair online. No app required.",
};

// Phase 1 foundation shell only — no salon search/discovery yet (that's a later phase per
// PROJECT_STRUCTURE.md). Importing Role from @barbercue/shared here is the foundation-level proof
// that this app can consume the shared package, per Phase 1 requirement #13.
export default function HomePage() {
  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>BarberCue</h1>
      <p>Skip the wait. Book your chair.</p>
      <p style={{ color: "#666", fontSize: "0.875rem" }}>
        Phase 1 foundation shell — public site, customer account area, and salon
        owner/staff/admin dashboard all live in this one Next.js app, separated by route group and
        role ({Role.CUSTOMER}, {Role.SALON_STAFF}, {Role.SALON_OWNER}, {Role.PLATFORM_ADMIN}). See{" "}
        <code>ARCHITECTURE.md</code> and <code>PROJECT_STRUCTURE.md</code> at the repo root.
      </p>
      <BackendStatus />
    </main>
  );
}
