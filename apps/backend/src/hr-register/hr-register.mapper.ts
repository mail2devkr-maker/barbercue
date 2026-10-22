import type { Prisma } from '@prisma/client';
import type {
  HrActorRef,
  HrEmploymentEpisode,
  HrManagerHistoryEntry,
  HrManagerRef,
  HrOfferVersion,
  HrPersonDetail,
  HrPersonSummary,
  HrSalaryHistoryEntry,
} from '@barbercue/shared';
import { fromDateOnly } from './hr-register.util';

export const personInclude = {
  employeeProfile: { select: { id: true, userId: true } },
  episodes: { orderBy: { episodeNumber: 'asc' } },
  offers: {
    orderBy: { version: 'asc' },
    include: {
      pdfEvents: { orderBy: { createdAt: 'asc' } },
      reportingManager: {
        select: { id: true, fullName: true, employeeCode: true },
      },
    },
  },
  salaryHistory: {
    orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    include: { offer: { select: { version: true } } },
  },
  managerHistory: {
    orderBy: [{ fromDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      manager: { select: { id: true, fullName: true, employeeCode: true } },
      offer: { select: { version: true } },
    },
  },
} satisfies Prisma.HrPersonInclude;

export type PersonRecord = Prisma.HrPersonGetPayload<{
  include: typeof personInclude;
}>;
type OfferRecord = PersonRecord['offers'][number];

export type ActorLookup = (id: string | null | undefined) => HrActorRef;

const iso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;
const basisOut = (value: 'MONTHLY' | 'ANNUAL'): 'monthly' | 'annual' =>
  value === 'MONTHLY' ? 'monthly' : 'annual';

export function actorIdsOf(person: PersonRecord): string[] {
  const ids = new Set<string>();
  for (const offer of person.offers) {
    if (offer.createdById) ids.add(offer.createdById);
    for (const event of offer.pdfEvents)
      if (event.actorId) ids.add(event.actorId);
  }
  for (const entry of person.salaryHistory)
    if (entry.recordedById) ids.add(entry.recordedById);
  for (const entry of person.managerHistory)
    if (entry.recordedById) ids.add(entry.recordedById);
  return [...ids];
}

function managerRef(
  manager: { id: string; fullName: string; employeeCode: string } | null,
): HrManagerRef | null {
  return manager
    ? {
        id: manager.id,
        fullName: manager.fullName,
        employeeCode: manager.employeeCode,
      }
    : null;
}

export function mapOffer(
  offer: OfferRecord,
  all: OfferRecord[],
  actor: ActorLookup,
): HrOfferVersion {
  const later = all
    .filter((candidate) => candidate.version > offer.version)
    .sort((a, b) => a.version - b.version)[0];
  return {
    id: offer.id,
    personId: offer.personId,
    version: offer.version,
    kind: offer.kind,
    source: offer.source,
    status: offer.status,
    issuedAt: offer.issuedAt.toISOString(),
    sentAt: iso(offer.sentAt),
    acceptedAt: iso(offer.acceptedAt),
    declinedAt: iso(offer.declinedAt),
    expiredAt: iso(offer.expiredAt),
    createdBy: actor(offer.createdById),
    terms: {
      role: offer.role,
      baseSalaryInr: Number(offer.baseSalaryInr),
      salaryBasis: basisOut(offer.salaryBasis),
      salesTarget: offer.salesTarget,
      incentiveBeyondTargetInr: offer.incentiveBeyondTargetInr,
      proposedJoiningDate: fromDateOnly(offer.proposedJoiningDate),
      reportingManager: managerRef(offer.reportingManager),
      city: offer.city,
      expectedPerformanceIncentiveMonthlyInr:
        offer.expectedPerformanceIncentiveMonthlyInr,
    },
    delivery: {
      saved: true,
      pdfCount: offer.pdfEvents.length,
      emailedRecordedAt: iso(offer.sentAt),
      acceptanceProven: offer.acceptedAt !== null,
    },
    pdfHistory: offer.pdfEvents.map((event) => ({
      id: event.id,
      event: event.event,
      at: event.createdAt.toISOString(),
      actor: actor(event.actorId),
      sha256: event.sha256,
      byteLength: event.byteLength,
    })),
    supersededByVersion: later ? later.version : null,
    employmentEpisodeId: offer.episodeId,
    statusReason: offer.statusReason,
  };
}

export function mapEpisode(
  episode: PersonRecord['episodes'][number],
): HrEmploymentEpisode {
  return {
    id: episode.id,
    episodeNumber: episode.episodeNumber,
    status: episode.status,
    originatingOfferVersion: episode.originatingOfferVersion,
    joinedOn: fromDateOnly(episode.joinedOn),
    exitedOn: fromDateOnly(episode.exitedOn),
    notJoinedOn: fromDateOnly(episode.notJoinedOn),
    statusReason: episode.statusReason,
  };
}

export function mapSummary(person: PersonRecord): HrPersonSummary {
  const latestOffer =
    person.offers.length > 0 ? person.offers[person.offers.length - 1] : null;
  const firstOffer = person.offers.length > 0 ? person.offers[0] : null;
  const episode =
    person.episodes.length > 0
      ? person.episodes[person.episodes.length - 1]
      : null;
  const openManager = [...person.managerHistory]
    .reverse()
    .find((entry) => entry.toDate === null);
  return {
    id: person.id,
    employeeCode: person.employeeCode,
    fullName: person.fullName,
    maskedEmail: person.maskedEmail,
    maskedPhone: person.maskedPhone,
    city: person.city,
    reportingManager: managerRef(
      openManager
        ? openManager.manager
        : (latestOffer?.reportingManager ?? null),
    ),
    firstOfferIssuedAt: firstOffer ? firstOffer.issuedAt.toISOString() : null,
    latestOfferVersion: latestOffer ? latestOffer.version : null,
    latestOfferStatus: latestOffer ? latestOffer.status : null,
    latestOfferIssuedAt: latestOffer
      ? latestOffer.issuedAt.toISOString()
      : null,
    offerCount: person.offers.length,
    currentEpisode: episode
      ? {
          id: episode.id,
          episodeNumber: episode.episodeNumber,
          status: episode.status,
          joinedOn: fromDateOnly(episode.joinedOn),
          exitedOn: fromDateOnly(episode.exitedOn),
        }
      : null,
    episodeCount: person.episodes.length,
    hasEmployeeAccount: person.employeeProfileId !== null,
    employeeProfileId: person.employeeProfileId,
    origin: person.origin,
    originalJoinedOn: fromDateOnly(person.originalJoinedOn),
  };
}

export function mapDetail(
  person: PersonRecord,
  actor: ActorLookup,
): HrPersonDetail {
  const salary: HrSalaryHistoryEntry[] = person.salaryHistory.map((entry) => ({
    id: entry.id,
    effectiveFrom: fromDateOnly(entry.effectiveFrom) ?? '',
    baseSalaryInr: Number(entry.baseSalaryInr),
    salaryBasis: basisOut(entry.salaryBasis),
    offerVersion: entry.offer ? entry.offer.version : null,
    recordedAt: entry.createdAt.toISOString(),
    recordedBy: actor(entry.recordedById),
  }));
  const manager: HrManagerHistoryEntry[] = person.managerHistory.map(
    (entry) => ({
      id: entry.id,
      manager: {
        id: entry.manager.id,
        fullName: entry.manager.fullName,
        employeeCode: entry.manager.employeeCode,
      },
      from: fromDateOnly(entry.fromDate) ?? '',
      to: fromDateOnly(entry.toDate),
      offerVersion: entry.offer ? entry.offer.version : null,
      recordedAt: entry.createdAt.toISOString(),
      recordedBy: actor(entry.recordedById),
    }),
  );
  return {
    ...mapSummary(person),
    offers: person.offers.map((offer) => mapOffer(offer, person.offers, actor)),
    episodes: person.episodes.map(mapEpisode),
    salaryHistory: salary,
    managerHistory: manager,
  };
}
