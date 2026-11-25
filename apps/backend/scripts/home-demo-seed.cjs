#!/usr/bin/env node
/*
 * LOCAL DEMO DATA for FastQue Home. Refuses any database that is not "home_demo" on this computer.
 * Everything is clearly named DEMO; nothing here is real, and no reviews, ratings or bookings are invented.
 *   DATABASE_URL=postgresql://.../home_demo node scripts/home-demo-seed.cjs
 * Accounts get NO password. Local sign-in is arranged by whoever runs the demo, outside this repository.
 */
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://x/x');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/home_demo' || process.env.NODE_ENV === 'production') {
  console.error('Refusing: DATABASE_URL must be home_demo on localhost.');
  process.exit(2);
}
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const now = new Date();
const all = [0, 1, 2, 3, 4, 5, 6];

async function user(name, n, role) {
  const email = `${name}@home-demo.test`;
  const u = await db.user.upsert({ where: { email }, update: {}, create: { email, phone: `+9190000004${n}`, phoneVerifiedAt: now, emailVerifiedAt: now } });
  if (!(await db.userRole.count({ where: { userId: u.id, role } }))) await db.userRole.create({ data: { userId: u.id, role } });
  return u;
}
async function offer(providerId, code, pricePaise, extra = {}) {
  const def = await db.homeServiceDef.findUniqueOrThrow({ where: { code } });
  return db.homeOffering.upsert({ where: { providerId_serviceDefId: { providerId, serviceDefId: def.id } }, update: {}, create: { providerId, serviceDefId: def.id, pricePaise, durationMinutes: def.durationMinutes, ...extra } });
}

(async () => {
  await user('admin', '01', 'PLATFORM_ADMIN');
  await user('viewer', '02', 'PLATFORM_VIEWER');
  await user('customer', '03', 'CUSTOMER');
  const owner = await user('owner', '04', 'SALON_OWNER');
  const ind = await user('independent', '05', 'CUSTOMER');
  const city = (await db.city.findFirst({ where: { slug: 'noida-home-demo' } })) ?? (await db.city.create({ data: { name: 'Noida', slug: 'noida-home-demo', countryCode: 'IN', state: 'Uttar Pradesh', country: 'India' } }));
  const salon = await db.salon.upsert({
    where: { cityId_slug: { cityId: city.id, slug: 'demo-royal-salon' } },
    update: {},
    create: { ownerUserId: owner.id, name: 'DEMO Royal Salon', slug: 'demo-royal-salon', cityId: city.id, addressLine: 'Demo address, Sector 18', localityText: 'Sector 18', postalCode: '201301', status: 'ACTIVE', timezone: 'Asia/Kolkata', lat: 28.5708, lng: 77.3261, phone: '+919000000404', shopPhotoRequirementGrandfathered: true },
  });
  if (!(await db.userRole.count({ where: { userId: owner.id, salonId: salon.id } }))) await db.userRole.create({ data: { userId: owner.id, role: 'SALON_OWNER', salonId: salon.id } });
  for (const d of all) await db.operatingHours.upsert({ where: { salonId_dayOfWeek: { salonId: salon.id, dayOfWeek: d } }, update: {}, create: { salonId: salon.id, dayOfWeek: d, openTime: '00:00', closeTime: '23:59' } });
  let service = await db.service.findFirst({ where: { salonId: salon.id, name: 'Haircut' } });
  if (!service) service = await db.service.create({ data: { salonId: salon.id, name: 'Haircut', durationMinutes: 30, price: 200 } });
  if (!(await db.chair.count({ where: { salonId: salon.id } }))) for (let i = 1; i <= 5; i += 1) await db.chair.create({ data: { salonId: salon.id, label: `Chair ${i}` } });
  const provider = await db.homeProvider.upsert({
    where: { salonId: salon.id },
    update: {},
    create: { kind: 'SALON_MANAGED', salonId: salon.id, displayName: salon.name, city: 'Noida', locality: 'Sector 18', status: 'APPROVED', instantEnabled: true, travelFeePaise: 4900, minStaffInSalon: 3, maxHomeStaff: 2, termsAcceptedAt: now, publicConsentAt: now, areas: { create: [{ kind: 'PINCODE', value: '201301' }, { kind: 'RADIUS', value: 'base', radiusKm: 8 }] } },
  });
  const cut = await offer(provider.id, 'mens-haircut', 29900, { salonServiceId: service.id });
  const beard = await offer(provider.id, 'beard-trim', 9900);
  const facial = await offer(provider.id, 'womens-facial', 89900, { productPaise: 15000 });
  for (let i = 1; i <= 5; i += 1) {
    const u = await user(`barber-${i}`, `1${i}`, 'SALON_STAFF');
    let s = await db.salonStaff.findFirst({ where: { salonId: salon.id, userId: u.id } });
    if (!s) s = await db.salonStaff.create({ data: { salonId: salon.id, userId: u.id, displayName: `Demo Barber ${i}`, roleInSalon: 'BARBER' } });
    if (!(await db.userRole.count({ where: { userId: u.id, salonId: salon.id } }))) await db.userRole.create({ data: { userId: u.id, role: 'SALON_STAFF', salonId: salon.id } });
    if (i > 3) continue;
    const pro = await db.homeProfessional.upsert({ where: { providerId_userId: { providerId: provider.id, userId: u.id } }, update: {}, create: { providerId: provider.id, userId: u.id, salonStaffId: s.id, displayName: s.displayName, yearsExperience: 2 + i, languages: ['Hindi', 'English'], consentAt: now, isOnline: i < 3 } });
    for (const o of [cut, beard, facial]) await db.homeProfessionalService.upsert({ where: { professionalId_offeringId: { professionalId: pro.id, offeringId: o.id } }, update: {}, create: { professionalId: pro.id, offeringId: o.id } });
  }
  const indProvider = await db.homeProvider.upsert({
    where: { userId: ind.id },
    update: {},
    create: { kind: 'INDEPENDENT_PROFESSIONAL', userId: ind.id, displayName: 'DEMO Asha', category: 'BARBER', city: 'Noida', locality: 'Sector 15', baseLat: 28.585, baseLng: 77.31, status: 'APPROVED', instantEnabled: true, upiVpa: 'demo@upi', termsAcceptedAt: now, publicConsentAt: now, adultDeclaredAt: now, areas: { create: [{ kind: 'PINCODE', value: '201301' }] } },
  });
  const pro = await db.homeProfessional.upsert({ where: { providerId_userId: { providerId: indProvider.id, userId: ind.id } }, update: {}, create: { providerId: indProvider.id, userId: ind.id, displayName: 'DEMO Asha', yearsExperience: 6, languages: ['Hindi'], consentAt: now, isOnline: true, schedules: { create: all.map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' })) }, verifications: { create: { scope: 'MOBILE', status: 'VERIFIED', verifiedAt: now, reviewNote: 'Demo' } } } });
  const own = await offer(indProvider.id, 'mens-haircut', 24900);
  await db.homeProfessionalService.upsert({ where: { professionalId_offeringId: { professionalId: pro.id, offeringId: own.id } }, update: {}, create: { professionalId: pro.id, offeringId: own.id } });
  console.log(`Demo ready. PIN 201301. Owner tab: /dashboard/salons/${salon.id}/home-services`);
  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
