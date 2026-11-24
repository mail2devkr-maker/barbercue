import { Injectable, Logger } from '@nestjs/common';
import type { CitySearchResultDto, PincodeLookupDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

interface PostOffice {
  Name?: string;
  District?: string;
  Block?: string;
  State?: string;
}
type Fetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

const CACHE_MAX = 2000;
const CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * India Post PIN lookup (public, keyless). Only the six digits leave the server. It is a typing aid:
 * any failure returns null and the form keeps working with manual entry. PINCODE_LOOKUP_ENABLED=false
 * turns it off.
 */
@Injectable()
export class PincodeService {
  private readonly log = new Logger(PincodeService.name);
  private readonly cache = new Map<
    string,
    { at: number; value: Omit<PincodeLookupDto, 'city'> | null }
  >();
  fetcher: Fetcher = (url, init) => fetch(url, init);

  constructor(private readonly prisma: PrismaService) {}

  async lookup(pin: string): Promise<PincodeLookupDto | null> {
    if (!/^[1-9]\d{5}$/.test(pin)) return null;
    if (process.env.PINCODE_LOOKUP_ENABLED === 'false') return null;
    const base = await this.postOffices(pin);
    if (!base) return null;
    return { ...base, city: await this.match(base) };
  }

  private async postOffices(pin: string) {
    const hit = this.cache.get(pin);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    let offices: PostOffice[];
    try {
      const res = await this.fetcher(
        `https://api.postalpincode.in/pincode/${pin}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{
        PostOffice?: PostOffice[] | null;
      }>;
      offices = data?.[0]?.PostOffice ?? [];
    } catch (err) {
      this.log.warn(
        `PIN lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return null;
    }
    const first = offices.find((o) => o.District && o.State);
    const value = first
      ? {
          pin,
          district: String(first.District),
          state: String(first.State),
          areas: [
            ...new Set(
              offices.map((o) => o.Name).filter((n): n is string => !!n),
            ),
          ].slice(0, 20),
        }
      : null;
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(pin, { at: Date.now(), value });
    return value;
  }

  /** A FastQue city whose name is the PIN's district (or one of its areas), in the same state. */
  private async match(p: {
    district: string;
    state: string;
    areas: string[];
  }): Promise<CitySearchResultDto | null> {
    const alias: Record<string, string[]> = {
      'gautam buddha nagar': ['Noida', 'Greater Noida'],
      gurgaon: ['Gurugram', 'Gurgaon'],
      'bengaluru urban': ['Bengaluru', 'Bangalore'],
      bangalore: ['Bengaluru', 'Bangalore'],
      allahabad: ['Prayagraj', 'Allahabad'],
    };
    const names = [
      ...p.areas.filter((a) => a.length > 3),
      p.district,
      ...(alias[p.district.toLowerCase()] ?? []),
    ];
    const rows = await this.prisma.city.findMany({
      where: {
        countryCode: 'IN',
        OR: names.map((name) => ({
          name: { equals: name, mode: 'insensitive' as const },
        })),
      },
      include: { regionRef: true },
      take: 30,
    });
    const state = p.state.toLowerCase();
    const inState = rows.filter((r) =>
      [r.state, r.regionRef?.name].some((s) => s?.toLowerCase() === state),
    );
    const pick =
      inState.find((r) => r.name.toLowerCase() === p.district.toLowerCase()) ??
      inState.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
    if (!pick) return null;
    return {
      id: pick.id,
      name: pick.name,
      slug: pick.slug,
      countryCode: pick.countryCode,
      region: pick.regionRef
        ? {
            id: pick.regionRef.id,
            name: pick.regionRef.name,
            code: pick.regionRef.code,
          }
        : null,
    };
  }
}
