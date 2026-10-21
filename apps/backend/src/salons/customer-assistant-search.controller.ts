import { Body, Controller, Header, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CUSTOMER_ASSISTANT_PATHS,
  CUSTOMER_ASSISTANT_SEARCH_LIMITS,
  customerAssistantSearchSchema,
  type CustomerAssistantSearchInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CustomerAssistantSearchService } from './customer-assistant-search.service';

@Controller(CUSTOMER_ASSISTANT_PATHS.assistant)
export class CustomerAssistantSearchController {
  constructor(private readonly searchService: CustomerAssistantSearchService) {}

  @Public()
  @Post(CUSTOMER_ASSISTANT_PATHS.search)
  @Throttle({
    default: {
      limit: CUSTOMER_ASSISTANT_SEARCH_LIMITS.maxRequests,
      ttl: CUSTOMER_ASSISTANT_SEARCH_LIMITS.throttleWindowMs,
    },
  })
  @Header('Cache-Control', 'no-store')
  search(
    @Body(new ZodValidationPipe(customerAssistantSearchSchema))
    body: CustomerAssistantSearchInput,
  ) {
    return this.searchService.search(body);
  }
}
