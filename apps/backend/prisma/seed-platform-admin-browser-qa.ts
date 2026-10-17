/**
 * Creates a disposable, synthetic PLATFORM_ADMIN identity for local browser QA that must exercise
 * the real password + TOTP admin login. It has no HTTP endpoint and is not called by application
 * startup or production seeding.
 *
 * Refuses cloud/non-loopback databases, requires an explicit opt-in, and writes the generated
 * password and TOTP seed only to a new file under the current OS temporary directory. Never
 * upload or commit that file; dispose of the whole QA database after testing.
 *
 * Example (PowerShell):
 *   $env:QA_PLATFORM_ADMIN_FIXTURE='1'; $env:QA_DISPOSABLE_DATABASE_NAME='owner_nav_qa'
 *   $env:NODE_ENV='test'
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-platform-admin-browser-qa.ts "$env:TEMP\fastque-admin-qa.json"
 */
import { randomBytes, randomUUID } from 'crypto';
import {
  chmodSync,
  existsSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'path';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '../src/auth/services/password.service';
import { CryptoService } from '../src/auth/services/crypto.service';
import { TotpService } from '../src/auth/services/totp.service';
import { assertLocalDisposableQaDatabase } from '../src/common/qa-database-target';

function resolvePrivateOutputPath(argument: string | undefined): string {
  if (!argument)
    throw new Error('Pass an output path inside the OS temporary directory.');
  const outputPath = resolve(argument);
  const tempRoot = realpathSync(tmpdir());
  const parentPath = realpathSync(dirname(outputPath));
  const rel = relative(tempRoot, parentPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(
      'The credential file must be created below the OS temporary directory.',
    );
  }
  const verifiedOutputPath = resolve(parentPath, basename(outputPath));
  if (existsSync(verifiedOutputPath))
    throw new Error('Refusing to overwrite an existing credential file.');
  return verifiedOutputPath;
}

async function main(): Promise<void> {
  assertLocalDisposableQaDatabase(process.env);
  if (!process.env.TOTP_ENCRYPTION_KEY) {
    throw new Error(
      'TOTP_ENCRYPTION_KEY must be set to a synthetic local-only value.',
    );
  }

  const outputPath = resolvePrivateOutputPath(process.argv[2]);
  const tempOutputPath = `${outputPath}.${randomUUID()}.tmp`;
  const totp = new TotpService();
  const crypto = new CryptoService();
  const passwordService = new PasswordService();
  const password = randomBytes(24).toString('base64url');
  const totpSecret = totp.generateSecret();
  const email = `platform-admin-qa-${randomUUID()}@fastque-demo.test`;
  const prisma = new PrismaClient();
  let userId: string | undefined;

  try {
    const passwordHash = await passwordService.hash(password);
    const credentialFile = {
      email,
      password,
      totpSecret,
      otpAuthUri: totp.buildOtpAuthUri(email, totpSecret),
      audience: 'ADMIN',
      synthetic: true,
      note: 'Local disposable QA only. Never upload or reuse outside this database.',
    };
    writeFileSync(tempOutputPath, JSON.stringify(credentialFile, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    if (process.platform !== 'win32') chmodSync(tempOutputPath, 0o600);

    const user = await prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        passwordHash,
        status: UserStatus.ACTIVE,
        twoFactorEnabled: true,
        totpSecret: crypto.encrypt(totpSecret),
        roles: { create: { role: Role.PLATFORM_ADMIN } },
      },
      select: { id: true },
    });
    userId = user.id;
    renameSync(tempOutputPath, outputPath);
    console.log(
      'Created a synthetic global PLATFORM_ADMIN with real password + TOTP auth.',
    );
    console.log(
      'Credentials are stored only in the temporary file supplied by the caller.',
    );
  } catch (error) {
    try {
      unlinkSync(tempOutputPath);
    } catch {
      // The temporary file may not have been written; no credential data is logged.
    }
    if (userId) {
      await prisma.$transaction([
        prisma.userRole.deleteMany({ where: { userId } }),
        prisma.user.deleteMany({ where: { id: userId } }),
      ]);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // Do not print caught provider/Prisma errors: they may contain the database URL.
  console.error(
    'QA admin fixture failed. Check local disposable database configuration.',
  );
  process.exitCode = 1;
});
