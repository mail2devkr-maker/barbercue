import { randomUUID } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type HomeProvider } from '@prisma/client';
import {
  HOME_TERMS_VERSION,
  HomeErrorCode,
  type HomeAreaInput,
  type HomeFreelancerRegisterInput,
  type HomeOfferingInput,
  type HomeProfessionalInput,
  type HomeProviderSettingsInput,
  type HomeVerificationScope,
} from '@barbercue/shared';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectImageMimeType } from '../storage/image-signature';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service';
import { homeFlag } from './home-config';
import {
  HomeCoreService,
  TX,
  addMin,
  minutesBetween,
} from './home-core.service';
import {
  homeError,
  homeForbidden,
  homeInvalid,
  homeNotFound,
  homeState,
  isOverlapViolation,
} from './home-errors';

const MAX_FILE = 5 * 1024 * 1024;
const full = {
  areas: { orderBy: { createdAt: 'asc' as const } },
  offerings: {
    include: {
      serviceDef: { include: { category: true } },
      productRules: true,
      professionals: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  professionals: {
    include: {
      services: true,
      schedules: true,
      verifications: true,
      salonStaff: { select: { status: true, accessRevokedAt: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  salon: {
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      lat: true,
      lng: true,
      postalCode: true,
      addressLine: true,
      city: { select: { name: true } },
    },
  },
} satisfies Prisma.HomeProviderInclude;
export type FullProvider = Prisma.HomeProviderGetPayload<{
  include: typeof full;
}>;

/** Salon and independent providers: profile, offers, areas, people, verification, schedules. */
@Injectable()
export class HomeProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: HomeCoreService,
    private readonly salonAccess: SalonAccessService,
    private readonly files: PrivateObjectStorageService,
  ) {}

  // ---------- Salon ----------

  async salonProvider(
    userId: string,
    salonId: string,
  ): Promise<HomeProvider | null> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    return this.prisma.homeProvider.findUnique({ where: { salonId } });
  }

  async requireSalonProvider(
    userId: string,
    salonId: string,
  ): Promise<HomeProvider> {
    const p = await this.salonProvider(userId, salonId);
    if (!p) throw homeState('Enable home services for this salon first.');
    return p;
  }

  async enableSalon(userId: string, salonId: string) {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    if (!homeFlag('SALON_HOME_SERVICES_ENABLED'))
      throw homeError(
        HomeErrorCode.DISABLED,
        'Salon home services are not available yet.',
        HttpStatus.NOT_FOUND,
      );
    const salon = await this.prisma.salon.findUniqueOrThrow({
      where: { id: salonId },
      include: { city: true, locality: true },
    });
    const p = await this.prisma.homeProvider.upsert({
      where: { salonId },
      create: {
        kind: 'SALON_MANAGED',
        salonId,
        displayName: salon.name.slice(0, 120),
        city: salon.city.name.slice(0, 80),
        locality: salon.locality?.name ?? salon.localityText ?? null,
      },
      update: {},
    });
    await this.core.audit(this.prisma, {
      actorUserId: userId,
      actorParty: 'PROVIDER',
      action: 'SALON_HOME_ENABLED',
      entityType: 'PROVIDER',
      entityId: p.id,
    });
    return this.dashboard(p.id);
  }

  async ownerServices(userId: string, salonId: string) {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const [services, staff, products] = await Promise.all([
      this.prisma.service.findMany({
        where: { salonId, isActive: true },
        select: { id: true, name: true, price: true, durationMinutes: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.salonStaff.findMany({
        where: { salonId, accessRevokedAt: null },
        select: {
          id: true,
          displayName: true,
          status: true,
          photoUrl: true,
          homeProfessional: {
            select: { id: true, consentAt: true, active: true },
          },
        },
      }),
      this.prisma.inventoryProduct.findMany({
        where: { salonId, isActive: true },
        select: { id: true, name: true, unit: true, stockOnHand: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
    ]);
    return {
      services: services.map((s) => ({ ...s, price: s.price.toString() })),
      staff,
      products: products.map((p) => ({
        ...p,
        stockOnHand: p.stockOnHand.toString(),
      })),
    };
  }

  /** Invites staff into the home channel. They stay unlisted until THEY consent from their own account. */
  async addStaff(userId: string, salonId: string, staffId: string) {
    const p = await this.requireSalonProvider(userId, salonId);
    const staff = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId, accessRevokedAt: null },
    });
    if (!staff) throw homeNotFound('Staff member not found.');
    const pro = await this.prisma.homeProfessional.upsert({
      where: { providerId_userId: { providerId: p.id, userId: staff.userId } },
      create: {
        providerId: p.id,
        userId: staff.userId,
        salonStaffId: staff.id,
        displayName: staff.displayName,
        photoUrl: staff.photoUrl,
        bio: staff.bio,
        yearsExperience: staff.yearsExperience,
      },
      update: { active: true, salonStaffId: staff.id },
    });
    await this.core.notify(
      staff.userId,
      'home.professional.update',
      `${pro.id}:consent`,
      'Home visits invitation',
      `${p.displayName} would like you to do home visits. You decide – accept or ignore.`,
      '/home-pro?tab=settings',
    );
    return this.dashboard(p.id);
  }

  // ---------- Independent ----------

  async myIndependent(userId: string) {
    return this.prisma.homeProvider.findUnique({ where: { userId } });
  }

  /** Pre-fills from the person's existing FastQue profiles (Work profile, salon roster) - never a second account. */
  async prefill(userId: string) {
    const [worker, staff, user] = await Promise.all([
      this.prisma.workerProfile.findUnique({ where: { userId } }),
      this.prisma.salonStaff.findFirst({
        where: { userId, accessRevokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { phone: true, email: true, phoneVerifiedAt: true },
      }),
    ]);
    return {
      displayName: worker?.fullName ?? staff?.displayName ?? null,
      city: worker?.city ?? null,
      locality: worker?.locality ?? null,
      languages: worker?.languages ?? [],
      skills: worker?.skills ?? [],
      bio: worker?.bio ?? staff?.bio ?? null,
      yearsExperience: staff?.yearsExperience ?? null,
      phone: user.phone,
      email: user.email,
      phoneVerified: !!user.phoneVerifiedAt,
      reusedFrom: [
        worker ? 'FastQue Work profile' : null,
        staff ? 'Salon staff profile' : null,
      ].filter(Boolean),
    };
  }

  async registerIndependent(
    userId: string,
    input: HomeFreelancerRegisterInput,
    assistedBy?: string,
  ) {
    if (!homeFlag('FREELANCER_HOME_SERVICES_ENABLED'))
      throw homeError(
        HomeErrorCode.DISABLED,
        'Independent registration is not available yet.',
        HttpStatus.NOT_FOUND,
      );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!user.phoneVerifiedAt && !user.phone)
      throw homeInvalid(
        'Add and verify your mobile number in your account first.',
      );
    const worker = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { dateOfBirth: true },
    });
    if (
      worker &&
      worker.dateOfBirth >
        new Date(new Date().setFullYear(new Date().getFullYear() - 18))
    )
      throw homeForbidden('Independent professionals must be 18 or older.');
    const {
      adult: _a,
      channelConsent: _c,
      skills,
      yearsExperience,
      compensation: _x,
      ...settings
    } = input;
    const now = new Date();
    const id = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.homeProvider.findUnique({ where: { userId } });
      const data = { ...settings, adultDeclaredAt: now };
      const p = existing
        ? await tx.homeProvider.update({ where: { id: existing.id }, data })
        : await tx.homeProvider.create({
            data: {
              ...data,
              kind: 'INDEPENDENT_PROFESSIONAL',
              userId,
              assistedByUserId: assistedBy ?? null,
            },
          });
      const pro = await tx.homeProfessional.upsert({
        where: { providerId_userId: { providerId: p.id, userId } },
        create: {
          providerId: p.id,
          userId,
          displayName: settings.displayName,
          bio: settings.bio ?? null,
          skills,
          languages: settings.languages ?? [],
          yearsExperience: yearsExperience ?? null,
          consentAt: now,
        },
        update: {
          displayName: settings.displayName,
          skills,
          yearsExperience: yearsExperience ?? undefined,
          consentAt: now,
        },
      });
      if (user.phoneVerifiedAt)
        await tx.homeVerification.upsert({
          where: {
            professionalId_scope_subject: {
              professionalId: pro.id,
              scope: 'MOBILE',
              subject: '',
            },
          },
          create: {
            professionalId: pro.id,
            scope: 'MOBILE',
            subject: '',
            status: 'VERIFIED',
            verifiedAt: user.phoneVerifiedAt,
            reviewNote: 'Verified by FastQue sign-in code',
          },
          update: {},
        });
      await this.core.audit(tx, {
        actorUserId: userId,
        actorParty: 'PROFESSIONAL',
        action: 'INDEPENDENT_REGISTERED',
        entityType: 'PROVIDER',
        entityId: p.id,
        metadata: { assistedBy: assistedBy ?? null },
      });
      return p.id;
    }, TX);
    return this.dashboard(id);
  }

  // ---------- Shared provider operations (caller has proved ownership) ----------

  async loadFull(id: string): Promise<FullProvider> {
    return this.prisma.homeProvider.findUniqueOrThrow({
      where: { id },
      include: full,
    });
  }

  async dashboard(id: string) {
    const p = await this.loadFull(id);
    return {
      ...p,
      salon: p.salon ? { id: p.salon.id, name: p.salon.name } : null,
      checklist: this.checklist(p),
    };
  }

  checklist(p: FullProvider) {
    const listed = p.professionals.filter((x) => x.active && x.consentAt);
    const hasSchedule =
      p.kind === 'SALON_MANAGED' || listed.some((x) => x.schedules.length > 0);
    const items = [
      {
        id: 'terms',
        done: !!p.termsAcceptedAt && !!p.publicConsentAt,
        label: 'Accept provider terms',
      },
      {
        id: 'services',
        done: p.offerings.some((o) => o.active),
        label: 'Add at least one home service and price',
      },
      {
        id: 'professionals',
        done: listed.some((x) => x.services.length > 0),
        label:
          p.kind === 'SALON_MANAGED'
            ? 'A consenting staff member assigned to a service'
            : 'Assign your services to yourself',
      },
      {
        id: 'areas',
        done: p.areas.some((a) => !a.excluded),
        label: 'Choose where you serve',
      },
      {
        id: 'base',
        done:
          p.kind === 'SALON_MANAGED'
            ? p.salon?.lat != null
            : p.baseLat != null || p.areas.some((a) => a.kind !== 'RADIUS'),
        label: 'Base location or named areas',
      },
      { id: 'hours', done: hasSchedule, label: 'Working hours' },
    ];
    return { items, ready: items.every((i) => i.done) };
  }

  async updateSettings(
    p: HomeProvider,
    userId: string,
    input: HomeProviderSettingsInput,
  ) {
    const { compensation, ...rest } = input;
    if (p.kind === 'INDEPENDENT_PROFESSIONAL')
      for (const k of [
        'minStaffInSalon',
        'maxHomeStaff',
        'queueWaitingLimit',
        'manualApproval',
      ] as const)
        delete rest[k];
    await this.prisma.$transaction(async (tx) => {
      await tx.homeProvider.update({
        where: { id: p.id },
        data: {
          ...rest,
          ...(compensation ? { compensation: compensation } : {}),
        },
      });
      await this.core.audit(tx, {
        actorUserId: userId,
        actorParty: 'PROVIDER',
        action: 'SETTINGS',
        entityType: 'PROVIDER',
        entityId: p.id,
        metadata: { fields: Object.keys(input) },
      });
    });
    return this.dashboard(p.id);
  }

  async acceptTerms(p: HomeProvider, userId: string, adult?: boolean) {
    const now = new Date();
    await this.prisma.homeProvider.update({
      where: { id: p.id },
      data: {
        termsVersion: HOME_TERMS_VERSION,
        termsAcceptedAt: now,
        publicConsentAt: now,
        ...(adult ? { adultDeclaredAt: now } : {}),
      },
    });
    await this.core.audit(this.prisma, {
      actorUserId: userId,
      actorParty: 'PROVIDER',
      action: 'TERMS_ACCEPTED',
      entityType: 'PROVIDER',
      entityId: p.id,
      metadata: { version: HOME_TERMS_VERSION },
    });
    return this.dashboard(p.id);
  }

  async submit(p: HomeProvider, userId: string) {
    const f = await this.loadFull(p.id);
    const c = this.checklist(f);
    if (!c.ready)
      throw homeInvalid('Finish the checklist first.', {
        missing: c.items.filter((i) => !i.done).map((i) => i.label),
      });
    if (!['DRAFT', 'REJECTED'].includes(p.status))
      throw homeState('This profile has already been submitted.');
    await this.prisma.homeProvider.update({
      where: { id: p.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await this.core.audit(this.prisma, {
      actorUserId: userId,
      actorParty: 'PROVIDER',
      action: 'SUBMITTED',
      entityType: 'PROVIDER',
      entityId: p.id,
    });
    return this.dashboard(p.id);
  }

  async saveOffering(
    p: HomeProvider,
    userId: string,
    input: HomeOfferingInput,
  ) {
    const def = await this.prisma.homeServiceDef.findUnique({
      where: { code: input.serviceCode },
      include: { category: true },
    });
    if (!def || def.status !== 'ACTIVE' || !def.category.active)
      throw homeInvalid('That service is not available for home visits.');
    const prices = [
      input.pricePaise,
      ...input.variants.map((v) => v.pricePaise),
    ];
    if (def.minPricePaise != null && prices.some((x) => x < def.minPricePaise!))
      throw homeInvalid(
        'That price is below the minimum FastQue allows for this service.',
      );
    if (def.maxPricePaise != null && prices.some((x) => x > def.maxPricePaise!))
      throw homeInvalid(
        'That price is above the maximum FastQue allows for this service.',
      );
    if (input.salonServiceId) {
      const s = p.salonId
        ? await this.prisma.service.findFirst({
            where: { id: input.salonServiceId, salonId: p.salonId },
            select: { id: true },
          })
        : null;
      if (!s) throw homeInvalid('That salon service was not found.');
    }
    if (input.products.length) {
      const ok = p.salonId
        ? await this.prisma.inventoryProduct.count({
            where: {
              salonId: p.salonId,
              id: { in: input.products.map((x) => x.productId) },
            },
          })
        : 0;
      if (ok !== new Set(input.products.map((x) => x.productId)).size)
        throw homeInvalid('Choose products from your own inventory.');
    }
    const data = {
      salonServiceId: input.salonServiceId ?? null,
      title: input.title || null,
      pricePaise: input.pricePaise,
      productPaise: input.productPaise,
      disposablePaise: input.disposablePaise,
      equipmentPaise: input.equipmentPaise,
      durationMinutes: input.durationMinutes,
      variants: input.variants as unknown as Prisma.InputJsonValue,
      active: input.active,
    };
    // Only home tables are written here: the in-salon Service row and its price are never touched.
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.homeOffering.findUnique({
        where: {
          providerId_serviceDefId: { providerId: p.id, serviceDefId: def.id },
        },
      });
      const o = await tx.homeOffering.upsert({
        where: {
          providerId_serviceDefId: { providerId: p.id, serviceDefId: def.id },
        },
        create: { providerId: p.id, serviceDefId: def.id, ...data },
        update: data,
      });
      await tx.homeOfferingProduct.deleteMany({ where: { offeringId: o.id } });
      if (input.products.length)
        await tx.homeOfferingProduct.createMany({
          data: input.products.map((x) => ({
            offeringId: o.id,
            productId: x.productId,
            quantity: x.quantity,
          })),
        });
      if (p.kind === 'INDEPENDENT_PROFESSIONAL' && !before) {
        const me = await tx.homeProfessional.findFirst({
          where: { providerId: p.id },
        });
        if (me)
          await tx.homeProfessionalService.create({
            data: { professionalId: me.id, offeringId: o.id },
          });
      }
      await this.core.audit(tx, {
        actorUserId: userId,
        actorParty: 'PROVIDER',
        action: 'OFFER_SAVED',
        entityType: 'OFFERING',
        entityId: o.id,
        metadata: {
          fromPaise: before?.pricePaise ?? null,
          toPaise: o.pricePaise,
          active: o.active,
        },
      });
    }, TX);
    return this.dashboard(p.id);
  }

  async saveAreas(p: HomeProvider, userId: string, areas: HomeAreaInput[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.homeServiceArea.deleteMany({ where: { providerId: p.id } });
      const seen = new Set<string>();
      const rows = areas.filter((a) => {
        const k = `${a.kind}:${a.value.toLowerCase()}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
      await tx.homeServiceArea.createMany({
        data: rows.map((a) => ({
          ...a,
          radiusKm: a.radiusKm ?? null,
          providerId: p.id,
        })),
      });
      await this.core.audit(tx, {
        actorUserId: userId,
        actorParty: 'PROVIDER',
        action: 'AREAS',
        entityType: 'PROVIDER',
        entityId: p.id,
        metadata: { count: rows.length },
      });
    }, TX);
    return this.dashboard(p.id);
  }

  /** `self` = the professional's own account. Only they can touch consent, availability and their public profile. */
  async updateProfessional(
    p: HomeProvider,
    professionalId: string,
    input: HomeProfessionalInput,
    self: boolean,
  ) {
    const pro = await this.prisma.homeProfessional.findFirst({
      where: { id: professionalId, providerId: p.id },
    });
    if (!pro) throw homeNotFound('Professional not found.');
    const { serviceCodes, schedule, dedicated, active, ...profile } = input;
    const ownerOnly = p.kind === 'INDEPENDENT_PROFESSIONAL' || !self;
    await this.prisma.$transaction(async (tx) => {
      await tx.homeProfessional.update({
        where: { id: pro.id },
        data: {
          ...profile,
          portfolioUrls: profile.portfolioUrls,
          ...(ownerOnly && dedicated !== undefined ? { dedicated } : {}),
          ...(ownerOnly && active !== undefined ? { active } : {}),
        },
      });
      if (serviceCodes && ownerOnly) {
        const offers = await tx.homeOffering.findMany({
          where: {
            providerId: p.id,
            serviceDef: { code: { in: serviceCodes } },
          },
          select: { id: true },
        });
        await tx.homeProfessionalService.deleteMany({
          where: { professionalId: pro.id },
        });
        await tx.homeProfessionalService.createMany({
          data: offers.map((o) => ({
            professionalId: pro.id,
            offeringId: o.id,
          })),
        });
      }
      if (schedule) {
        await tx.homeSchedule.deleteMany({ where: { professionalId: pro.id } });
        await tx.homeSchedule.createMany({
          data: schedule.map((s) => ({ ...s, professionalId: pro.id })),
        });
      }
    }, TX);
    return this.dashboard(p.id);
  }

  // ---------- The professional's own controls ----------

  async myProfiles(userId: string) {
    const rows = await this.prisma.homeProfessional.findMany({
      where: { userId },
      include: {
        provider: {
          select: {
            id: true,
            kind: true,
            displayName: true,
            status: true,
            instantEnabled: true,
            scheduledEnabled: true,
            salonId: true,
          },
        },
        services: {
          include: {
            offering: {
              include: {
                serviceDef: {
                  select: { code: true, name: true, nameHi: true },
                },
              },
            },
          },
        },
        schedules: true,
        verifications: true,
      },
    });
    return rows;
  }

  async myProfile(userId: string, professionalId: string) {
    const row = await this.prisma.homeProfessional.findFirst({
      where: { id: professionalId, userId },
      include: { provider: true },
    });
    if (!row) throw homeNotFound('Profile not found.');
    return row;
  }

  /** Explicit consent per channel; withdrawing hides the profile but never drops accepted visits. */
  async setConsent(userId: string, professionalId: string, consent: boolean) {
    const row = await this.myProfile(userId, professionalId);
    await this.prisma.homeProfessional.update({
      where: { id: row.id },
      data: consent
        ? { consentAt: new Date() }
        : { consentAt: null, isOnline: false },
    });
    await this.core.audit(this.prisma, {
      actorUserId: userId,
      actorParty: 'PROFESSIONAL',
      action: consent ? 'CONSENT_GIVEN' : 'CONSENT_WITHDRAWN',
      entityType: 'PROFESSIONAL',
      entityId: row.id,
    });
    return { consent };
  }

  async setOnline(userId: string, professionalId: string, online: boolean) {
    const row = await this.myProfile(userId, professionalId);
    if (
      online &&
      (!row.consentAt ||
        row.provider.status !== 'APPROVED' ||
        row.suspendedAt ||
        !row.active)
    )
      throw homeState(
        'You can go online after your profile is approved and you have given consent.',
      );
    await this.prisma.homeProfessional.update({
      where: { id: row.id },
      data: { isOnline: online, onlineSince: online ? new Date() : null },
    });
    const upcoming = await this.prisma.homeAssignment.count({
      where: { professionalId: row.id, status: 'ACTIVE' },
    });
    return { online, upcoming };
  }

  async addTimeOff(
    userId: string,
    input: {
      kind: 'BREAK' | 'TIME_OFF';
      startAt: string;
      endAt: string;
      note?: string;
    },
  ) {
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (endAt <= startAt || minutesBetween(startAt, endAt) > 60 * 24 * 60)
      throw homeInvalid('Choose a valid period.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        await tx.professionalCommitment.updateMany({
          where: {
            userId,
            kind: 'HOME_HOLD',
            releasedAt: null,
            expiresAt: { lte: now },
          },
          data: { releasedAt: now },
        });
        return tx.professionalCommitment.create({
          data: {
            userId,
            kind: input.kind,
            startAt,
            endAt,
            note: input.note || null,
          },
        });
      });
    } catch (err) {
      if (isOverlapViolation(err))
        throw homeState(
          'You already have something in that period. Reschedule or cancel that booking first.',
        );
      throw err;
    }
  }

  async removeTimeOff(userId: string, id: string) {
    const done = await this.prisma.professionalCommitment.updateMany({
      where: {
        id,
        userId,
        kind: { in: ['BREAK', 'TIME_OFF'] },
        releasedAt: null,
      },
      data: { releasedAt: new Date() },
    });
    if (done.count === 0) throw homeNotFound();
    return { ok: true };
  }

  async calendar(userId: string, from: Date, to: Date) {
    const rows = await this.prisma.professionalCommitment.findMany({
      where: {
        userId,
        releasedAt: null,
        startAt: { lt: to },
        endAt: { gt: from },
        kind: { not: 'HOME_HOLD' },
      },
      orderBy: { startAt: 'asc' },
      include: { booking: { select: { code: true, status: true } } },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      startAt: r.startAt,
      endAt: r.endAt,
      serviceStart: r.serviceStart,
      serviceEnd: r.serviceEnd,
      note: r.note,
      booking: r.booking,
    }));
  }

  // ---------- Verification ----------

  async submitVerification(
    userId: string,
    professionalId: string,
    input: {
      scope: HomeVerificationScope;
      subject: string;
      evidenceNote?: string;
    },
    file?: { buffer: Buffer },
  ) {
    const pro = await this.myProfile(userId, professionalId);
    if (input.scope === 'MOBILE')
      throw homeInvalid(
        'Mobile numbers are verified by signing in with a code.',
      );
    let evidenceKey: string | null = null;
    let evidenceType: string | null = null;
    if (file) {
      if (file.buffer.length > MAX_FILE)
        throw homeInvalid('Files must be smaller than 5 MB.');
      const pdf = file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
      evidenceType = pdf ? 'application/pdf' : detectImageMimeType(file.buffer);
      if (!evidenceType)
        throw homeInvalid('Upload a JPG, PNG, WebP or PDF file.');
      evidenceKey = `home-verification/${pro.id}/${randomUUID()}`;
      await this.files.put(evidenceKey, file.buffer, evidenceType);
    }
    const key = {
      professionalId: pro.id,
      scope: input.scope,
      subject: input.subject,
    };
    const prev = await this.prisma.homeVerification.findUnique({
      where: { professionalId_scope_subject: key },
    });
    if (
      prev?.status === 'VERIFIED' &&
      (!prev.expiresAt || prev.expiresAt > new Date())
    )
      throw homeState('This check is already complete.');
    const row = await this.prisma.homeVerification.upsert({
      where: { professionalId_scope_subject: key },
      create: {
        ...key,
        evidenceNote: input.evidenceNote ?? null,
        evidenceKey,
        evidenceType,
      },
      update: {
        status: 'PENDING',
        evidenceNote: input.evidenceNote ?? null,
        ...(evidenceKey ? { evidenceKey, evidenceType } : {}),
        submittedAt: new Date(),
        reviewNote: null,
        verifiedAt: null,
        verifiedByUserId: null,
      },
    });
    await this.core.audit(this.prisma, {
      actorUserId: userId,
      actorParty: 'PROFESSIONAL',
      action: 'VERIFICATION_SUBMITTED',
      entityType: 'VERIFICATION',
      entityId: row.id,
      metadata: { scope: input.scope, subject: input.subject },
    });
    return { id: row.id, status: row.status };
  }

  async reviewVerification(
    adminId: string,
    id: string,
    input: {
      status:
        'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'SUSPENDED';
      note: string;
      expiresAt?: string;
    },
  ) {
    const v = await this.prisma.homeVerification.findUnique({
      where: { id },
      include: { professional: { select: { userId: true } } },
    });
    if (!v) throw homeNotFound();
    if (v.professional.userId === adminId)
      throw homeForbidden('You cannot review your own verification.');
    await this.prisma.$transaction(async (tx) => {
      await tx.homeVerification.update({
        where: { id },
        data: {
          status: input.status,
          reviewNote: input.note,
          verifiedByUserId: adminId,
          verifiedAt: input.status === 'VERIFIED' ? new Date() : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: `VERIFICATION_${input.status}`,
        entityType: 'VERIFICATION',
        entityId: id,
        note: input.note,
        metadata: { scope: v.scope, subject: v.subject, from: v.status },
      });
    });
    await this.core.notify(
      v.professional.userId,
      'home.professional.update',
      `${id}:${input.status}:${Date.now()}`,
      'Verification update',
      `Your ${v.scope.toLowerCase().replace(/_/g, ' ')} check is now ${input.status.toLowerCase().replace(/_/g, ' ')}.`,
      '/home-pro?tab=settings',
    );
    return { ok: true };
  }

  async evidence(id: string, viewer: { userId: string; admin: boolean }) {
    const v = await this.prisma.homeVerification.findUnique({
      where: { id },
      include: { professional: { select: { userId: true } } },
    });
    if (
      !v ||
      !v.evidenceKey ||
      (!viewer.admin && v.professional.userId !== viewer.userId)
    )
      throw homeNotFound();
    const body = await this.files.get(v.evidenceKey);
    if (!body) throw homeNotFound();
    if (viewer.admin)
      await this.core.audit(this.prisma, {
        actorUserId: viewer.userId,
        actorParty: 'ADMIN',
        action: 'EVIDENCE_VIEWED',
        entityType: 'VERIFICATION',
        entityId: id,
      });
    return { body, type: v.evidenceType ?? 'application/octet-stream' };
  }

  // ---------- Earnings ----------

  async earnings(
    where: { providerId?: string; professionalIds?: string[] },
    from: Date,
    to: Date,
  ) {
    const rows = await this.prisma.homeEarning.findMany({
      where: {
        ...(where.providerId ? { providerId: where.providerId } : {}),
        ...(where.professionalIds
          ? { professionalId: { in: where.professionalIds } }
          : {}),
        createdAt: { gte: from, lt: to },
      },
      include: {
        booking: {
          select: {
            code: true,
            totalPaise: true,
            paymentStatus: true,
            completedAt: true,
            payments: {
              where: { voidedAt: null },
              select: { amountPaise: true, disputedAt: true },
            },
            refunds: { select: { amountPaise: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const people = await this.prisma.homeProfessional.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.professionalId))] } },
      select: { id: true, displayName: true },
    });
    const sum = (f: (r: (typeof rows)[number]) => number) =>
      rows.reduce((s, r) => s + f(r), 0);
    const received = (r: (typeof rows)[number]) =>
      r.booking.payments.reduce((s, p) => s + p.amountPaise, 0);
    const net = (r: (typeof rows)[number]) =>
      r.servicePaise + r.productPaise + r.travelPaise - r.discountPaise;
    return {
      visits: rows.length,
      servicePaise: sum((r) => r.servicePaise),
      productPaise: sum((r) => r.productPaise),
      travelPaise: sum((r) => r.travelPaise),
      discountPaise: sum((r) => r.discountPaise),
      tipPaise: sum((r) => r.tipPaise),
      platformFeePaise: sum((r) => r.platformFeePaise),
      staffPayoutPaise: sum((r) => r.staffPayoutPaise),
      productCostPaise: sum((r) => r.productCostPaise),
      totalPaise: sum(net),
      receivedPaise: sum(received),
      outstandingPaise: sum((r) =>
        Math.max(0, r.booking.totalPaise - received(r)),
      ),
      disputedPaise: sum((r) =>
        r.booking.payments
          .filter((p) => p.disputedAt)
          .reduce((s, p) => s + p.amountPaise, 0),
      ),
      adjustmentPaise: sum((r) =>
        r.booking.refunds.reduce((s, x) => s + x.amountPaise, 0),
      ),
      contributionPaise: sum(
        (r) =>
          net(r) - r.platformFeePaise - r.staffPayoutPaise - r.productCostPaise,
      ),
      byProfessional: people.map((p) => ({
        id: p.id,
        name: p.displayName,
        visits: rows.filter((r) => r.professionalId === p.id).length,
        totalPaise: rows
          .filter((r) => r.professionalId === p.id)
          .reduce((s, r) => s + net(r), 0),
        payoutPaise: rows
          .filter((r) => r.professionalId === p.id)
          .reduce((s, r) => s + r.staffPayoutPaise, 0),
      })),
      rows: rows.slice(0, 100).map((r) => ({
        code: r.booking.code,
        at: r.createdAt,
        totalPaise: net(r),
        tipPaise: r.tipPaise,
        receivedPaise: received(r),
        paymentStatus: r.booking.paymentStatus,
        platformFeePaise: r.platformFeePaise,
      })),
      note: 'Home-service records only. Nothing here is posted to salon payroll, staff compensation or FastQue expenses.',
    };
  }

  async overview(p: HomeProvider) {
    const now = new Date();
    const count = (status: Prisma.HomeBookingWhereInput) =>
      this.prisma.homeBooking.count({ where: { providerId: p.id, ...status } });
    const [incoming, upcoming, active, completed, cancelled, rating] =
      await Promise.all([
        count({
          status: {
            in: [
              'REQUESTED',
              'AWAITING_ASSIGNMENT',
              'INVITED',
              'NO_PROFESSIONAL',
              'REPLACEMENT_REQUESTED',
            ],
          },
        }),
        count({
          status: { in: ['CONFIRMED', 'PREPARING', 'RESCHEDULE_REQUESTED'] },
        }),
        count({
          status: {
            in: [
              'ON_THE_WAY',
              'ARRIVED',
              'CHECKED_IN',
              'IN_PROGRESS',
              'ADDRESS_ISSUE',
              'INTERRUPTED',
            ],
          },
        }),
        count({ completedAt: { gte: addMin(now, -30 * 1440) } }),
        count({ cancelledAt: { gte: addMin(now, -30 * 1440) } }),
        this.prisma.homeReview.aggregate({
          where: { providerId: p.id, status: 'PUBLISHED' },
          _avg: { overall: true },
          _count: { _all: true },
        }),
      ]);
    return {
      incoming,
      upcoming,
      active,
      completed30: completed,
      cancelled30: cancelled,
      rating: rating._avg.overall,
      reviews: rating._count._all,
    };
  }
}
