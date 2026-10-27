import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { QueueEntryStatus, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Customer -> shop calling (not the owner's private/login number).
 * Only a customer holding this active token can retrieve the salon's explicitly public
 * business telephone number. Do not use client-supplied salonId or return the owner account.
 */
@Controller('queue-entries')
@Roles(Role.CUSTOMER)
export class QueueContactController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/shop-contact')
  async getShopContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') entryId: string,
  ): Promise<{ shopPhone: string | null }> {
    const entry = await this.prisma.queueEntry.findFirst({
      where: {
        id: entryId,
        customerId: user.id,
        status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED, QueueEntryStatus.IN_SERVICE] },
      },
      select: { salon: { select: { phone: true, showPhoneToCustomers: true } } },
    });
    if (!entry) throw new NotFoundException('Live Queue token not found.');
    const candidate = entry.salon.showPhoneToCustomers ? entry.salon.phone : null;
    const dialable = candidate?.replace(/[\s().-]/g, '') ?? '';
    return {
      shopPhone: /^\+?[0-9]{7,15}$/.test(dialable) ? dialable : null,
    };
  }
}
