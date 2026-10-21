import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HR_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR,
  Role,
  UserStatus,
  type AuthenticatedUser,
  type HrActorRef,
  type HrAuditPage,
  type HrContactUpdateInput,
  type HrCreateOfferInput,
  type HrCreateOfferResult,
  type HrExitInput,
  type HrJoiningInput,
  type HrLetterData,
  type HrMatchCandidate,
  type HrMatchQuery,
  type HrMatchReason,
  type HrMatchResult,
  type HrNotJoinedInput,
  type HrOfferStatusInput,
  type HrOfferVersion,
  type HrPdfEvent,
  type HrPdfEventInput,
  type HrPersonDetail,
  type HrRegisterPage,
  type HrRegisterQuery,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/services/password.service';
import { AppException } from '../common/exceptions/app.exception';
import { HrPrivacyService } from './hr-privacy.service';
import { HrCodeAllocator } from './hr-code-allocator.service';
import {
  actorIdsOf,
  mapDetail,
  mapSummary,
  personInclude,
  type ActorLookup,
  type PersonRecord,
} from './hr-register.mapper';
import {
  fromDateOnly,
  maskEmail,
  maskPhone,
  nameFirstKey,
  nameKey,
  normalizeEmail,
  normalizePhone,
  similarNames,
  todayInIndia,
  toDateOnly,
} from './hr-register.util';

type Tx = Prisma.TransactionClient;
type Actor = Pick<AuthenticatedUser, 'id' | 'roles'>;

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const OPEN_OFFER_STATUSES = ['ISSUED', 'SENT', 'ACCEPTED'] as const;

const isSenior = (actor: Actor) =>
  actor.roles.includes(Role.PLATFORM_ADMIN) ||
  actor.roles.includes(Role.CO_FOUNDER);

interface AuditInput {
  personId: string;
  action: string;
  actorUserId: string | null;
  offerId?: string | null;
  episodeId?: string | null;
  subjectKind?: 'PERSON' | 'OFFER' | 'EPISODE' | 'RECONCILIATION';
  subjectLabel?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}

interface FoundMatch {
  person: PersonRecord;
  reasons: HrMatchReason[];
  strength: 'STRONG' | 'WEAK';
  hard: boolean;
}

@Injectable()
export class HrRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: HrPrivacyService,
    private readonly allocator: HrCodeAllocator,
    private readonly passwords: PasswordService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------

  async audit(tx: Tx, input: AuditInput): Promise<void> {
    await tx.hrAuditEvent.create({
      data: {
        personId: input.personId,
        action: input.action,
        actorUserId: input.actorUserId,
        offerId: input.offerId ?? null,
        episodeId: input.episodeId ?? null,
        subjectKind: input.subjectKind ?? 'PERSON',
        subjectLabel: input.subjectLabel ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata ?? {},
      },
    });
  }

  /** Display names for actors: the employee's own name if they have a profile, else a masked e-mail. */
  async actorLookup(
    ids: Array<string | null | undefined>,
  ): Promise<ActorLookup> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (unique.length > 0) {
      const [users, profiles] = await Promise.all([
        this.prisma.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, email: true },
        }),
        this.prisma.employeeProfile.findMany({
          where: { userId: { in: unique } },
          select: { userId: true, fullName: true },
        }),
      ]);
      for (const user of users)
        names.set(
          user.id,
          user.email ? maskEmail(user.email) : 'Administrator',
        );
      for (const profile of profiles)
        names.set(profile.userId, profile.fullName);
    }
    return (id) =>
      id
        ? { id, displayName: names.get(id) ?? 'Administrator' }
        : { id: 'system', displayName: 'System' };
  }

  private async loadPerson(
    client: Tx | PrismaService,
    personId: string,
  ): Promise<PersonRecord> {
    const person = await client.hrPerson.findUnique({
      where: { id: personId },
      include: personInclude,
    });
    if (!person)
      throw new AppException(
        'HR_PERSON_NOT_FOUND',
        'No such person in the HR register.',
        HttpStatus.NOT_FOUND,
      );
    return person;
  }

  private async lockPerson(tx: Tx, personId: string): Promise<void> {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "hr_persons" WHERE "id" = ${personId} FOR UPDATE`;
    if (rows.length === 0)
      throw new AppException(
        'HR_PERSON_NOT_FOUND',
        'No such person in the HR register.',
        HttpStatus.NOT_FOUND,
      );
  }

  private assertNotFuture(value: string, label: string): void {
    if (value > todayInIndia()) {
      throw new AppException(
        'HR_DATE_IN_FUTURE',
        `${label} cannot be in the future.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private async detail(personId: string): Promise<HrPersonDetail> {
    const person = await this.loadPerson(this.prisma, personId);
    return mapDetail(person, await this.actorLookup(actorIdsOf(person)));
  }

  // ---------------------------------------------------------------------------------------------
  // reads
  // ---------------------------------------------------------------------------------------------

  async search(query: HrRegisterQuery): Promise<HrRegisterPage> {
    const where: Prisma.Sql[] = [];
    if (query.employeeCode)
      where.push(Prisma.sql`p."employeeCode" = ${query.employeeCode}`);
    if (query.q) {
      const text = query.q.trim();
      const parts: Prisma.Sql[] = [];
      const like = `%${nameKey(text).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      parts.push(Prisma.sql`p."nameKey" LIKE ${like}`);
      parts.push(Prisma.sql`p."employeeCode" ILIKE ${like}`);
      if (text.includes('@'))
        parts.push(
          Prisma.sql`p."emailHash" = ${this.privacy.blindIndex(normalizeEmail(text))}`,
        );
      const phone = normalizePhone(text);
      if (phone && /^[\d\s+()-]+$/.test(text))
        parts.push(
          Prisma.sql`p."phoneHash" = ${this.privacy.blindIndex(phone)}`,
        );
      where.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
    }
    switch (query.lifecycle) {
      case 'OFFERED':
        where.push(
          Prisma.sql`(e."id" IS NULL OR (e."status" = 'PENDING_JOIN' AND e."episodeNumber" = 1))`,
        );
        break;
      case 'REOFFERED':
        where.push(
          Prisma.sql`(e."status" = 'PENDING_JOIN' AND e."episodeNumber" > 1)`,
        );
        break;
      case 'NOT_JOINED':
        where.push(Prisma.sql`e."status" = 'NOT_JOINED'`);
        break;
      case 'ACTIVE':
        where.push(
          Prisma.sql`(e."status" = 'ACTIVE' AND e."episodeNumber" = 1)`,
        );
        break;
      case 'REJOINED':
        where.push(
          Prisma.sql`(e."status" = 'ACTIVE' AND e."episodeNumber" > 1)`,
        );
        break;
      case 'EXITED':
        where.push(Prisma.sql`e."status" = 'EXITED'`);
        break;
      default:
        break;
    }
    if (query.offerStatus)
      where.push(
        Prisma.sql`o."status" = ${query.offerStatus}::"HrOfferStatus"`,
      );
    if (query.city)
      where.push(
        Prisma.sql`p."city" ILIKE ${`%${query.city.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`}`,
      );
    if (query.managerId) {
      where.push(
        Prisma.sql`(EXISTS (SELECT 1 FROM "hr_manager_history" m WHERE m."personId" = p."id" AND m."toDate" IS NULL AND m."managerProfileId" = ${query.managerId})
          OR o."reportingManagerProfileId" = ${query.managerId})`,
      );
    }
    if (query.issuedFrom)
      where.push(
        Prisma.sql`(o."issuedAt" AT TIME ZONE 'Asia/Kolkata')::date >= ${query.issuedFrom}::date`,
      );
    if (query.issuedTo)
      where.push(
        Prisma.sql`(o."issuedAt" AT TIME ZONE 'Asia/Kolkata')::date <= ${query.issuedTo}::date`,
      );

    const base = Prisma.sql`
      FROM "hr_persons" p
      LEFT JOIN LATERAL (
        SELECT * FROM "hr_employment_episodes" x WHERE x."personId" = p."id" ORDER BY x."episodeNumber" DESC LIMIT 1
      ) e ON TRUE
      LEFT JOIN LATERAL (
        SELECT * FROM "hr_offer_versions" y WHERE y."personId" = p."id" ORDER BY y."version" DESC LIMIT 1
      ) o ON TRUE`;
    const filter =
      where.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`
        : Prisma.empty;
    const paged = query.cursor
      ? Prisma.sql`${where.length > 0 ? Prisma.sql`AND` : Prisma.sql`WHERE`} p."employeeCode" > ${query.cursor}`
      : Prisma.empty;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; employeeCode: string }>>`
        SELECT p."id", p."employeeCode" ${base} ${filter} ${paged} ORDER BY p."employeeCode" ASC LIMIT ${query.limit + 1}`,
      this.prisma.$queryRaw<
        Array<{ total: number }>
      >`SELECT COUNT(*)::int AS "total" ${base} ${filter}`,
    ]);
    const pageRows = rows.slice(0, query.limit);
    const persons = await this.prisma.hrPerson.findMany({
      where: { id: { in: pageRows.map((row) => row.id) } },
      include: personInclude,
    });
    const byId = new Map(persons.map((person) => [person.id, person]));
    return {
      items: pageRows.map((row) => mapSummary(byId.get(row.id)!)),
      nextCursor:
        rows.length > query.limit
          ? pageRows[pageRows.length - 1].employeeCode
          : null,
      total: totals[0]?.total ?? 0,
    };
  }

  async getPerson(personId: string): Promise<HrPersonDetail> {
    return this.detail(personId);
  }

  async listAudit(
    personId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<HrAuditPage> {
    await this.loadPerson(this.prisma, personId);
    let before: { at: Date; id: string } | null = null;
    if (cursor) {
      const [at, id] = Buffer.from(cursor, 'base64url')
        .toString('utf8')
        .split('|');
      const when = new Date(at);
      if (id && !Number.isNaN(when.getTime())) before = { at: when, id };
    }
    const rows = await this.prisma.hrAuditEvent.findMany({
      where: {
        personId,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.at } },
                { createdAt: before.at, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const actor = await this.actorLookup(page.map((row) => row.actorUserId));
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        actor: actor(row.actorUserId),
        action: row.action,
        subject: {
          kind: row.subjectKind as
            'PERSON' | 'OFFER' | 'EPISODE' | 'RECONCILIATION',
          label: row.subjectLabel ?? row.subjectKind,
        },
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        reason: row.reason,
      })),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString(
              'base64url',
            )
          : null,
    };
  }

  /** The contacts exactly as printed on one saved offer; every read is audited. */
  async getLetterData(actor: Actor, offerId: string): Promise<HrLetterData> {
    const offer = await this.prisma.hrOfferVersion.findUnique({
      where: { id: offerId },
    });
    if (!offer)
      throw new AppException(
        'HR_OFFER_NOT_FOUND',
        'No such offer.',
        HttpStatus.NOT_FOUND,
      );
    if (offer.source !== 'REGISTER' || !offer.letterContactEnc) {
      throw new AppException(
        'HR_LETTER_NOT_STORED',
        'The original letter details were not stored in the register.',
        HttpStatus.CONFLICT,
      );
    }
    const snapshot = JSON.parse(
      this.privacy.decrypt(offer.letterContactEnc),
    ) as HrLetterData;
    await this.prisma.$transaction(async (tx) => {
      await this.audit(tx, {
        personId: offer.personId,
        offerId: offer.id,
        action: 'LETTER_DATA_READ',
        subjectKind: 'OFFER',
        subjectLabel: `Offer v${offer.version}`,
        actorUserId: actor.id,
      });
    });
    return snapshot;
  }

  // ---------------------------------------------------------------------------------------------
  // identity matching
  // ---------------------------------------------------------------------------------------------

  private async findMatches(
    client: Tx | PrismaService,
    query: HrMatchQuery,
  ): Promise<FoundMatch[]> {
    const or: Prisma.HrPersonWhereInput[] = [];
    const email = query.email ? normalizeEmail(query.email) : null;
    const phone = query.phone ? normalizePhone(query.phone) : null;
    const emailHash = email ? this.privacy.blindIndex(email) : null;
    const phoneHash = phone ? this.privacy.blindIndex(phone) : null;
    const key = query.fullName ? nameKey(query.fullName) : null;
    if (query.employeeCode) or.push({ employeeCode: query.employeeCode });
    if (emailHash) or.push({ emailHash });
    if (phoneHash) or.push({ phoneHash });
    if (key) {
      or.push({ nameKey: key });
      or.push({ nameFirstKey: nameFirstKey(key) });
    }
    if (or.length === 0) return [];

    const persons = await client.hrPerson.findMany({
      where: { OR: or },
      include: personInclude,
      orderBy: { employeeCode: 'asc' },
      take: 60,
    });
    const found: FoundMatch[] = [];
    for (const person of persons) {
      const reasons: HrMatchReason[] = [];
      if (query.employeeCode && person.employeeCode === query.employeeCode)
        reasons.push('EXACT_CODE');
      const emailMatch = !!emailHash && person.emailHash === emailHash;
      const phoneMatch = !!phoneHash && person.phoneHash === phoneHash;
      if (emailMatch) reasons.push('EMAIL');
      if (phoneMatch) reasons.push('PHONE');
      const nameExact = !!key && person.nameKey === key;
      const nameSimilar =
        !!query.fullName &&
        !nameExact &&
        similarNames(query.fullName, person.fullName);
      if (nameExact) reasons.push('NAME_EXACT');
      else if (nameSimilar) reasons.push('NAME_SIMILAR');
      if (reasons.length === 0) continue;
      if (person.offers.length > 0) reasons.push('PRIOR_OFFER');
      const contact = emailMatch || phoneMatch;
      const strong =
        reasons.includes('EXACT_CODE') ||
        (contact && (nameExact || nameSimilar));
      found.push({
        person,
        reasons,
        strength: strong ? 'STRONG' : 'WEAK',
        hard: contact && nameExact,
      });
    }
    return found;
  }

  private fingerprintOf(query: HrMatchQuery): string {
    return this.privacy.fingerprint([
      query.fullName ? nameKey(query.fullName) : '',
      query.email ? normalizeEmail(query.email) : '',
      query.phone ? (normalizePhone(query.phone) ?? '') : '',
      query.employeeCode ?? '',
    ]);
  }

  async matchIdentity(
    actor: Actor,
    query: HrMatchQuery,
  ): Promise<HrMatchResult> {
    const found = await this.findMatches(this.prisma, query);
    const actorRefs = await this.actorLookup(
      found.flatMap((match) => actorIdsOf(match.person)),
    );
    const blocks =
      found.length > 0 &&
      (found.some((match) => match.strength === 'STRONG') || found.length > 1);
    const candidates: HrMatchCandidate[] = found.map((match) => ({
      person: mapSummary(match.person),
      reasons: match.reasons,
      strength: match.strength,
    }));
    void actorRefs;
    return {
      matches: candidates,
      blocksNewIdentity: blocks,
      overrideRequiresSenior: found.some((match) => match.hard),
      decisionToken: this.privacy.signDecision({
        a: actor.id,
        ids: found.map((match) => match.person.id),
        q: this.fingerprintOf(query),
      }),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // offers
  // ---------------------------------------------------------------------------------------------

  private letterSnapshot(
    fullName: string,
    contacts: {
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ): string {
    return this.privacy.encrypt(
      JSON.stringify({
        candidateName: fullName,
        email: contacts.email ?? null,
        phone: contacts.phone ?? null,
        address: contacts.address ?? null,
      }),
    );
  }

  async createOffer(
    actor: Actor,
    input: HrCreateOfferInput,
  ): Promise<HrCreateOfferResult> {
    const token = this.privacy.verifyDecision(input.identity.decisionToken);
    if (!token || token.a !== actor.id) {
      throw new AppException(
        'HR_MATCH_REVIEW_REQUIRED',
        'Run the identity check again before saving this offer.',
        HttpStatus.CONFLICT,
      );
    }

    const personId = await this.prisma.$transaction(async (tx) => {
      await this.allocator.lock(tx);
      let personRow: { id: string; fullName: string; letter: string };

      if (input.identity.mode === 'EXISTING') {
        const existingId = input.identity.personId;
        if (!token.ids.includes(existingId)) {
          throw new AppException(
            'HR_IDENTITY_CONFLICT',
            'That person was not part of the reviewed matches.',
            HttpStatus.CONFLICT,
          );
        }
        await this.lockPerson(tx, existingId);
        const existing = await tx.hrPerson.findUniqueOrThrow({
          where: { id: existingId },
        });
        const contacts = {
          email: existing.emailEnc
            ? this.privacy.decrypt(existing.emailEnc)
            : null,
          phone: existing.phoneEnc
            ? this.privacy.decrypt(existing.phoneEnc)
            : null,
          address: existing.addressEnc
            ? this.privacy.decrypt(existing.addressEnc)
            : null,
        };
        personRow = {
          id: existing.id,
          fullName: existing.fullName,
          letter: this.letterSnapshot(existing.fullName, contacts),
        };
      } else {
        const identity = input.identity.person;
        const reviewed = {
          fullName: identity.fullName,
          email: identity.email,
          phone: identity.phone,
        };
        if (token.q !== this.fingerprintOf(reviewed)) {
          throw new AppException(
            'HR_MATCH_REVIEW_REQUIRED',
            'The details changed after the identity check. Check again.',
            HttpStatus.CONFLICT,
          );
        }
        // Authoritative re-check under the allocator lock: a concurrent create cannot slip a duplicate past a stale review.
        const found = await this.findMatches(tx, reviewed);
        if (found.some((match) => !token.ids.includes(match.person.id))) {
          throw new AppException(
            'HR_IDENTITY_CONFLICT',
            'Someone with similar details was added meanwhile. Check again.',
            HttpStatus.CONFLICT,
          );
        }
        const blocks =
          found.length > 0 &&
          (found.some((match) => match.strength === 'STRONG') ||
            found.length > 1);
        const hard = found.some((match) => match.hard);
        if (blocks && !input.identity.overrideReason) {
          throw new AppException(
            'HR_MATCH_REVIEW_REQUIRED',
            'These details are too close to an existing person; a written reason is required.',
            HttpStatus.CONFLICT,
          );
        }
        if (hard && !isSenior(actor)) {
          throw new AppException(
            'HR_OVERRIDE_REQUIRES_SENIOR',
            'The contact and name match an existing person exactly; only a Co-Founder or Platform Admin may create a separate identity.',
            HttpStatus.FORBIDDEN,
          );
        }
        const allocated = await this.allocator.nextStandard(tx);
        const email = identity.email ? normalizeEmail(identity.email) : null;
        const phone = identity.phone ? normalizePhone(identity.phone) : null;
        const created = await tx.hrPerson.create({
          data: {
            employeeCode: allocated.code,
            codeNumber: allocated.number,
            fullName: identity.fullName,
            nameKey: nameKey(identity.fullName),
            nameFirstKey: nameFirstKey(identity.fullName),
            emailHash: email ? this.privacy.blindIndex(email) : null,
            phoneHash: phone ? this.privacy.blindIndex(phone) : null,
            emailEnc: email ? this.privacy.encrypt(email) : null,
            phoneEnc: identity.phone
              ? this.privacy.encrypt(identity.phone)
              : null,
            addressEnc: identity.address
              ? this.privacy.encrypt(identity.address)
              : null,
            maskedEmail: email ? maskEmail(email) : null,
            maskedPhone: identity.phone ? maskPhone(identity.phone) : null,
            city: input.terms.city,
            origin: 'OFFER',
            createdById: actor.id,
          },
        });
        await this.audit(tx, {
          personId: created.id,
          action: 'IDENTITY_CREATED',
          actorUserId: actor.id,
          subjectLabel: created.fullName,
          reason: input.identity.overrideReason ?? null,
          metadata: {
            employeeCode: created.employeeCode,
            matchCount: found.length,
            overrideUsed: !!input.identity.overrideReason,
          },
        });
        personRow = {
          id: created.id,
          fullName: created.fullName,
          letter: this.letterSnapshot(created.fullName, {
            email,
            phone: identity.phone,
            address: identity.address,
          }),
        };
      }

      const person = await tx.hrPerson.findUniqueOrThrow({
        where: { id: personRow.id },
        include: {
          episodes: { orderBy: { episodeNumber: 'asc' } },
          offers: { orderBy: { version: 'asc' } },
        },
      });
      let episode =
        person.episodes.length > 0
          ? person.episodes[person.episodes.length - 1]
          : null;
      const latestOffer =
        person.offers.length > 0
          ? person.offers[person.offers.length - 1]
          : null;

      if (episode?.status === 'ACTIVE') {
        // A login suspended from the legacy Employees page means the person is no longer working: close the
        // episode (audited) so a rehire can proceed. A genuinely active employee still cannot be re-offered.
        const profile = person.employeeProfileId
          ? await tx.employeeProfile.findUnique({
              where: { id: person.employeeProfileId },
              select: { user: { select: { status: true } } },
            })
          : null;
        if (profile?.user.status !== UserStatus.SUSPENDED) {
          throw new AppException(
            'HR_OFFER_INVALID_TRANSITION',
            'This employee is currently employed. Record their exit before issuing a new offer.',
            HttpStatus.CONFLICT,
          );
        }
        const today = todayInIndia();
        const joined = fromDateOnly(episode.joinedOn);
        const exitedOn = joined && joined > today ? joined : today;
        episode = await tx.hrEmploymentEpisode.update({
          where: { id: episode.id },
          data: {
            status: 'EXITED',
            exitedOn: toDateOnly(exitedOn),
            statusReason: 'Login suspended from the Employees page',
          },
        });
        await this.audit(tx, {
          personId: person.id,
          episodeId: episode.id,
          action: 'EXITED_ON_SUSPENDED_ACCOUNT',
          subjectKind: 'EPISODE',
          subjectLabel: `Episode ${episode.episodeNumber}`,
          fromStatus: 'ACTIVE',
          toStatus: 'EXITED',
          actorUserId: actor.id,
        });
      }
      if (
        episode?.status === 'PENDING_JOIN' &&
        latestOffer &&
        (OPEN_OFFER_STATUSES as readonly string[]).includes(latestOffer.status)
      ) {
        throw new AppException(
          'HR_OPEN_OFFER_EXISTS',
          'This person already has an open offer. Record its outcome first.',
          HttpStatus.CONFLICT,
        );
      }

      let managerProfileId: string | null = null;
      if (input.terms.reportingManagerId) {
        const manager = await tx.employeeProfile.findUnique({
          where: { id: input.terms.reportingManagerId },
          select: { id: true },
        });
        if (!manager)
          throw new AppException(
            'HR_MANAGER_NOT_FOUND',
            'The chosen reporting manager does not exist.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        managerProfileId = manager.id;
      }

      const version = (latestOffer?.version ?? 0) + 1;
      const kind =
        episode?.status === 'EXITED'
          ? 'REHIRE'
          : person.offers.length === 0
            ? 'FIRST'
            : 'REOFFER';
      let episodeId: string;
      if (episode && episode.status === 'PENDING_JOIN') {
        episodeId = episode.id;
        await tx.hrEmploymentEpisode.update({
          where: { id: episode.id },
          data: { originatingOfferVersion: version },
        });
      } else {
        const created = await tx.hrEmploymentEpisode.create({
          data: {
            personId: person.id,
            episodeNumber: (episode?.episodeNumber ?? 0) + 1,
            status: 'PENDING_JOIN',
            originatingOfferVersion: version,
          },
        });
        episodeId = created.id;
      }

      const offer = await tx.hrOfferVersion.create({
        data: {
          personId: person.id,
          episodeId,
          version,
          kind,
          source: 'REGISTER',
          status: 'ISSUED',
          createdById: actor.id,
          role: input.terms.role,
          baseSalaryInr: new Prisma.Decimal(input.terms.baseSalaryInr),
          salaryBasis:
            input.terms.salaryBasis === 'monthly' ? 'MONTHLY' : 'ANNUAL',
          salesTarget: input.terms.salesTarget,
          incentiveBeyondTargetInr: input.terms.incentiveBeyondTargetInr,
          proposedJoiningDate: input.terms.proposedJoiningDate
            ? toDateOnly(input.terms.proposedJoiningDate)
            : null,
          reportingManagerProfileId: managerProfileId,
          city: input.terms.city,
          expectedPerformanceIncentiveMonthlyInr:
            HR_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR,
          letterContactEnc: personRow.letter,
        },
      });
      if (input.terms.city)
        await tx.hrPerson.update({
          where: { id: person.id },
          data: { city: input.terms.city },
        });
      await this.audit(tx, {
        personId: person.id,
        offerId: offer.id,
        episodeId,
        action: 'OFFER_ISSUED',
        subjectKind: 'OFFER',
        subjectLabel: `Offer v${version}`,
        toStatus: 'ISSUED',
        actorUserId: actor.id,
        metadata: { version, kind },
      });
      return person.id;
    }, TX_OPTIONS);

    const detail = await this.detail(personId);
    const offer = detail.offers[detail.offers.length - 1];
    const {
      offers: _offers,
      episodes: _episodes,
      salaryHistory: _salary,
      managerHistory: _manager,
      ...summary
    } = detail;
    void _offers;
    void _episodes;
    void _salary;
    void _manager;
    return { person: summary, offer };
  }

  private async offerForUpdate(tx: Tx, offerId: string) {
    const found = await tx.hrOfferVersion.findUnique({
      where: { id: offerId },
      select: { personId: true },
    });
    if (!found)
      throw new AppException(
        'HR_OFFER_NOT_FOUND',
        'No such offer.',
        HttpStatus.NOT_FOUND,
      );
    await this.lockPerson(tx, found.personId);
    const offer = await tx.hrOfferVersion.findUniqueOrThrow({
      where: { id: offerId },
    });
    const latest = await tx.hrOfferVersion.findFirst({
      where: { personId: offer.personId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return { offer, superseded: !!latest && latest.version > offer.version };
  }

  async transitionOffer(
    actor: Actor,
    offerId: string,
    input: HrOfferStatusInput,
  ): Promise<HrOfferVersion> {
    const personId = await this.prisma.$transaction(async (tx) => {
      const { offer, superseded } = await this.offerForUpdate(tx, offerId);
      const allowed: Record<string, string[]> = {
        ISSUED: ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'],
        SENT: ['ACCEPTED', 'DECLINED', 'EXPIRED'],
      };
      if (
        superseded ||
        offer.source !== 'REGISTER' ||
        !(allowed[offer.status] ?? []).includes(input.to)
      ) {
        throw new AppException(
          'HR_OFFER_INVALID_TRANSITION',
          `An offer that is ${offer.status.toLowerCase()} cannot be recorded as ${input.to.toLowerCase()}.`,
          HttpStatus.CONFLICT,
        );
      }
      const now = new Date();
      await tx.hrOfferVersion.update({
        where: { id: offer.id },
        data: {
          status: input.to,
          statusReason: input.reason ?? offer.statusReason,
          ...(input.to === 'SENT' ? { sentAt: now } : {}),
          ...(input.to === 'ACCEPTED' ? { acceptedAt: now } : {}),
          ...(input.to === 'DECLINED' ? { declinedAt: now } : {}),
          ...(input.to === 'EXPIRED' ? { expiredAt: now } : {}),
        },
      });
      await this.audit(tx, {
        personId: offer.personId,
        offerId: offer.id,
        episodeId: offer.episodeId,
        action: `OFFER_${input.to}`,
        subjectKind: 'OFFER',
        subjectLabel: `Offer v${offer.version}`,
        fromStatus: offer.status,
        toStatus: input.to,
        reason: input.reason ?? null,
        actorUserId: actor.id,
      });
      return offer.personId;
    }, TX_OPTIONS);
    const detail = await this.detail(personId);
    return detail.offers.find((candidate) => candidate.id === offerId)!;
  }

  async recordPdfEvent(
    actor: Actor,
    offerId: string,
    input: HrPdfEventInput,
  ): Promise<HrPdfEvent> {
    const offer = await this.prisma.hrOfferVersion.findUnique({
      where: { id: offerId },
    });
    if (!offer)
      throw new AppException(
        'HR_OFFER_NOT_FOUND',
        'No such offer.',
        HttpStatus.NOT_FOUND,
      );
    if (offer.source !== 'REGISTER') {
      throw new AppException(
        'HR_LETTER_NOT_STORED',
        'A letter emailed before the register existed has no PDF to record.',
        HttpStatus.CONFLICT,
      );
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const event = await tx.hrPdfEvent.create({
        data: {
          offerId,
          event: input.event,
          sha256: input.sha256,
          byteLength: input.byteLength,
          actorId: actor.id,
        },
      });
      await this.audit(tx, {
        personId: offer.personId,
        offerId,
        episodeId: offer.episodeId,
        action: `PDF_${input.event}`,
        subjectKind: 'OFFER',
        subjectLabel: `Offer v${offer.version}`,
        actorUserId: actor.id,
        metadata: { sha256: input.sha256, byteLength: input.byteLength },
      });
      return event;
    }, TX_OPTIONS);
    const actorRef: HrActorRef = (await this.actorLookup([actor.id]))(actor.id);
    return {
      id: created.id,
      event: created.event,
      at: created.createdAt.toISOString(),
      actor: actorRef,
      sha256: created.sha256,
      byteLength: created.byteLength,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // employment lifecycle
  // ---------------------------------------------------------------------------------------------

  async recordJoining(
    actor: Actor,
    offerId: string,
    input: HrJoiningInput,
  ): Promise<HrPersonDetail> {
    this.assertNotFuture(input.joinedOn, 'The joining date');
    const passwordHash = await this.passwords.hash(input.temporaryPassword);

    const personId = await this.prisma.$transaction(async (tx) => {
      const { offer, superseded } = await this.offerForUpdate(tx, offerId);
      const episode = await tx.hrEmploymentEpisode.findUniqueOrThrow({
        where: { id: offer.episodeId },
      });
      if (
        superseded ||
        offer.status !== 'ACCEPTED' ||
        episode.status !== 'PENDING_JOIN'
      ) {
        throw new AppException(
          'HR_OFFER_INVALID_TRANSITION',
          'Joining can only be approved for the current, accepted offer of a candidate awaiting joining.',
          HttpStatus.CONFLICT,
        );
      }
      const person = await tx.hrPerson.findUniqueOrThrow({
        where: { id: offer.personId },
      });
      const joinedOn = toDateOnly(input.joinedOn);
      const rejoin = person.employeeProfileId !== null;

      if (!rejoin) {
        // First joining: the ONLY place a login is created for a register person. The reserved-code trigger
        // accepts the insert because this transaction declares which person owns the code.
        const user = await tx.user.create({
          data: { passwordHash, status: UserStatus.ACTIVE },
        });
        await tx.userRole.create({
          data: { userId: user.id, role: Role.FIELD_EXECUTIVE, salonId: null },
        });
        await tx.$executeRaw`SELECT set_config('app.hr_joining_person', ${person.id}, true)`;
        const profile = await tx.employeeProfile.create({
          data: {
            userId: user.id,
            employeeCode: person.employeeCode,
            fullName: person.fullName,
            territory: input.territory?.trim() || null,
          },
        });
        await tx.hrPerson.update({
          where: { id: person.id },
          data: { employeeProfileId: profile.id, originalJoinedOn: joinedOn },
        });
        await this.audit(tx, {
          personId: person.id,
          offerId: offer.id,
          episodeId: episode.id,
          action: 'ACCOUNT_CREATED',
          actorUserId: actor.id,
          metadata: { employeeProfileId: profile.id },
        });
      } else {
        // Rejoining / existing staff: the SAME profile and user are re-enabled; nothing is recreated.
        const profile = await tx.employeeProfile.findUniqueOrThrow({
          where: { id: person.employeeProfileId! },
        });
        await tx.user.update({
          where: { id: profile.userId },
          data: { status: UserStatus.ACTIVE, passwordHash },
        });
        await tx.refreshToken.updateMany({
          where: { userId: profile.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const role = await tx.userRole.findFirst({
          where: {
            userId: profile.userId,
            role: Role.FIELD_EXECUTIVE,
            salonId: null,
          },
        });
        if (!role)
          await tx.userRole.create({
            data: {
              userId: profile.userId,
              role: Role.FIELD_EXECUTIVE,
              salonId: null,
            },
          });
        if (input.territory?.trim())
          await tx.employeeProfile.update({
            where: { id: profile.id },
            data: { territory: input.territory.trim() },
          });
        if (!person.originalJoinedOn)
          await tx.hrPerson.update({
            where: { id: person.id },
            data: { originalJoinedOn: joinedOn },
          });
        await this.audit(tx, {
          personId: person.id,
          offerId: offer.id,
          episodeId: episode.id,
          action: 'ACCOUNT_REACTIVATED',
          actorUserId: actor.id,
          metadata: { employeeProfileId: profile.id, sessionsRevoked: true },
        });
      }

      await tx.hrEmploymentEpisode.update({
        where: { id: episode.id },
        data: { status: 'ACTIVE', joinedOn },
      });
      await tx.hrSalaryEntry.create({
        data: {
          personId: person.id,
          episodeId: episode.id,
          offerId: offer.id,
          effectiveFrom: joinedOn,
          baseSalaryInr: offer.baseSalaryInr,
          salaryBasis: offer.salaryBasis,
          recordedById: actor.id,
        },
      });
      if (offer.reportingManagerProfileId) {
        await tx.hrManagerEntry.updateMany({
          where: { personId: person.id, toDate: null },
          data: { toDate: joinedOn },
        });
        await tx.hrManagerEntry.create({
          data: {
            personId: person.id,
            episodeId: episode.id,
            offerId: offer.id,
            managerProfileId: offer.reportingManagerProfileId,
            fromDate: joinedOn,
            recordedById: actor.id,
          },
        });
      }
      await this.audit(tx, {
        personId: person.id,
        offerId: offer.id,
        episodeId: episode.id,
        action: rejoin || episode.episodeNumber > 1 ? 'REJOINED' : 'JOINED',
        subjectKind: 'EPISODE',
        subjectLabel: `Episode ${episode.episodeNumber}`,
        fromStatus: 'PENDING_JOIN',
        toStatus: 'ACTIVE',
        actorUserId: actor.id,
        metadata: { joinedOn: input.joinedOn },
      });
      return person.id;
    }, TX_OPTIONS);
    return this.detail(personId);
  }

  async recordNotJoined(
    actor: Actor,
    offerId: string,
    input: HrNotJoinedInput,
  ): Promise<HrPersonDetail> {
    this.assertNotFuture(input.decidedOn, 'The date');
    const personId = await this.prisma.$transaction(async (tx) => {
      const { offer, superseded } = await this.offerForUpdate(tx, offerId);
      const episode = await tx.hrEmploymentEpisode.findUniqueOrThrow({
        where: { id: offer.episodeId },
      });
      if (
        superseded ||
        episode.status !== 'PENDING_JOIN' ||
        offer.status === 'DECLINED' ||
        offer.status === 'DRAFT'
      ) {
        throw new AppException(
          'HR_OFFER_INVALID_TRANSITION',
          'Only a candidate still awaiting joining on a live offer can be recorded as not joined.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.hrEmploymentEpisode.update({
        where: { id: episode.id },
        data: {
          status: 'NOT_JOINED',
          notJoinedOn: toDateOnly(input.decidedOn),
          statusReason: input.reason,
        },
      });
      await this.audit(tx, {
        personId: offer.personId,
        offerId: offer.id,
        episodeId: episode.id,
        action: 'NOT_JOINED',
        subjectKind: 'EPISODE',
        subjectLabel: `Episode ${episode.episodeNumber}`,
        fromStatus: 'PENDING_JOIN',
        toStatus: 'NOT_JOINED',
        reason: input.reason,
        actorUserId: actor.id,
      });
      return offer.personId;
    }, TX_OPTIONS);
    return this.detail(personId);
  }

  async recordExit(
    actor: Actor,
    episodeId: string,
    input: HrExitInput,
  ): Promise<HrPersonDetail> {
    this.assertNotFuture(input.exitedOn, 'The last working day');
    const personId = await this.prisma.$transaction(async (tx) => {
      const found = await tx.hrEmploymentEpisode.findUnique({
        where: { id: episodeId },
        select: { personId: true },
      });
      if (!found)
        throw new AppException(
          'HR_EPISODE_NOT_FOUND',
          'No such employment episode.',
          HttpStatus.NOT_FOUND,
        );
      await this.lockPerson(tx, found.personId);
      const episode = await tx.hrEmploymentEpisode.findUniqueOrThrow({
        where: { id: episodeId },
      });
      if (episode.status !== 'ACTIVE') {
        throw new AppException(
          'HR_OFFER_INVALID_TRANSITION',
          'Only an employee who is currently employed can be recorded as exited.',
          HttpStatus.CONFLICT,
        );
      }
      if (
        episode.joinedOn &&
        input.exitedOn < fromDateOnly(episode.joinedOn)!
      ) {
        throw new AppException(
          'HR_EXIT_BEFORE_JOIN',
          'The last working day cannot be before the joining date.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const exitedOn = toDateOnly(input.exitedOn);
      const person = await tx.hrPerson.findUniqueOrThrow({
        where: { id: episode.personId },
        include: { employeeProfile: { select: { userId: true } } },
      });
      await tx.hrEmploymentEpisode.update({
        where: { id: episode.id },
        data: { status: 'EXITED', exitedOn, statusReason: input.reason },
      });
      if (person.employeeProfile) {
        // Access ends with the exit: login suspended and every refresh session revoked, atomically with the record.
        await tx.user.update({
          where: { id: person.employeeProfile.userId },
          data: { status: UserStatus.SUSPENDED },
        });
        await tx.refreshToken.updateMany({
          where: { userId: person.employeeProfile.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.hrManagerEntry.updateMany({
        where: { personId: person.id, toDate: null },
        data: { toDate: exitedOn },
      });
      await this.audit(tx, {
        personId: person.id,
        episodeId: episode.id,
        action: 'EXITED',
        subjectKind: 'EPISODE',
        subjectLabel: `Episode ${episode.episodeNumber}`,
        fromStatus: 'ACTIVE',
        toStatus: 'EXITED',
        reason: input.reason,
        actorUserId: actor.id,
        metadata: {
          accessSuspended: !!person.employeeProfile,
          sessionsRevoked: !!person.employeeProfile,
        },
      });
      return person.id;
    }, TX_OPTIONS);
    return this.detail(personId);
  }

  async updateContact(
    actor: Actor,
    personId: string,
    input: HrContactUpdateInput,
  ): Promise<HrPersonDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockPerson(tx, personId);
      const person = await tx.hrPerson.findUniqueOrThrow({
        where: { id: personId },
      });
      const data: Prisma.HrPersonUpdateInput = {};
      const changed: string[] = [];
      if (input.email !== undefined) {
        const email = input.email ? normalizeEmail(input.email) : null;
        data.emailHash = email ? this.privacy.blindIndex(email) : null;
        data.emailEnc = email ? this.privacy.encrypt(email) : null;
        data.maskedEmail = email ? maskEmail(email) : null;
        changed.push('email');
      }
      if (input.phone !== undefined) {
        const phone = input.phone ? normalizePhone(input.phone) : null;
        data.phoneHash = phone ? this.privacy.blindIndex(phone) : null;
        data.phoneEnc = input.phone ? this.privacy.encrypt(input.phone) : null;
        data.maskedPhone = input.phone ? maskPhone(input.phone) : null;
        changed.push('phone');
      }
      if (input.address !== undefined) {
        data.addressEnc = input.address
          ? this.privacy.encrypt(input.address)
          : null;
        changed.push('address');
      }
      if (input.city !== undefined) {
        data.city = input.city;
        changed.push('city');
      }
      await tx.hrPerson.update({ where: { id: person.id }, data });
      // Old letters keep the contact-at-issue snapshot; only the current contact moves. The values are never logged.
      await this.audit(tx, {
        personId: person.id,
        action: 'CONTACT_UPDATED',
        actorUserId: actor.id,
        reason: input.reason,
        metadata: { changed },
      });
    }, TX_OPTIONS);
    return this.detail(personId);
  }

  // ---------------------------------------------------------------------------------------------
  // bridge for the legacy direct-account paths (AdminEmployeeManagementService)
  // ---------------------------------------------------------------------------------------------

  /** Lock + next standard number, in the caller's transaction. */
  async allocateStandard(tx: Tx): Promise<{ number: number; code: string }> {
    await this.allocator.lock(tx);
    return this.allocator.nextStandard(tx);
  }

  /** Lock + a reserved (1-100) number that is free in both tables, in the caller's transaction. */
  async reserveSpecific(
    tx: Tx,
    value: number,
  ): Promise<{ number: number; code: string }> {
    await this.allocator.lock(tx);
    return this.allocator.assertReservedFree(tx, value);
  }

  /**
   * Creates the register person, the single employee profile and the ACTIVE episode for an account that is
   * provisioned directly (no offer). Every ID therefore lives in the register from the moment it exists.
   */
  async createDirectAccountProfile(
    tx: Tx,
    input: {
      adminUserId: string;
      userId: string;
      number: number;
      code: string;
      fullName: string;
      territory: string | null;
      reserved: boolean;
    },
  ): Promise<{ id: string }> {
    const today = toDateOnly(todayInIndia());
    const person = await tx.hrPerson.create({
      data: {
        employeeCode: input.code,
        codeNumber: input.number,
        fullName: input.fullName,
        nameKey: nameKey(input.fullName),
        nameFirstKey: nameFirstKey(input.fullName),
        city: input.territory,
        origin: 'DIRECT_ACCOUNT',
        createdById: input.adminUserId,
        originalJoinedOn: today,
      },
    });
    await tx.$executeRaw`SELECT set_config('app.hr_joining_person', ${person.id}, true)`;
    const profile = await tx.employeeProfile.create({
      data: {
        userId: input.userId,
        employeeCode: input.code,
        fullName: input.fullName,
        territory: input.territory,
      },
    });
    await tx.hrPerson.update({
      where: { id: person.id },
      data: { employeeProfileId: profile.id },
    });
    const episode = await tx.hrEmploymentEpisode.create({
      data: {
        personId: person.id,
        episodeNumber: 1,
        status: 'ACTIVE',
        joinedOn: today,
      },
    });
    await this.audit(tx, {
      personId: person.id,
      episodeId: episode.id,
      action: input.reserved
        ? 'RESERVED_ACCOUNT_CREATED'
        : 'DIRECT_ACCOUNT_CREATED',
      subjectKind: 'EPISODE',
      subjectLabel: 'Episode 1',
      toStatus: 'ACTIVE',
      actorUserId: input.adminUserId,
      metadata: { employeeCode: input.code, reserved: input.reserved },
    });
    return profile;
  }
}
