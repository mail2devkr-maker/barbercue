import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

// Deliberately conservative. We only reject obvious automated agents; a normal privacy-focused
// browser still counts. This is not identity verification and must never be presented as one.
const BOT_USER_AGENT =
  /bot|crawler|spider|crawling|headlesschrome|lighthouse|google-inspectiontool|facebookexternalhit|slurp|bingpreview|uptimerobot|monitor/i;

@Injectable()
export class SiteMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordUniqueVisitor(visitorId: string, userAgent?: string): Promise<boolean> {
    if (!userAgent || BOT_USER_AGENT.test(userAgent)) return false;

    const visitorKey = createHash('sha256').update(visitorId).digest('hex');
    const result = await this.prisma.siteVisitor.createMany({
      data: [{ visitorKey }],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
}
