"use client";

import { Role } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import styles from "./dashboard.module.css";

/**
 * Part 2 (admin delegated shop management) — every shop-management page under
 * dashboard/salons/[salonId] renders this once (see that segment's layout.tsx), so a
 * PLATFORM_ADMIN can never mistake a delegated-management session for actually being logged in as
 * the owner. Renders nothing for a normal owner/staff session — `user.roles` comes from the same
 * JWT RolesGuard already trusts server-side, so this can never show (or hide) incorrectly for a
 * role the backend doesn't also agree the caller holds.
 *
 * This is a disclosure, not the security boundary: the backend's own assertOwnerOrAdminAccess is
 * what actually decides whether any specific mutation is allowed (see SalonAccessService) — an
 * admin without delegated access to this particular salon still gets a real 403 from the API even
 * though this banner would render.
 */
export function AdminManagingBanner() {
  const { user } = useAuth();
  if (!user?.roles.includes(Role.PLATFORM_ADMIN)) return null;
  return (
    <div className={`${styles.banner} ${styles.bannerNotice}`} role="status">
      <strong>Managing this shop as FastQue Admin.</strong> Changes you make here are recorded
      against your admin account, not the shop owner&apos;s.
    </div>
  );
}
