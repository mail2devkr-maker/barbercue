import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import {
  DASHBOARD_PATHS,
  Role,
  ownerCustomerListQuerySchema,
  ownerCustomerHistoryQuerySchema,
  ownerCustomerDirectoryQuerySchema,
  ownerCustomerServicesQuerySchema,
  type AuthenticatedUser,
  type OwnerCustomerListQuery,
  type OwnerCustomerHistoryQuery,
  type OwnerCustomerDirectoryQuery,
  type OwnerCustomerServicesQuery,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DashboardCustomersService } from './dashboard-customers.service';
import { CustomerDirectoryQueryService } from './customer-directory-query.service';

// Owner-only for ordinary staff, same reasoning as DashboardBookingsController: customer contact
// details and visit history are not given to ordinary staff by default.
// SalonAccessService.assertOwnerOrAdminAccess inside the service re-checks this specific user
// operates *this* salonId. PLATFORM_ADMIN is additionally allowed at the route level (Part 2
// delegated shop management) — the ledger mutations below already write an AuditLog row for every
// actor unconditionally (real actorUserId, whoever that is), so no extra admin-only branch is
// needed to keep the waive/restore actions attributable.
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class DashboardCustomersController {
  constructor(
    private readonly customers: DashboardCustomersService,
    private readonly customerDirectory: CustomerDirectoryQueryService,
  ) {}

  @Get(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/${DASHBOARD_PATHS.customerDirectory}`,
  )
  @Header('Cache-Control', 'private, no-store')
  directory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query(new ZodValidationPipe(ownerCustomerDirectoryQuerySchema))
    query: OwnerCustomerDirectoryQuery,
  ) {
    return this.customerDirectory.directory(user.id, salonId, query);
  }

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}`)
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query(new ZodValidationPipe(ownerCustomerListQuerySchema))
    query: OwnerCustomerListQuery,
  ) {
    return this.customers.list(
      user.id,
      salonId,
      String(query.offset),
      String(query.limit),
      query.q ?? query.search,
    );
  }

  @Get(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId`,
  )
  @Header('Cache-Control', 'private, no-store')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.getOne(user.id, salonId, customerId);
  }

  @Get(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId/${DASHBOARD_PATHS.customerHistory}`,
  )
  @Header('Cache-Control', 'private, no-store')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
    @Query(new ZodValidationPipe(ownerCustomerHistoryQuerySchema))
    query: OwnerCustomerHistoryQuery,
  ) {
    return this.customers.history(user.id, salonId, customerId, query);
  }

  @Get(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId/${DASHBOARD_PATHS.customerServices}`,
  )
  @Header('Cache-Control', 'private, no-store')
  services(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
    @Query(new ZodValidationPipe(ownerCustomerServicesQuerySchema))
    query: OwnerCustomerServicesQuery,
  ) {
    return this.customerDirectory.services(user.id, salonId, customerId, query);
  }

  // Customer Dues + Cancellation Policy mission — reversible New Customer No-Show Grace waiver.
  @Post(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId/${DASHBOARD_PATHS.ledger}/:ledgerEntryId/${DASHBOARD_PATHS.waive}`,
  )
  waiveNoShowDue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
    @Param('ledgerEntryId') ledgerEntryId: string,
  ) {
    return this.customers.waiveNoShowDue(
      user.id,
      salonId,
      customerId,
      ledgerEntryId,
    );
  }

  @Post(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId/${DASHBOARD_PATHS.ledger}/:ledgerEntryId/${DASHBOARD_PATHS.restore}`,
  )
  restoreNoShowDue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
    @Param('ledgerEntryId') ledgerEntryId: string,
  ) {
    return this.customers.restoreNoShowDue(
      user.id,
      salonId,
      customerId,
      ledgerEntryId,
    );
  }
}
