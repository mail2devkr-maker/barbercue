const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { generate, generateSecret } = require('otplib');
const { CryptoService } = require('../dist/auth/services/crypto.service');

const root = path.resolve(__dirname, '../../..');
const clockFile = process.env.PR168_TEST_CLOCK_FILE;
const manifestFile = process.env.PR168_FIXTURE_MANIFEST;
const port = Number(process.env.PR168_HTTP_PORT || 39168);
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
const baseTime = Date.UTC(2026, 9, 9, 12, 0, 0);
const jwtAccessSecret = randomBytes(64).toString('hex');
const randomId = () => randomUUID();
const prisma = new PrismaClient();
const cryptoService = new CryptoService();
const serverLogs = [];
let server;
let checks = 0;
let passed = 0;
const fixtureIds = {
  salons: [],
  requests: [],
  financial: [],
};

class CertificationAssertionError extends Error {}

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new CertificationAssertionError(message);
  passed += 1;
}

function assertStatus(response, allowed, label) {
  const statuses = Array.isArray(allowed) ? allowed : [allowed];
  assert(
    statuses.includes(response.status),
    `${label}: expected HTTP ${statuses.join('/')} but received ${response.status}.`,
  );
}

async function http(method, route, { token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${route} returned a non-JSON response.`);
  }
  return { status: response.status, json };
}

function accessToken(response, label) {
  const token = response.json?.tokens?.accessToken;
  assert(
    typeof token === 'string' && token.length > 20,
    `${label} did not return an access token.`,
  );
  return token;
}

async function setTime(epochMs) {
  writeFileSync(clockFile, String(epochMs), { encoding: 'utf8', mode: 0o600 });
}

async function totpAt(secret, epochMs) {
  const actualDateNow = Date.now;
  Date.now = () => epochMs;
  try {
    return await generate({ secret });
  } finally {
    Date.now = actualDateNow;
  }
}

async function waitForOtp(phone) {
  const escaped = phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`OTP for ${escaped}: (\\d{6})`);
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const output = serverLogs.join('');
    const match = output.match(pattern);
    if (match) {
      // Remove the captured development OTP from memory once the HTTP test consumes it.
      serverLogs.length = 0;
      return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    'Disposable development OTP was not emitted by the real server.',
  );
}

async function createAdminUser(roleList, label) {
  const id = randomId();
  const email = `pr168-${label}-${id}@example.invalid`;
  const password = `ci-${randomBytes(24).toString('hex')}`;
  const secret = generateSecret();
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      twoFactorEnabled: true,
      totpSecret: cryptoService.encrypt(secret),
      roles: { create: roleList.map((role) => ({ role, salonId: null })) },
    },
    select: { id: true },
  });
  return { id: user.id, email, password, secret };
}

async function loginAdmin(account, epochMs = baseTime) {
  await setTime(epochMs);
  const code = await totpAt(account.secret, epochMs);
  return http('POST', '/auth/admin/login', {
    body: { email: account.email, password: account.password, totpCode: code },
  });
}

async function createShop(
  label,
  initialStatus = 'ACTIVE',
  withHistory = false,
) {
  const id = randomId();
  const slug = `pr168-${label}-${id}`;
  const owner = await prisma.user.create({
    data: {
      email: `pr168-owner-${id}@example.invalid`,
      passwordHash: await bcrypt.hash(
        `owner-${randomBytes(18).toString('hex')}`,
        12,
      ),
    },
    select: { id: true },
  });
  const city = await prisma.city.create({
    data: {
      name: `PR168-${id}`,
      slug,
      countryCode: 'ZZ',
      state: 'Disposable',
      country: 'Disposable',
    },
    select: { id: true, slug: true },
  });
  const salon = await prisma.salon.create({
    data: {
      ownerUserId: owner.id,
      name: `Disposable PR168 ${label} ${id}`,
      slug,
      cityId: city.id,
      addressLine: 'Disposable CI fixture; no real address',
      status: initialStatus,
      publicQueueToken: `pr168-${randomBytes(24).toString('hex')}`,
    },
    select: {
      id: true,
      publicId: true,
      name: true,
      slug: true,
      status: true,
      publicQueueToken: true,
    },
  });
  await prisma.userRole.create({
    data: { userId: owner.id, role: 'SALON_OWNER', salonId: salon.id },
  });

  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: 'Disposable CI service',
      durationMinutes: 30,
      price: '50.00',
      isActive: true,
    },
    select: { id: true },
  });
  const chair = await prisma.chair.create({
    data: {
      salonId: salon.id,
      label: `CI-${id.slice(0, 8)}`,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  await prisma.salonStaff.create({
    data: {
      salonId: salon.id,
      userId: owner.id,
      displayName: 'Disposable CI Barber',
      roleInSalon: 'BARBER',
      status: 'ACTIVE',
    },
  });
  await prisma.verificationRequest.create({
    data: {
      subjectType: 'SHOP',
      salonId: salon.id,
      status: 'APPROVED',
      submittedByUserId: owner.id,
      reviewedByAdminId: null,
      reviewedAt: null,
      evidenceUrls: [],
    },
  });

  const result = {
    id: salon.id,
    publicId: salon.publicId,
    name: salon.name,
    slug: salon.slug,
    citySlug: city.slug,
    token: salon.publicQueueToken,
    serviceId: service.id,
    chairId: chair.id,
    ownerId: owner.id,
  };
  fixtureIds.salons.push(salon.id);

  if (withHistory) {
    const customer = await prisma.user.create({
      data: { email: `pr168-history-${id}@example.invalid` },
      select: { id: true },
    });
    const booking = await prisma.booking.create({
      data: {
        salonId: salon.id,
        customerId: customer.id,
        serviceId: service.id,
        slotStart: new Date(baseTime - 3_600_000),
        slotEnd: new Date(baseTime - 1_800_000),
        status: 'COMPLETED',
        source: 'APP',
        idempotencyKey: `pr168-history-${id}`,
      },
      select: { id: true },
    });
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        type: 'BOOKING_PAYMENT',
        amount: '50.00',
        status: 'SUCCESS',
        idempotencyKey: `pr168-payment-${id}`,
      },
      select: { id: true },
    });
    const refund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        amount: '1.00',
        reason: 'Disposable unsuccessful refund history',
        status: 'FAILED',
      },
      select: { id: true },
    });
    const ledger = await prisma.customerLedgerEntry.create({
      data: {
        customerId: customer.id,
        salonId: salon.id,
        bookingId: booking.id,
        amount: '0.00',
        reason: 'CANCELLATION_CHARGE',
        status: 'SETTLED',
      },
      select: { id: true },
    });
    const subsidy = await prisma.platformShopSubsidyEntry.create({
      data: {
        salonId: salon.id,
        bookingId: booking.id,
        amount: '0.00',
        status: 'SETTLED',
        settledAt: new Date(baseTime),
      },
      select: { id: true },
    });
    result.history = {
      bookingId: booking.id,
      paymentId: payment.id,
      refundId: refund.id,
      ledgerId: ledger.id,
      subsidyId: subsidy.id,
    };
    fixtureIds.financial.push(result.history);
  }
  return result;
}

async function requestDeletion(shop, token, label) {
  const response = await http(
    'POST',
    `/admin/shops/${shop.id}/deletion-requests`,
    {
      token,
      body: { reason: `Disposable CI certification request ${label}` },
    },
  );
  assertStatus(response, 201, `${label} request creation`);
  assert(
    typeof response.json?.id === 'string',
    `${label} response omitted request ID.`,
  );
  fixtureIds.requests.push(response.json.id);
  return response.json.id;
}

async function installDeferredObligationRaceTrigger(salonId) {
  // This narrowly scoped test-only trigger simulates an obligation appearing after the
  // application preflight but inside the quarantine transaction. It exists only in the fresh
  // CI database and is removed after the assertion; recovery/security triggers are not altered.
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "pr168_obligation_trigger_targets" ("salonId" TEXT PRIMARY KEY)',
  );
  await prisma.$executeRaw`
    INSERT INTO "pr168_obligation_trigger_targets" ("salonId") VALUES (${salonId})
  `;
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "pr168_inject_pending_booking_before_quarantine"() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD."softDeletedAt" IS NULL
         AND NEW."softDeletedAt" IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "pr168_obligation_trigger_targets" t WHERE t."salonId" = NEW."id"
         ) THEN
        INSERT INTO "bookings" (
          "id", "salonId", "customerId", "serviceId", "slotStart", "slotEnd",
          "status", "source", "idempotencyKey", "createdAt", "updatedAt"
        )
        SELECT gen_random_uuid()::text, NEW."id", NEW."ownerUserId", s."id",
          CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '1 day 30 minutes',
          'PENDING_PAYMENT', 'WEB', 'pr168-deferred-' || NEW."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "services" s
        WHERE s."salonId" = NEW."id"
        ORDER BY s."createdAt"
        LIMIT 1;
      END IF;
      RETURN NEW;
    END;
    $fn$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "pr168_inject_pending_booking_before_quarantine"
    BEFORE UPDATE ON "salons"
    FOR EACH ROW EXECUTE FUNCTION "pr168_inject_pending_booking_before_quarantine"()
  `);
}

async function removeDeferredObligationRaceTrigger() {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER "pr168_inject_pending_booking_before_quarantine" ON "salons"',
  );
  await prisma.$executeRawUnsafe(
    'DROP FUNCTION "pr168_inject_pending_booking_before_quarantine"()',
  );
  await prisma.$executeRawUnsafe(
    'DROP TABLE "pr168_obligation_trigger_targets"',
  );
}

async function approve(requestId, token, secret, epochMs = baseTime) {
  await setTime(epochMs);
  const code = await totpAt(secret, epochMs);
  return http(
    'POST',
    `/admin/security/deletion-requests/${requestId}/approve`,
    {
      token,
      body: { totpCode: code, note: 'Disposable CI approval' },
    },
  );
}

async function restore(shop, token, secret, epochMs) {
  await setTime(epochMs);
  const code = await totpAt(secret, epochMs);
  return http('POST', `/admin/security/deletion-trash/${shop.id}/restore`, {
    token,
    body: { totpCode: code },
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null)
      throw new Error(
        'Disposable FastQue backend exited before health became ready.',
      );
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      /* keep polling the isolated local server */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    'Disposable FastQue backend did not become healthy on loopback.',
  );
}

async function startServer() {
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    FASTQUE_LISTEN_HOST: '127.0.0.1',
    PORT: String(port),
    JWT_ACCESS_SECRET: jwtAccessSecret,
    TOTP_ENCRYPTION_KEY: process.env.TOTP_ENCRYPTION_KEY,
    FASTQUE_TEST_CLOCK_FILE: clockFile,
  };
  const preload = path.join(__dirname, 'pr168-controlled-clock.cjs');
  const entry = path.join(__dirname, '../dist/main.js');
  server = spawn(process.execPath, ['-r', preload, entry], {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => serverLogs.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverLogs.push(chunk.toString()));
  await waitForServer();
}

async function authenticatedRuntime() {
  await setTime(baseTime);
  const superAdmin = await createAdminUser(['PLATFORM_ADMIN'], 'super-admin');
  const coFounder = await createAdminUser(['CO_FOUNDER'], 'cofounder');
  const viewer = await createAdminUser(['PLATFORM_VIEWER'], 'viewer');
  const selfAdmin = await createAdminUser(
    ['PLATFORM_ADMIN', 'CO_FOUNDER'],
    'self-approval',
  );
  const badCode =
    `${(Number(await totpAt(superAdmin.secret, baseTime)) + 1) % 1_000_000}`.padStart(
      6,
      '0',
    );

  const badLogin = await http('POST', '/auth/admin/login', {
    body: {
      email: superAdmin.email,
      password: superAdmin.password,
      totpCode: badCode,
    },
  });
  assertStatus(badLogin, 401, 'Super Admin rejects invalid TOTP');

  const superLogin = await loginAdmin(superAdmin);
  assertStatus(superLogin, 201, 'Super Admin password + fresh TOTP login');
  const superToken = accessToken(superLogin, 'Super Admin login');
  const coLogin = await loginAdmin(coFounder);
  assertStatus(coLogin, 201, 'Co-Founder password + fresh TOTP login');
  const coToken = accessToken(coLogin, 'Co-Founder login');
  const viewerLogin = await loginAdmin(viewer);
  assertStatus(viewerLogin, 201, 'Viewer password + fresh TOTP login');
  const viewerToken = accessToken(viewerLogin, 'Viewer login');
  const selfLogin = await loginAdmin(selfAdmin);
  assertStatus(
    selfLogin,
    201,
    'Self-approval test account password + fresh TOTP login',
  );
  const selfToken = accessToken(selfLogin, 'Self-approval login');

  const phone = `+1555${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
  const otpRequest = await http('POST', '/auth/otp/request', {
    body: { phone },
  });
  assertStatus(otpRequest, 201, 'Disposable customer OTP request');
  const code = await waitForOtp(phone);
  const otpVerify = await http('POST', '/auth/otp/verify', {
    body: { phone, code },
  });
  assertStatus(otpVerify, 201, 'Disposable customer OTP verification');
  const customerToken = accessToken(otpVerify, 'Customer OTP verification');

  const standard = await createShop('standard', 'ACTIVE', true);
  const suspended = await createShop('previously-suspended', 'SUSPENDED');
  const selfShop = await createShop('self-approval', 'ACTIVE');
  const obligationShop = await createShop(
    'open-financial-obligation',
    'ACTIVE',
  );
  const deferredRaceShop = await createShop(
    'deferred-obligation-race',
    'ACTIVE',
  );
  const boundaryBefore = await createShop('boundary-before', 'ACTIVE');
  const boundaryEqual = await createShop('boundary-equal', 'ACTIVE');
  const boundaryAfter = await createShop('boundary-after', 'ACTIVE');
  const obligationCustomer = await prisma.user.create({
    data: { email: `pr168-obligation-${randomId()}@example.invalid` },
    select: { id: true },
  });
  const pendingBooking = await prisma.booking.create({
    data: {
      salonId: obligationShop.id,
      customerId: obligationCustomer.id,
      serviceId: obligationShop.serviceId,
      slotStart: new Date(baseTime + 86_400_000),
      slotEnd: new Date(baseTime + 86_400_000 + 1_800_000),
      status: 'PENDING_PAYMENT',
      source: 'WEB',
      idempotencyKey: `pr168-open-obligation-${randomId()}`,
    },
    select: { id: true },
  });
  const pendingPayment = await prisma.payment.create({
    data: {
      bookingId: pendingBooking.id,
      type: 'BOOKING_PAYMENT',
      amount: '50.00',
      status: 'PENDING',
      idempotencyKey: `pr168-open-payment-${randomId()}`,
    },
    select: { id: true, status: true },
  });

  const queueBefore = await http('GET', `/public-queue/${standard.token}`);
  assertStatus(queueBefore, 200, 'Public queue lookup before quarantine');

  const mainRequestId = await requestDeletion(standard, coToken, 'primary');
  const requestList = await http(
    'GET',
    '/admin/security/deletion-requests?status=PENDING',
    { token: superToken },
  );
  assertStatus(requestList, 200, 'Super Admin pending request queue');
  assert(
    requestList.json?.items?.some((item) => item.id === mainRequestId),
    'New request was not visible in the Super Admin queue.',
  );

  const coList = await http(
    'GET',
    '/admin/security/deletion-requests?status=PENDING',
    { token: coToken },
  );
  assertStatus(
    coList,
    403,
    'Co-Founder cannot read Super Admin decision queue',
  );
  const viewerList = await http(
    'GET',
    '/admin/security/deletion-requests?status=PENDING',
    { token: viewerToken },
  );
  assertStatus(
    viewerList,
    403,
    'Viewer cannot read Super Admin decision queue',
  );

  const duplicate = await http(
    'POST',
    `/admin/shops/${standard.id}/deletion-requests`,
    {
      token: coToken,
      body: { reason: 'A duplicate disposable CI recovery request' },
    },
  );
  assertStatus(duplicate, 409, 'Duplicate pending request is rejected');

  const coApprove = await approve(
    mainRequestId,
    coToken,
    coFounder.secret,
    baseTime,
  );
  assertStatus(coApprove, 403, 'Co-Founder cannot approve a deletion request');
  const viewerApprove = await approve(
    mainRequestId,
    viewerToken,
    viewer.secret,
    baseTime + 20_000,
  );
  assertStatus(viewerApprove, 403, 'Viewer cannot approve a deletion request');

  const selfRequestId = await requestDeletion(
    selfShop,
    selfToken,
    'self-approval',
  );
  const selfDecision = await approve(
    selfRequestId,
    selfToken,
    selfAdmin.secret,
    baseTime + 40_000,
  );
  assertStatus(selfDecision, 403, 'Requester cannot approve their own request');
  assert(
    selfDecision.json?.code === 'SELF_APPROVAL_FORBIDDEN' ||
      JSON.stringify(selfDecision.json).includes('SELF_APPROVAL_FORBIDDEN'),
    'Self-approval denial did not expose the expected safe conflict code.',
  );

  const obligationRequestId = await requestDeletion(
    obligationShop,
    coToken,
    'open-financial-obligation',
  );
  const obligationApproval = await approve(
    obligationRequestId,
    superToken,
    superAdmin.secret,
    baseTime + 60_000,
  );
  assertStatus(
    obligationApproval,
    409,
    'Open booking/payment obligation prevents quarantine approval',
  );
  assert(
    JSON.stringify(obligationApproval.json).includes(
      'SHOP_HAS_OPEN_OBLIGATIONS',
    ),
    'Open financial obligation approval did not return the expected safe conflict.',
  );
  const obligationState = await prisma.salon.findUnique({
    where: { id: obligationShop.id },
    select: { softDeletedAt: true, status: true },
  });
  const pendingRequest = await prisma.shopDeletionRequest.findUnique({
    where: { id: obligationRequestId },
    select: { status: true },
  });
  assert(
    obligationState?.softDeletedAt === null &&
      obligationState.status === 'ACTIVE' &&
      pendingRequest?.status === 'PENDING' &&
      pendingPayment.status === 'PENDING',
    'Denied financial-obligation approval changed the shop, request or pending payment.',
  );

  // Earlier negative/security cases deliberately exercise this endpoint's five-per-minute
  // throttle. Its in-memory expiry timer uses real elapsed time, so restart only the isolated
  // loopback backend (not its disposable database) before the race. Keep the synthetic signing
  // key stable so these already-issued test sessions remain valid; production throttling stays on.
  await stopServer();
  serverLogs.length = 0;
  await startServer();
  const concurrentApprovalTime = baseTime + 80_000;
  await setTime(concurrentApprovalTime);
  const adminCode = await totpAt(superAdmin.secret, concurrentApprovalTime);
  const race = await Promise.all([
    http('POST', `/admin/security/deletion-requests/${mainRequestId}/approve`, {
      token: superToken,
      body: { totpCode: adminCode, note: 'Concurrent disposable approval A' },
    }),
    http('POST', `/admin/security/deletion-requests/${mainRequestId}/approve`, {
      token: superToken,
      body: { totpCode: adminCode, note: 'Concurrent disposable approval B' },
    }),
  ]);
  const successfulRace = race.filter(
    (response) => response.status >= 200 && response.status < 300,
  );
  const conflictedRace = race.filter((response) => response.status === 409);
  assert(
    successfulRace.length === 1 && conflictedRace.length === 1,
    `Concurrent approval did not produce exactly one success and one HTTP 409 conflict (received statuses ${race.map((response) => response.status).join(', ')}).`,
  );

  const deferredRaceRequestId = await requestDeletion(
    deferredRaceShop,
    coToken,
    'deferred-obligation-race',
  );
  await installDeferredObligationRaceTrigger(deferredRaceShop.id);
  const deferredRaceApproval = await approve(
    deferredRaceRequestId,
    superToken,
    superAdmin.secret,
    baseTime + 100_000,
  );
  assert(
    deferredRaceApproval.status >= 400,
    'Quarantine returned HTTP success although the deferred obligation constraint rejected commit.',
  );
  const deferredRaceState = await prisma.salon.findUnique({
    where: { id: deferredRaceShop.id },
    select: { status: true, softDeletedAt: true },
  });
  const deferredRaceRequest = await prisma.shopDeletionRequest.findUnique({
    where: { id: deferredRaceRequestId },
    select: { status: true },
  });
  const rolledBackInjectedBooking = await prisma.booking.count({
    where: {
      salonId: deferredRaceShop.id,
      idempotencyKey: `pr168-deferred-${deferredRaceShop.id}`,
    },
  });
  assert(
    deferredRaceState?.status === 'ACTIVE' &&
      deferredRaceState.softDeletedAt === null &&
      deferredRaceRequest?.status === 'PENDING' &&
      rolledBackInjectedBooking === 0,
    'Deferred obligation rejection did not roll back the quarantine, approval, and synthetic racing booking atomically.',
  );
  await removeDeferredObligationRaceTrigger();

  const quarantined = await prisma.salon.findUnique({
    where: { id: standard.id },
  });
  assert(
    quarantined?.softDeletedAt instanceof Date &&
      quarantined.status === 'SUSPENDED',
    'Successful approval did not persist the quarantine state.',
  );
  assert(
    quarantined.id === standard.id &&
      quarantined.publicId === standard.publicId,
    'Quarantine changed the original shop identity.',
  );
  const approvedRow = await prisma.shopDeletionRequest.findUnique({
    where: { id: mainRequestId },
  });
  assert(
    approvedRow?.status === 'APPROVED' &&
      approvedRow.decidedByUserId !== approvedRow.requestedByUserId,
    'Approved request actor or state is incorrect.',
  );

  const publicSearch = await http(
    'GET',
    `/salons?q=${encodeURIComponent(standard.slug)}`,
  );
  assertStatus(publicSearch, 200, 'Public discovery search');
  assert(
    !JSON.stringify(publicSearch.json).includes(standard.name),
    'Quarantined shop still appears in public discovery.',
  );
  const directProfile = await http(
    'GET',
    `/salons/ZZ/${standard.citySlug}/${standard.slug}`,
  );
  assertStatus(
    directProfile,
    404,
    'Direct public shop profile access after quarantine',
  );
  const publicQueueAfter = await http('GET', `/public-queue/${standard.token}`);
  assertStatus(publicQueueAfter, 404, 'Public queue token after quarantine');
  const bookingAttempt = await http('POST', '/bookings', {
    token: customerToken,
    headers: { 'Idempotency-Key': `pr168-${randomId()}` },
    body: {
      salonId: standard.id,
      serviceIds: [standard.serviceId],
      slotStart: new Date(baseTime + 86_400_000).toISOString(),
    },
  });
  assert(
    bookingAttempt.status >= 400,
    'Customer booking unexpectedly succeeded for a quarantined shop.',
  );
  assert(
    (await prisma.booking.count({
      where: { salonId: standard.id, status: { not: 'COMPLETED' } },
    })) === 0,
    'Rejected booking request created a booking row.',
  );
  const queueJoin = await http('POST', `/public-queue/${standard.token}/join`, {
    token: customerToken,
    headers: { 'Idempotency-Key': `pr168-queue-${randomId()}` },
    body: {
      serviceId: standard.serviceId,
      contactName: 'Disposable Customer',
      contactPhone: phone,
    },
  });
  assertStatus(queueJoin, 404, 'Customer queue join after quarantine');
  assert(
    (await prisma.queueEntry.count({ where: { salonId: standard.id } })) === 0,
    'Rejected queue join created an entry.',
  );
  const reactivation = await http(
    'PATCH',
    `/admin/shops/${standard.id}/status`,
    { token: coToken, body: { status: 'ACTIVE' } },
  );
  assert(
    reactivation.status >= 400,
    'Co-Founder reactivated a quarantined shop.',
  );
  assert(
    (await prisma.salon.findUnique({ where: { id: standard.id } }))
      ?.softDeletedAt instanceof Date,
    'Denied reactivation changed quarantine state.',
  );
  const hardDelete = await http('DELETE', `/admin/shops/${standard.id}`, {
    token: superToken,
  });
  assertStatus(hardDelete, 409, 'Permanent deletion endpoint is disabled');
  assert(
    (await prisma.salon.count({ where: { id: standard.id } })) === 1,
    'Hard-delete request removed a quarantined shop.',
  );

  const unauthorizedRestore = await restore(
    standard,
    viewerToken,
    viewer.secret,
    baseTime,
  );
  assertStatus(unauthorizedRestore, 403, 'Viewer cannot restore a shop');

  const beforeHistory = await readHistory(standard.history);
  assert(
    beforeHistory.booking.status === 'COMPLETED' &&
      beforeHistory.payment.status === 'SUCCESS',
    'Historical booking/payment fixture is not in the expected pre-quarantine state.',
  );
  assert(
    beforeHistory.refund.status === 'FAILED' &&
      beforeHistory.ledger.status === 'SETTLED' &&
      beforeHistory.subsidy.status === 'SETTLED',
    'Historical refund/ledger/subsidy fixture is not in the expected pre-quarantine state.',
  );

  const regularRestore = await restore(
    standard,
    superToken,
    superAdmin.secret,
    baseTime + 120_000,
  );
  assertStatus(
    regularRestore,
    201,
    'Super Admin restores eligible previously active shop',
  );
  const activeRestored = await prisma.salon.findUnique({
    where: { id: standard.id },
  });
  assert(
    activeRestored?.softDeletedAt === null &&
      activeRestored.status === 'ACTIVE',
    'Previously active ready/verified shop did not restore to ACTIVE.',
  );
  assert(
    activeRestored.id === standard.id &&
      activeRestored.publicId === standard.publicId &&
      activeRestored.name === standard.name,
    'Restore changed the original shop identity or data.',
  );
  const afterHistory = await readHistory(standard.history);
  assert(
    JSON.stringify(afterHistory) === JSON.stringify(beforeHistory),
    'Restore changed or removed historical booking or financial records.',
  );
  const audit = await prisma.auditLog.findMany({
    where: {
      entityId: standard.id,
      action: {
        in: [
          'SHOP_DELETE_REQUESTED',
          'SHOP_SOFT_DELETED',
          'SHOP_DELETE_APPROVED',
          'SHOP_DELETE_RESTORED',
        ],
      },
    },
  });
  assert(
    audit.length === 4,
    'Request, quarantine, approval and restore audit entries were not all preserved.',
  );

  const suspendedRequestId = await requestDeletion(
    suspended,
    coToken,
    'previously-suspended',
  );
  const suspendedApproval = await approve(
    suspendedRequestId,
    superToken,
    superAdmin.secret,
    baseTime + 180_000,
  );
  assertStatus(
    suspendedApproval,
    201,
    'Super Admin quarantines previously suspended shop',
  );
  const suspendedRestore = await restore(
    suspended,
    superToken,
    superAdmin.secret,
    baseTime + 210_000,
  );
  assertStatus(
    suspendedRestore,
    201,
    'Super Admin restores previously suspended shop',
  );
  const suspendedAfter = await prisma.salon.findUnique({
    where: { id: suspended.id },
  });
  assert(
    suspendedAfter?.status === 'SUSPENDED' &&
      suspendedAfter.softDeletedAt === null,
    'Previously suspended shop did not remain suspended after restore.',
  );

  const boundaryShops = [boundaryBefore, boundaryEqual, boundaryAfter];
  const boundaryNames = [
    'one millisecond before deadline',
    'exactly at deadline',
    'one millisecond after deadline',
  ];
  const boundaryTimes = [];
  for (let index = 0; index < boundaryShops.length; index += 1) {
    const requestId = await requestDeletion(
      boundaryShops[index],
      coToken,
      `boundary-${index}`,
    );
    const response = await approve(
      requestId,
      superToken,
      superAdmin.secret,
      baseTime + 240_000 + index * 30_000,
    );
    assertStatus(
      response,
      201,
      `Boundary shop ${index + 1} quarantine approval`,
    );
    const current = await prisma.salon.findUnique({
      where: { id: boundaryShops[index].id },
      select: { restoreEligibleUntil: true },
    });
    assert(
      current?.restoreEligibleUntil instanceof Date,
      `Boundary shop ${index + 1} has no persisted restore deadline.`,
    );
    boundaryTimes.push(current.restoreEligibleUntil.getTime());
  }

  const beforeTime = boundaryTimes[0] - 1;
  await setTime(beforeTime);
  const beforeAdmin = await loginAdmin(superAdmin, beforeTime);
  assertStatus(
    beforeAdmin,
    201,
    'Super Admin fresh login immediately before deadline',
  );
  const beforeRestore = await restore(
    boundaryBefore,
    accessToken(beforeAdmin, 'Before-deadline login'),
    superAdmin.secret,
    beforeTime,
  );
  assertStatus(beforeRestore, 201, 'Restore at deadline minus one millisecond');
  assert(
    (await prisma.salon.findUnique({ where: { id: boundaryBefore.id } }))
      ?.softDeletedAt === null,
    'Pre-deadline restore did not clear quarantine.',
  );

  const exactTime = boundaryTimes[1];
  await setTime(exactTime);
  const exactAdmin = await loginAdmin(superAdmin, exactTime);
  assertStatus(exactAdmin, 201, 'Super Admin fresh login exactly at deadline');
  const exactRestore = await restore(
    boundaryEqual,
    accessToken(exactAdmin, 'Exact-deadline login'),
    superAdmin.secret,
    exactTime,
  );
  assertStatus(
    exactRestore,
    409,
    'Restore exactly at 30-day deadline is rejected',
  );
  assert(
    JSON.stringify(exactRestore.json).includes('RESTORE_WINDOW_EXPIRED'),
    'Exact-deadline rejection did not report RESTORE_WINDOW_EXPIRED.',
  );
  const exactStillQuarantined = await prisma.salon.findUnique({
    where: { id: boundaryEqual.id },
  });
  assert(
    exactStillQuarantined?.softDeletedAt instanceof Date &&
      exactStillQuarantined.restoreEligibleUntil?.getTime() === exactTime,
    'Exact-deadline rejection mutated or removed the quarantined shop.',
  );

  const afterTime = boundaryTimes[2] + 1;
  await setTime(afterTime);
  const afterAdmin = await loginAdmin(superAdmin, afterTime);
  assertStatus(afterAdmin, 201, 'Super Admin fresh login after deadline');
  const afterRestore = await restore(
    boundaryAfter,
    accessToken(afterAdmin, 'After-deadline login'),
    superAdmin.secret,
    afterTime,
  );
  assertStatus(
    afterRestore,
    409,
    'Restore one millisecond after deadline is rejected',
  );
  assert(
    JSON.stringify(afterRestore.json).includes('RESTORE_WINDOW_EXPIRED'),
    'Post-deadline rejection did not report RESTORE_WINDOW_EXPIRED.',
  );
  const afterStillQuarantined = await prisma.salon.findUnique({
    where: { id: boundaryAfter.id },
  });
  assert(
    afterStillQuarantined?.softDeletedAt instanceof Date &&
      afterStillQuarantined.restoreEligibleUntil?.getTime() ===
        boundaryTimes[2],
    'Post-deadline rejection mutated or removed the quarantined shop.',
  );
  const expiredAuditCount = await prisma.auditLog.count({
    where: {
      action: 'SHOP_DELETE_RESTORE_EXPIRED',
      entityId: { in: [boundaryEqual.id, boundaryAfter.id] },
    },
  });
  assert(
    expiredAuditCount === 2,
    'Expired restoration attempts were not retained in audit history.',
  );

  const mainRequest = await prisma.shopDeletionRequest.findUnique({
    where: { id: mainRequestId },
  });
  assert(
    mainRequest?.status === 'APPROVED' && mainRequest.decidedAt instanceof Date,
    'Final approved request history is missing.',
  );

  writeFileSync(
    manifestFile,
    JSON.stringify(
      {
        version: 1,
        salonIds: fixtureIds.salons,
        requestIds: fixtureIds.requests,
        financial: fixtureIds.financial,
        historyShopId: standard.id,
        mainRequestId,
        activeRestoredShopId: standard.id,
        suspendedShopId: suspended.id,
        deadline: {
          before: {
            salonId: boundaryBefore.id,
            restoreEligibleUntil: boundaryTimes[0],
          },
          equal: {
            salonId: boundaryEqual.id,
            restoreEligibleUntil: boundaryTimes[1],
          },
          after: {
            salonId: boundaryAfter.id,
            restoreEligibleUntil: boundaryTimes[2],
          },
        },
      },
      null,
      2,
    ),
    { encoding: 'utf8', mode: 0o600 },
  );
}

async function readHistory(ids) {
  const [booking, payment, refund, ledger, subsidy] = await Promise.all([
    prisma.booking.findUnique({
      where: { id: ids.bookingId },
      select: { id: true, status: true, serviceId: true, slotStart: true },
    }),
    prisma.payment.findUnique({
      where: { id: ids.paymentId },
      select: { id: true, status: true, amount: true },
    }),
    prisma.refund.findUnique({
      where: { id: ids.refundId },
      select: { id: true, status: true, amount: true },
    }),
    prisma.customerLedgerEntry.findUnique({
      where: { id: ids.ledgerId },
      select: { id: true, status: true, amount: true },
    }),
    prisma.platformShopSubsidyEntry.findUnique({
      where: { id: ids.subsidyId },
      select: { id: true, status: true, amount: true },
    }),
  ]);
  assert(
    booking && payment && refund && ledger && subsidy,
    'A historical financial or booking row disappeared.',
  );
  return {
    booking: serialize(booking),
    payment: serialize(payment),
    refund: serialize(refund),
    ledger: serialize(ledger),
    subsidy: serialize(subsidy),
  };
}

function serialize(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  );
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function main() {
  if (!clockFile || !manifestFile)
    throw new Error(
      'Temporary CI clock and fixture-manifest paths are required.',
    );
  const databaseUrl = new URL(process.env.DATABASE_URL || '');
  if (
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.pathname !== '/fastque_ci'
  ) {
    throw new Error(
      'Authenticated HTTP certification requires the isolated loopback fastque_ci database.',
    );
  }
  process.env.TOTP_ENCRYPTION_KEY = randomBytes(64).toString('hex');
  await startServer();
  await authenticatedRuntime();
  console.log(
    `PASS: ${passed}/${checks} authenticated local PostgreSQL HTTP/database assertions.`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Authenticated local PostgreSQL HTTP/database certification: **${passed}/${checks} assertions passed**. Synthetic CI users/shops only; no production services used.\n`,
    );
  }
}

main()
  .catch((error) => {
    const safeMessage =
      error instanceof CertificationAssertionError
        ? error.message
        : `unexpected runtime failure (${typeof error?.code === 'string' ? error.code : 'details withheld'})`;
    console.error(
      `PR #168 authenticated HTTP certification failed after ${passed}/${checks} assertions: ${safeMessage}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    await prisma.$disconnect();
    // Server log buffer can contain the development OTP; never print or persist it.
    serverLogs.length = 0;
  });
