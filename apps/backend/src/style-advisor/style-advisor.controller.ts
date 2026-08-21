import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import {
  Role,
  STYLE_ADVISOR_PATHS,
  type AuthenticatedUser,
  type StyleAdvisorResultDto,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StyleAdvisorService } from './style-advisor.service';

// Stricter than AUTH_THROTTLE (5/60s) — this is the most abuse-prone/costly endpoint in the app
// once a real (paid, per-call) AiImageProvider is wired; keep the limit tight even while the
// provider is unconfigured, so this doesn't need revisiting later.
const STYLE_ADVISOR_THROTTLE = { default: { limit: 3, ttl: 600_000 } };

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller(STYLE_ADVISOR_PATHS.styleAdvisor)
@Roles(Role.CUSTOMER)
export class StyleAdvisorController {
  constructor(private readonly styleAdvisorService: StyleAdvisorService) {}

  @Post(STYLE_ADVISOR_PATHS.generate)
  @Throttle(STYLE_ADVISOR_THROTTLE)
  @UseInterceptors(
    FileInterceptor('image', {
      // Memory only, never disk — see StyleAdvisorService's doc comment. This is the only place
      // multer's storage engine is configured, so there is structurally no path that ever writes
      // an uploaded selfie to disk.
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StyleAdvisorResultDto> {
    const results = await this.styleAdvisorService.generate(user.id, file);
    return { results };
  }
}
