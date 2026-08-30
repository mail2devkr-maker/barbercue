import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import {
  SEARCH_PATHS,
  searchSuggestQuerySchema,
  type SearchSuggestQueryInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SearchService } from './search.service';

// Public, unauthenticated, discovery-facing (Issue 3) -- same trust level as CitiesController's
// own search endpoint, which this deliberately mirrors.
@Controller(SEARCH_PATHS.search)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Get(SEARCH_PATHS.suggest)
  @UsePipes(new ZodValidationPipe(searchSuggestQuerySchema))
  suggest(@Query() query: SearchSuggestQueryInput) {
    return this.searchService.suggest(query);
  }
}
