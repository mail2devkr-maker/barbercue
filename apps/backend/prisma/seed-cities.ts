/**
 * Dedicated city master-data seeder — separate from prisma/seed.ts (which seeds only the
 * bengaluru demo/fixture dataset for local dev). This script populates the approved initial
 * India city footprint (see project city-master-data proposal) and is safe to re-run: it never
 * touches an existing (countryCode, slug) row, so the already-live "bengaluru" city is never
 * recreated or modified.
 *
 * Run with: npm run db:seed:cities --workspace=@barbercue/backend
 * Requires DATABASE_URL in .env. Does not touch users, salons, or any other table.
 *
 * Idempotent by design: find-then-create on the (countryCode, slug) composite key — the same
 * pattern seed.ts already uses for bengaluru — never upsert-by-slug, since slug alone is no
 * longer globally unique (see City.@@unique([countryCode, slug])).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CitySeed {
  name: string;
  slug: string;
  countryCode: string;
  regionCode: string;
  state: string;
  country: string;
}

// Approved 21-city India footprint minus Bengaluru (already exists — untouched by this script).
// Region codes are ISO 3166-2:IN. Two of these (IN-TG for Telangana, IN-OR for Odisha) were
// double-checked against a source conflict — see the implementation report for details — and
// confirmed via two independent sources plus the approved proposal itself.
const CITIES: CitySeed[] = [
  { name: 'Mumbai', slug: 'mumbai', countryCode: 'IN', regionCode: 'IN-MH', state: 'Maharashtra', country: 'India' },
  { name: 'Delhi', slug: 'delhi', countryCode: 'IN', regionCode: 'IN-DL', state: 'Delhi', country: 'India' },
  { name: 'Hyderabad', slug: 'hyderabad', countryCode: 'IN', regionCode: 'IN-TG', state: 'Telangana', country: 'India' },
  { name: 'Chennai', slug: 'chennai', countryCode: 'IN', regionCode: 'IN-TN', state: 'Tamil Nadu', country: 'India' },
  { name: 'Pune', slug: 'pune', countryCode: 'IN', regionCode: 'IN-MH', state: 'Maharashtra', country: 'India' },
  { name: 'Ahmedabad', slug: 'ahmedabad', countryCode: 'IN', regionCode: 'IN-GJ', state: 'Gujarat', country: 'India' },
  { name: 'Kolkata', slug: 'kolkata', countryCode: 'IN', regionCode: 'IN-WB', state: 'West Bengal', country: 'India' },
  { name: 'Gurugram', slug: 'gurugram', countryCode: 'IN', regionCode: 'IN-HR', state: 'Haryana', country: 'India' },
  { name: 'Chandigarh', slug: 'chandigarh', countryCode: 'IN', regionCode: 'IN-CH', state: 'Chandigarh', country: 'India' },
  { name: 'Kochi', slug: 'kochi', countryCode: 'IN', regionCode: 'IN-KL', state: 'Kerala', country: 'India' },
  { name: 'Jaipur', slug: 'jaipur', countryCode: 'IN', regionCode: 'IN-RJ', state: 'Rajasthan', country: 'India' },
  { name: 'Noida', slug: 'noida', countryCode: 'IN', regionCode: 'IN-UP', state: 'Uttar Pradesh', country: 'India' },
  { name: 'Coimbatore', slug: 'coimbatore', countryCode: 'IN', regionCode: 'IN-TN', state: 'Tamil Nadu', country: 'India' },
  { name: 'Indore', slug: 'indore', countryCode: 'IN', regionCode: 'IN-MP', state: 'Madhya Pradesh', country: 'India' },
  { name: 'Lucknow', slug: 'lucknow', countryCode: 'IN', regionCode: 'IN-UP', state: 'Uttar Pradesh', country: 'India' },
  { name: 'Surat', slug: 'surat', countryCode: 'IN', regionCode: 'IN-GJ', state: 'Gujarat', country: 'India' },
  { name: 'Visakhapatnam', slug: 'visakhapatnam', countryCode: 'IN', regionCode: 'IN-AP', state: 'Andhra Pradesh', country: 'India' },
  { name: 'Nagpur', slug: 'nagpur', countryCode: 'IN', regionCode: 'IN-MH', state: 'Maharashtra', country: 'India' },
  { name: 'Bhubaneswar', slug: 'bhubaneswar', countryCode: 'IN', regionCode: 'IN-OR', state: 'Odisha', country: 'India' },
  { name: 'Guwahati', slug: 'guwahati', countryCode: 'IN', regionCode: 'IN-AS', state: 'Assam', country: 'India' },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const city of CITIES) {
    const existing = await prisma.city.findFirst({
      where: { countryCode: city.countryCode, slug: city.slug },
    });

    if (existing) {
      skipped++;
      console.log(`skip  ${city.countryCode}/${city.slug} (already exists, id=${existing.id})`);
      continue;
    }

    const row = await prisma.city.create({ data: city });
    created++;
    console.log(`create ${city.countryCode}/${city.slug} (id=${row.id})`);
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped} (of ${CITIES.length} total rows).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
