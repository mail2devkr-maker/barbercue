/**
 * Seeds the first PLATFORM_ADMIN account. Admin accounts are seeded, not self-serve
 * (ARCHITECTURE.md §4) — there is no admin signup endpoint anywhere in the API.
 *
 * Run with: npm run db:seed --workspace=@barbercue/backend
 * Requires ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD / TOTP_ENCRYPTION_KEY / DATABASE_URL in .env.
 *
 * Idempotent: re-running when the admin already exists (with a TOTP secret already provisioned)
 * does nothing and prints a message — it deliberately never silently regenerates the TOTP secret,
 * since that would invalidate whatever authenticator app the admin already configured.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Role, UserStatus } from '@barbercue/shared';
import { PasswordService } from '../src/auth/services/password.service';
import { TotpService } from '../src/auth/services/totp.service';
import { CryptoService } from '../src/auth/services/crypto.service';

const prisma = new PrismaClient();
const passwordService = new PasswordService();
const totpService = new TotpService();
const cryptoService = new CryptoService();

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    throw new Error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be set (see .env.example).');
  }

  const existing = await prisma.user.findUnique({ where: { email }, include: { roles: true } });

  if (existing?.totpSecret) {
    // eslint-disable-next-line no-console
    console.log(`Admin ${email} already seeded with 2FA configured — nothing to do.`);
    return;
  }

  const passwordHash = await passwordService.hash(password);
  const totpSecret = totpService.generateSecret();
  const encryptedSecret = cryptoService.encrypt(totpSecret);

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, twoFactorEnabled: true, totpSecret: encryptedSecret, status: UserStatus.ACTIVE },
      })
    : await prisma.user.create({
        data: {
          email,
          passwordHash,
          twoFactorEnabled: true,
          totpSecret: encryptedSecret,
          status: UserStatus.ACTIVE,
          roles: { create: { role: Role.PLATFORM_ADMIN } },
        },
      });

  if (existing && !existing.roles.some((r) => r.role === Role.PLATFORM_ADMIN)) {
    await prisma.userRole.create({ data: { userId: user.id, role: Role.PLATFORM_ADMIN } });
  }

  const otpAuthUri = totpService.buildOtpAuthUri(email, totpSecret);

  // eslint-disable-next-line no-console
  console.log(`
Admin account ready: ${email}

Scan this into an authenticator app (Google Authenticator, Authy, 1Password, etc.) — the raw
secret is shown only this once and is never logged or stored anywhere in plaintext again:

  Secret:   ${totpSecret}
  otpauth:// URI: ${otpAuthUri}

Login at POST /api/v1/auth/admin/login with { email, password, totpCode } once configured.
`);
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
