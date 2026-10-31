/**
 * Database-free, ONE-SMS 2Factor transport acceptance check.
 *
 * Runs the same TwoFactorOtpSender used by FastQue, but does not initialize
 * NestJS, connect to Neon, alter Prisma migrations, or create a user/session.
 * Never run in Railway/CI/production; keep the API key in a private LOCAL
 * environment variable (never in source, shell arguments, or chat).
 *
 * Default is a dry run. Live sending requires ALL explicit gates below,
 * including written provider authorization for this exact shared template.
 */
import { randomInt } from 'node:crypto';
import { TwoFactorOtpSender } from '../src/auth/services/two-factor-otp-sender';

const EXPECTED_LIVE_FLAG = 'SEND_EXACTLY_ONE_SMS';
const EXPECTED_CONFIRMATION = 'YES';

function blocked(message: string): never {
  // Message deliberately contains no phone number, OTP, URL or API key.
  throw new Error(message);
}

async function main(): Promise<void> {
  if (process.env.CI || process.env.RAILWAY_ENVIRONMENT_ID) {
    blocked('Local-only smoke test: execution in CI or Railway is disabled.');
  }

  const live = process.env.OTP_SMOKE_SEND === EXPECTED_LIVE_FLAG;
  if (!live) {
    console.log('DRY RUN: no request made, no OTP generated, no SMS charged.');
    console.log('Live test requires consent, written template approval, and local test credentials.');
    return;
  }

  if (process.env.OTP_SMOKE_NUMBER_CONSENT !== EXPECTED_CONFIRMATION) {
    blocked('No live send: recipient consent has not been confirmed.');
  }
  if (process.env.OTP_SMOKE_PROVIDER_TEMPLATE_APPROVED !== EXPECTED_CONFIRMATION) {
    blocked('No live send: written vendor authorization for OTP1/FastQue is not confirmed.');
  }
  if (
    process.env.OTP_PROVIDER_API_MODE !== 'manual-v1' ||
    process.env.OTP_PROVIDER_TEMPLATE_NAME !== 'OTP1'
  ) {
    blocked('No live send: expected manual-v1 and OTP1 configuration.');
  }
  if (!process.env.OTP_PROVIDER_API_KEY?.trim()) {
    blocked('No live send: missing private provider API key.');
  }

  // Restricted to ONE consented Indian handset; no batch, no retry, no production users.
  const phone = process.env.OTP_SMOKE_PHONE?.trim() ?? '';
  if (!/^\+91[6-9]\d{9}$/.test(phone)) {
    blocked('No live send: use one consented Indian E.164 mobile phone.');
  }

  const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
  // The adapter's success means PROVIDER ACCEPTANCE, never confirmed handset delivery.
  await new TwoFactorOtpSender().sendOtp(phone, otp);
  console.log('PROVIDER_ACCEPTED: exactly one send request was accepted.');
  console.log('Check the consented handset for a SIX-digit OTP and correct sender/content.');
  console.log('No FastQue login or end-to-end OTP verification was performed.');
}

void main().catch(() => {
  // Intentionally do not print error objects, HTTP URLs, keys, codes or phone numbers.
  console.error('OTP transport smoke test stopped or failed. No delivery is certified.');
  process.exitCode = 1;
});
