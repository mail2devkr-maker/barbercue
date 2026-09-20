/**
 * Safety guard for the temporary certification seed (prisma/seed-certification.ts).
 *
 * The seed exists to populate a DISPOSABLE staging database for physical-device certification of the
 * arrival alert. It must be impossible to point it at a database holding real data, so it refuses to
 * run unless (1) the operator typed the explicit confirmation and (2) the database contains nothing
 * except certification rows: no salon other than the certification salon, and no user other than
 * certification accounts (or the single bare bootstrap row the fresh-database migration guard needs).
 * A production database - which has real salons and customers - can never pass (2).
 */
export const CERT_CONFIRMATION = 'fastque-cert-temp';
export const CERT_EMAIL_DOMAIN = 'cert.fastque.invalid';
export const CERT_SALON_SLUG = 'fastque-cert-salon';
/** Migration 20260830215000 raises unless this account exists; on a fresh database it is created bare (no password). */
export const MIGRATION_BOOTSTRAP_EMAIL = 'mail2dev.kr@gmail.com';

export interface CertificationDbProbe {
  salonSlugs: string[];
  users: Array<{ email: string | null; phone: string | null }>;
}

export function isCertificationEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${CERT_EMAIL_DOMAIN}`);
}

export function assertCertificationDatabase(
  confirmation: string | undefined,
  probe: CertificationDbProbe,
): void {
  if (confirmation !== CERT_CONFIRMATION) {
    throw new Error(
      `Refusing to run: set CERT_SEED_CONFIRM=${CERT_CONFIRMATION} to confirm this is the temporary certification database.`,
    );
  }
  const foreignSalons = probe.salonSlugs.filter((slug) => slug !== CERT_SALON_SLUG);
  if (foreignSalons.length > 0) {
    throw new Error(
      `Refusing to run: the database already contains ${foreignSalons.length} non-certification salon(s). This is not a disposable certification database.`,
    );
  }
  const foreignUsers = probe.users.filter((user) => {
    if (user.phone) return true; // real customers sign up by phone; certification accounts never have one
    if (!user.email) return true;
    return !isCertificationEmail(user.email) && user.email.toLowerCase() !== MIGRATION_BOOTSTRAP_EMAIL;
  });
  if (foreignUsers.length > 0) {
    throw new Error(
      `Refusing to run: the database already contains ${foreignUsers.length} non-certification user(s). This is not a disposable certification database.`,
    );
  }
}
