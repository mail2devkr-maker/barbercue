import { Global, Module } from '@nestjs/common';
import { ProfessionalCommitmentsService } from './professional-commitments.service';

/** @Global so the salon reservation authority and the Work marketplace can consult it without importing HomeModule. */
@Global()
@Module({
  providers: [ProfessionalCommitmentsService],
  exports: [ProfessionalCommitmentsService],
})
export class ProfessionalCommitmentsModule {}
