import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { CryptoService } from '../src/auth/services/crypto.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

// Mutating E2E is restricted to the disposable local PostgreSQL service used by CI.
const databaseUrl = process.env.DATABASE_URL ?? '';
const localDisposableDb = /@(127\.0\.0\.1|localhost)[:/]/.test(databaseUrl);
const maybe = localDisposableDb ? describe : describe.skip;

maybe('Permanent HR Employee ID registry (disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let crypto: CryptoService;
  const run = randomUUID();
  const digits = run.replace(/\D/g, '').slice(0, 9).padEnd(9, '0');
  let adminToken: string;
  let customerToken: string;

  const api = (method: 'get' | 'post', path: string, token = adminToken) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  const key = (label: string) => `${label}-${randomUUID()}`;

  async function createCandidate(
    contactEmail = `hr-${run}@example.test`,
    contactPhone = `+919${digits}`,
    fullName = `Synthetic ${contactEmail.split('@')[0]}`,
    idempotencyKey = key('candidate'),
  ) {
    const preflight = await api(
      'post',
      '/admin/employee-register/people/matches',
    ).send({ fullName, email: contactEmail, phone: contactPhone });
    expect(preflight.status).toBe(201);
    if (preflight.body.matches.length > 0)
      expect(preflight.body.requiresReview).toBe(true);
    else expect(preflight.body.blocksNewIdentity).toBe(false);
    const response = await api('post', '/admin/employee-register/people').send({
      idempotencyKey,
      fullName,
      email: contactEmail,
      phone: contactPhone,
      matchReview: {
        decision: preflight.body.matches.length
          ? 'DISTINCT_PERSON'
          : 'NO_MATCH',
        reviewedPersonIds: preflight.body.matches.map(
          (match: { person: { id: string } }) => match.person.id,
        ),
        evidenceReference: `HR-MATCH-${run.slice(0, 8)}`,
        reason:
          'HR reviewed the candidate against the permanent employee register.',
      },
    });
    expect(response.status).toBe(201);
    const identityId = response.body.person.id as string;
    expect(response.body.person.employeeCode).toBeNull();
    expect(response.body.person.linkedEmployeeProfile).toBe(false);
    return identityId;
  }

  async function verify(identityId: string) {
    const response = await api(
      'post',
      `/admin/employee-register/people/${identityId}/verify-identity`,
    ).send({
      idempotencyKey: key('verify'),
      verificationMethod: 'IN_PERSON',
      evidenceReference: `HR-${run.slice(0, 8)}`,
      reason: 'Identity checked against an HR record in person.',
    });
    expect(response.status).toBe(201);
  }

  async function createOffer(
    identityId: string,
    expectedEmployeeCode: string | null = null,
  ) {
    const response = await api(
      'post',
      `/admin/employee-register/people/${identityId}/offers`,
    ).send({
      idempotencyKey: key('draft'),
      position: 'Field Executive',
      compensation: {
        baseAmount: 18000,
        currency: 'INR',
        frequency: 'MONTHLY',
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.employeeCode).toBe(expectedEmployeeCode);
    expect(response.body.status).toBe('DRAFT');
    return response.body.id as string;
  }

  async function issueAndAccept(offerId: string) {
    const issueKey = key('issue');
    const issue = await api(
      'post',
      `/admin/employee-register/offers/${offerId}/issue`,
    ).send({ idempotencyKey: issueKey });
    expect(issue.status).toBe(201);
    const repeated = await api(
      'post',
      `/admin/employee-register/offers/${offerId}/issue`,
    ).send({ idempotencyKey: issueKey });
    expect(repeated.status).toBe(201);
    expect(repeated.body.employeeCode).toBe(issue.body.employeeCode);
    expect(issue.body.employeeCode).toMatch(
      /^FQ-FE-0*(?:10[1-9]|1[1-9][0-9]|[2-9][0-9]{2,})$/,
    );
    const sent = await api(
      'post',
      `/admin/employee-register/offers/${offerId}/status`,
    ).send({
      idempotencyKey: key('sent'),
      status: 'SENT',
      evidenceReference: `MAIL-${run.slice(0, 8)}`,
    });
    expect(sent.status).toBe(201);
    const accepted = await api(
      'post',
      `/admin/employee-register/offers/${offerId}/status`,
    ).send({
      idempotencyKey: key('accepted'),
      status: 'ACCEPTED',
      evidenceReference: `SIGNED-${run.slice(0, 8)}`,
    });
    expect(accepted.status).toBe(201);
    return issue.body.employeeCode as string;
  }

  beforeAll(async () => {
    process.env.HR_EMPLOYEE_REGISTRY_ENABLED = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    crypto = app.get(CryptoService);
    const admin = await prisma.user.create({
      data: {
        email: `hr-admin-${run}@example.test`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({
      data: { userId: admin.id, role: Role.HR_ADMIN, salonId: null },
    });
    adminToken = tokens.signAccessToken(
      admin.id,
      [Role.HR_ADMIN],
      SessionAudience.ADMIN,
    );
    const customer = await prisma.user.create({
      data: {
        email: `hr-customer-${run}@example.test`,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: customer.id, role: Role.CUSTOMER, salonId: null },
    });
    customerToken = tokens.signAccessToken(
      customer.id,
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('enforces the ADMIN audience and leaves candidates without an ID or login until official issue and joining', async () => {
    const denied = await api(
      'get',
      '/admin/employee-register/people/search?q=synthetic',
      customerToken,
    );
    expect(denied.status).toBe(403);
    const phoneInUrl = await api(
      'get',
      `/admin/employee-register/people/search?q=${encodeURIComponent(`+919${digits}`)}`,
    );
    expect(phoneInUrl.status).toBe(400);
    expect(phoneInUrl.body.error.code).toBe('HR_CONTACT_SEARCH_REQUIRES_POST');
    const identityId = await createCandidate();
    await verify(identityId);
    const offerId = await createOffer(identityId);
    const beforeIssue = await prisma.employeeIdentity.findUnique({
      where: { id: identityId },
      include: { employeeProfile: true },
    });
    expect(beforeIssue?.employeeCode).toBeNull();
    expect(beforeIssue?.employeeProfile).toBeNull();
    const directCreate = await api('post', '/admin/employees').send({
      fullName: 'Legacy Bypass Candidate',
      territory: 'Test',
      password: 'StrongPass123',
      confirmPassword: 'StrongPass123',
    });
    expect(directCreate.status).toBe(409);
    expect(directCreate.body.error.code).toBe('EMPLOYEE_HR_REGISTRY_REQUIRED');
    expect(
      await prisma.employeeProfile.count({
        where: { fullName: 'Legacy Bypass Candidate' },
      }),
    ).toBe(0);
    expect(
      await prisma.employeeOfferVersion.findUnique({ where: { id: offerId } }),
    ).not.toBeNull();
    const issued = await api(
      'post',
      `/admin/employee-register/offers/${offerId}/issue`,
    ).send({ idempotencyKey: key('official-issue') });
    expect(issued.status).toBe(201);
    expect(issued.body.employeeCode).toMatch(/^FQ-FE-/);
    const notJoined = await api(
      'post',
      `/admin/employee-register/offers/${offerId}/status`,
    ).send({
      idempotencyKey: key('not-joined'),
      status: 'NOT_JOINED',
      evidenceReference: `HR-NOJOIN-${run.slice(0, 8)}`,
    });
    expect(notJoined.status).toBe(201);
    expect(
      (await prisma.employeeIdentity.findUnique({ where: { id: identityId } }))
        ?.employeeCode,
    ).toBe(issued.body.employeeCode);
    expect(
      await prisma.employeeProfile.count({
        where: { employeeIdentityId: identityId },
      }),
    ).toBe(0);
    expect(
      await createOffer(identityId, issued.body.employeeCode),
    ).toBeTruthy();
  });

  it('allocates one permanent code on official issue, joins, exits, and reuses the ID on rehire', async () => {
    const identityId = await createCandidate(
      `rehire-${run}@example.test`,
      `+918${digits}`,
    );
    await verify(identityId);
    const firstOffer = await createOffer(identityId);
    const code = await issueAndAccept(firstOffer);
    const prematureReoffer = await api(
      'post',
      `/admin/employee-register/people/${identityId}/offers`,
    ).send({
      idempotencyKey: key('premature-reoffer'),
      position: 'Field Executive',
      compensation: {
        baseAmount: 18000,
        currency: 'INR',
        frequency: 'MONTHLY',
      },
    });
    expect(prematureReoffer.status).toBe(409);
    expect(prematureReoffer.body.error.code).toBe('EMPLOYEE_OPEN_OFFER_EXISTS');
    expect(
      (await prisma.employeeIdentity.findUnique({ where: { id: identityId } }))
        ?.employeeCode,
    ).toBe(code);
    expect(
      await prisma.employeeProfile.findUnique({
        where: { employeeIdentityId: identityId },
      }),
    ).toBeNull();

    const joined = await api(
      'post',
      `/admin/employee-register/people/${identityId}/join`,
    ).send({
      idempotencyKey: key('join'),
      password: 'StrongPass123',
      confirmPassword: 'StrongPass123',
    });
    expect(joined.status).toBe(201);
    expect(joined.body.person.employeeCode).toBe(code);
    const profile = await prisma.employeeProfile.findUnique({
      where: { employeeIdentityId: identityId },
      include: { user: true },
    });
    expect(profile?.user.status).toBe(UserStatus.ACTIVE);
    expect(profile?.employeeCode).toBe(code);
    const userId = profile!.userId;

    const exited = await api(
      'post',
      `/admin/employee-register/people/${identityId}/exit`,
    ).send({
      idempotencyKey: key('exit'),
      reason: 'Synthetic E2E employment end.',
    });
    expect(exited.status).toBe(201);
    expect(
      (await prisma.user.findUnique({ where: { id: userId } }))?.status,
    ).toBe(UserStatus.SUSPENDED);
    expect(
      await prisma.refreshToken.count({ where: { userId, revokedAt: null } }),
    ).toBe(0);

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: `stale-rehire-${run}`,
        audience: SessionAudience.STAFF,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const secondOffer = await createOffer(identityId, code);
    expect(await issueAndAccept(secondOffer)).toBe(code);
    const rejoined = await api(
      'post',
      `/admin/employee-register/people/${identityId}/join`,
    ).send({ idempotencyKey: key('rejoin') });
    expect(rejoined.status).toBe(201);
    const rehireProfile = await prisma.employeeProfile.findUnique({
      where: { employeeIdentityId: identityId },
      include: { user: true },
    });
    expect(rehireProfile?.id).toBe(profile!.id);
    expect(rehireProfile?.userId).toBe(userId);
    expect(rehireProfile?.employeeCode).toBe(code);
    expect(
      await prisma.refreshToken.count({ where: { userId, revokedAt: null } }),
    ).toBe(0);
    expect(
      await prisma.employeeEmploymentEpisode.count({ where: { identityId } }),
    ).toBe(2);
  });

  it('serializes concurrent issuance and rejects duplicate contacts and idempotency-key payload changes', async () => {
    const sharedPhone = `+917${digits}`;
    const firstId = await createCandidate(
      `race-a-${run}@example.test`,
      sharedPhone,
      'Shared Candidate',
    );
    await verify(firstId);
    const firstDraft = await createOffer(firstId);
    const duplicateMatches = await api(
      'post',
      '/admin/employee-register/people/matches',
    ).send({ fullName: 'Another Candidate', phone: sharedPhone });
    expect(duplicateMatches.status).toBe(201);
    expect(duplicateMatches.body.blocksNewIdentity).toBe(true);
    const duplicate = await api('post', '/admin/employee-register/people').send(
      {
        idempotencyKey: key('duplicate'),
        fullName: 'Another Candidate',
        phone: sharedPhone,
        matchReview: {
          decision: 'NO_MATCH',
          evidenceReference: `HR-MATCH-${run.slice(0, 8)}`,
          reason: 'A contact match must be reconciled to the existing person.',
        },
      },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe(
      'EMPLOYEE_IDENTITY_MATCH_REQUIRES_REVIEW',
    );

    const distinctContactIdentity = await createCandidate(
      `race-distinct-${run}@example.test`,
      sharedPhone,
      'Different person sharing a contact',
    );
    const distinctReview = await prisma.employeeHrEvent.findFirstOrThrow({
      where: {
        identityId: distinctContactIdentity,
        eventType: 'EMPLOYEE_IDENTITY_MATCH_REVIEWED',
      },
    });
    expect(distinctReview.metadata).toMatchObject({
      decision: 'DISTINCT_PERSON',
      reviewedPersonIds: [firstId],
    });

    const nameMatches = await api(
      'post',
      '/admin/employee-register/people/matches',
    ).send({ fullName: 'Shared Candidate', phone: `+916${digits}` });
    expect(nameMatches.status).toBe(201);
    expect(nameMatches.body.blocksNewIdentity).toBe(false);
    expect(nameMatches.body.requiresReview).toBe(true);
    expect(
      nameMatches.body.matches.map(
        (match: { person: { id: string } }) => match.person.id,
      ),
    ).toContain(firstId);
    const unreviewedSameName = await api(
      'post',
      '/admin/employee-register/people',
    ).send({
      idempotencyKey: key('unreviewed-same-name'),
      fullName: 'Shared Candidate',
      phone: `+916${digits}`,
      matchReview: {
        decision: 'NO_MATCH',
        evidenceReference: `HR-MATCH-${run.slice(0, 8)}`,
        reason:
          'Intentionally missing the reviewed person decision for the negative test.',
      },
    });
    expect(unreviewedSameName.status).toBe(409);
    expect(unreviewedSameName.body.error.code).toBe(
      'EMPLOYEE_IDENTITY_MATCH_REQUIRES_REVIEW',
    );
    const secondId = await createCandidate(
      `race-b-${run}@example.test`,
      `+916${digits}`,
      'Shared Candidate',
    );
    await verify(secondId);
    const secondDraft = await createOffer(secondId);
    const [first, second] = await Promise.all([
      api('post', `/admin/employee-register/offers/${firstDraft}/issue`).send({
        idempotencyKey: key('race-issue-a'),
      }),
      api('post', `/admin/employee-register/offers/${secondDraft}/issue`).send({
        idempotencyKey: key('race-issue-b'),
      }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.employeeCode).not.toBe(second.body.employeeCode);
    expect(first.body.employeeCode).toMatch(/^FQ-FE-/);
    expect(second.body.employeeCode).toMatch(/^FQ-FE-/);

    const replayKey = key('create-replay');
    const replayPhone = `+915${digits}`;
    await createCandidate(
      `replay-${run}@example.test`,
      replayPhone,
      'Replay Candidate',
      replayKey,
    );
    const replay = await api('post', '/admin/employee-register/people').send({
      idempotencyKey: replayKey,
      fullName: 'Different Payload',
      phone: replayPhone,
      matchReview: {
        decision: 'NO_MATCH',
        evidenceReference: `HR-MATCH-${run.slice(0, 8)}`,
        reason: 'Synthetic payload change for idempotency replay check.',
      },
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('does not create duplicate identities when two HR admins race on the same contact', async () => {
    const phone = `+913${digits}`;
    const candidate = (suffix: string) =>
      api('post', '/admin/employee-register/people').send({
        idempotencyKey: key(`contact-race-${suffix}`),
        fullName: `Contact Race ${suffix}`,
        email: `contact-race-${suffix}-${run}@example.test`,
        phone,
        matchReview: {
          decision: 'NO_MATCH',
          evidenceReference: `HR-RACE-${run.slice(0, 8)}`,
          reason: 'Both requests passed preflight before the controlled race.',
        },
      });
    const [first, second] = await Promise.all([candidate('a'), candidate('b')]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const contactCount = await prisma.employeeIdentityContact.count({
      where: {
        kind: 'PHONE',
        lookupHash: crypto.blindIndex('hr-phone', phone),
      },
    });
    expect(contactCount).toBe(1);
  });

  it('never links a matching customer account or grants employee access by contact equality', async () => {
    const phone = `+912${digits}`;
    const customer = await prisma.user.create({
      data: {
        phone,
        phoneVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: customer.id, role: Role.CUSTOMER, salonId: null },
    });

    const identityId = await createCandidate(
      `employee-customer-collision-${run}@example.test`,
      phone,
      'Candidate with existing customer contact',
    );
    await verify(identityId);
    const offerId = await createOffer(identityId);
    await issueAndAccept(offerId);

    const joined = await api(
      'post',
      `/admin/employee-register/people/${identityId}/join`,
    ).send({
      idempotencyKey: key('customer-collision-join'),
      password: 'StrongPass123',
      confirmPassword: 'StrongPass123',
    });
    expect(joined.status).toBe(409);
    expect(joined.body.error.code).toBe(
      'EMPLOYEE_ACCOUNT_OWNERSHIP_VERIFICATION_REQUIRED',
    );
    expect(
      await prisma.employeeProfile.findUnique({
        where: { employeeIdentityId: identityId },
      }),
    ).toBeNull();
    expect(
      await prisma.userRole.findMany({ where: { userId: customer.id } }),
    ).toEqual([
      expect.objectContaining({ role: Role.CUSTOMER, userId: customer.id }),
    ]);
    expect(
      await prisma.userRole.count({
        where: { userId: customer.id, role: Role.FIELD_EXECUTIVE },
      }),
    ).toBe(0);
  });

  it('stores contact and compensation values encrypted and keeps HR history append-only', async () => {
    const contactPhone = `+914${digits}`;
    const identityId = await createCandidate(
      `audit-${run}@example.test`,
      contactPhone,
    );
    const identity = await prisma.employeeIdentity.findUniqueOrThrow({
      where: { id: identityId },
      include: { contacts: true },
    });
    const contact = identity.contacts[0];
    expect(contact.encryptedValue).not.toContain(contactPhone);
    const event = await prisma.employeeHrEvent.findFirstOrThrow({
      where: { identityId },
    });
    expect(JSON.stringify(event.metadata)).not.toMatch(
      /email|phone|password|compensation/i,
    );
    const matchReviewEvent = await prisma.employeeHrEvent.findFirstOrThrow({
      where: { identityId, eventType: 'EMPLOYEE_IDENTITY_MATCH_REVIEWED' },
    });
    expect(matchReviewEvent.metadata).toMatchObject({
      decision: 'NO_MATCH',
      evidenceReferenceRecorded: true,
    });
    await expect(
      prisma.employeeIdentityContact.update({
        where: { id: contact.id },
        data: { lookupHash: 'tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.employeeHrEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow();
  });
});
