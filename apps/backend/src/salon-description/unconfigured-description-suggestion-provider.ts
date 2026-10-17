import { HttpStatus, Injectable } from '@nestjs/common';
import { SalonDescriptionErrorCode } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { DescriptionSuggestionProvider } from './description-suggestion-provider';

/** Safe default: no key or environment variable can activate an external provider. */
@Injectable()
export class UnconfiguredDescriptionSuggestionProvider implements DescriptionSuggestionProvider {
  async suggest(): Promise<string> {
    throw new AppException(
      SalonDescriptionErrorCode.PROVIDER_NOT_CONFIGURED,
      'Description suggestions are unavailable until an approved provider is configured.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
