import { Module } from '@nestjs/common';
import { OffersController, PublicOffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  controllers: [OffersController, PublicOffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
