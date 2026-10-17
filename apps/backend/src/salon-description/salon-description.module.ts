import { Module } from '@nestjs/common';
import { DESCRIPTION_SUGGESTION_PROVIDER } from './description-suggestion-provider';
import { SalonDescriptionController } from './salon-description.controller';
import { SalonDescriptionService } from './salon-description.service';
import { UnconfiguredDescriptionSuggestionProvider } from './unconfigured-description-suggestion-provider';

@Module({
  controllers: [SalonDescriptionController],
  providers: [
    SalonDescriptionService,
    UnconfiguredDescriptionSuggestionProvider,
    // Replacing the provider requires a separately reviewed implementation and owner activation.
    {
      provide: DESCRIPTION_SUGGESTION_PROVIDER,
      useExisting: UnconfiguredDescriptionSuggestionProvider,
    },
  ],
})
export class SalonDescriptionModule {}
