import { Module } from '@nestjs/common';
import {
  EmployeeSalonChangeRequestsController,
  OwnerSalonChangeRequestsController,
} from './salon-change-requests.controller';
import { SalonChangeRequestsService } from './salon-change-requests.service';

@Module({
  controllers: [
    EmployeeSalonChangeRequestsController,
    OwnerSalonChangeRequestsController,
  ],
  providers: [SalonChangeRequestsService],
})
export class SalonChangeRequestsModule {}
