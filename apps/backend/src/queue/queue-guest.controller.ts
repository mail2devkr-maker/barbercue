import { BadRequestException, Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  joinQueueSchema, type JoinQueueInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { QueueService } from './queue.service';
import { PrismaService } from '../prisma/prisma.service';

const GUEST_MUTATION_LIMIT = { default: { limit: 3, ttl: 60_000 } };
const GUEST_READ_LIMIT = { default: { limit: 30, ttl: 60_000 } };
// Guest customers provide name, mobile number and service. No account creation,
// trust elevation to an existing account or bogus phone verification occurs.
export const guestJoinSchema = joinQueueSchema.required();

@Public()
@Controller()
export class QueueGuestController {
  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('salons/:salonId/queue/guest-join')
  @Throttle(GUEST_MUTATION_LIMIT)
  join(
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(guestJoinSchema)) body: Required<JoinQueueInput>,
  ) {
    return this.queueService.joinGuestWalkIn(
      salonId, body.serviceId, body.contactName, body.contactPhone,
    );
  }

  @Get('queue-entries/:id/guest-status')
  @Throttle(GUEST_READ_LIMIT)
  getStatus(
    @Param('id') id: string,
    @Headers('x-queue-guest-token') guestToken: string,
  ) {
    return this.queueService.getGuestEntry(id, guestToken ?? '');
  }

  @Post('queue-entries/:id/guest-cancel')
  @Throttle(GUEST_MUTATION_LIMIT)
  cancel(
    @Param('id') id: string,
    @Headers('x-queue-guest-token') guestToken: string,
  ) {
    return this.queueService.cancelGuestEntry(id, guestToken ?? '');
  }

  @Post('queue-entries/:id/guest-arrival-response')
  @Throttle(GUEST_MUTATION_LIMIT)
  respondArrival(
    @Param('id') id: string,
    @Headers('x-queue-guest-token') guestToken: string,
    @Body() body: { arrived?: unknown },
  ) {
    if (typeof body?.arrived !== 'boolean') {
      throw new BadRequestException('Arrival response must be true or false.');
    }
    return this.queueService.respondArrival(id, body.arrived, { guestAccessToken: guestToken });
  }

  @Post('queue-entries/:id/guest-device')
  @Throttle(GUEST_MUTATION_LIMIT)
  registerGuestDevice(
    @Param('id') id: string,
    @Headers('x-queue-guest-token') guestToken: string,
    @Body() body: { expoPushToken?: unknown },
  ) {
    if (typeof body?.expoPushToken !== 'string') {
      throw new BadRequestException('Expo push token is required.');
    }
    return this.queueService.registerGuestPush(id, guestToken ?? '', body.expoPushToken);
  }

  @Get('queue-entries/:id/guest-shop-contact')
  @Throttle(GUEST_READ_LIMIT)
  async getShopContact(
    @Param('id') id: string,
    @Headers('x-queue-guest-token') guestToken: string,
  ): Promise<{ shopPhone: string | null }> {
    const ticket = await this.queueService.getGuestEntry(id, guestToken ?? '');
    const shop = await this.prisma.salon.findUnique({
      where: { id: ticket.salonId },
      select: { phone: true, showPhoneToCustomers: true },
    });
    const raw = shop?.showPhoneToCustomers ? shop.phone : null;
    const dialable = raw?.replace(/[\s().-]/g, '') ?? '';
    return { shopPhone: /^\+?[0-9]{7,15}$/.test(dialable) ? dialable : null };
  }
}
