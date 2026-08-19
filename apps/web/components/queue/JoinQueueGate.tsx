"use client";

import Link from "next/link";
import { useAuth } from "../../lib/auth-context";
import { WalkInJoinFlow } from "./WalkInJoinFlow";
import type { ServiceDto } from "@barbercue/shared";

export function JoinQueueGate({
  salonId,
  citySlug,
  salonSlug,
  services,
}: {
  salonId: string;
  citySlug: string;
  salonSlug: string;
  services: ServiceDto[];
}) {
  const { status, user } = useAuth();
  const next = `/join/${encodeURIComponent(citySlug)}/${encodeURIComponent(salonSlug)}`;

  if (status === "loading") {
    return <p style={{ color: "#6B6357", marginTop: 16 }}>Checking your account…</p>;
  }

  if (!user) {
    return (
      <div style={{ marginTop: 20 }}>
        <p style={{ color: "#6B6357" }}>
          Sign in with your phone to join the live queue and keep your queue token on your account.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          style={{
            display: "inline-block",
            marginTop: 8,
            padding: "10px 20px",
            background: "#B0413E",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Sign in to join
        </Link>
      </div>
    );
  }

  return <WalkInJoinFlow salonId={salonId} services={services} />;
}
