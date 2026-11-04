import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import {
  ASSISTANT_LIMITS,
  ASSISTANT_PATHS,
  assistantConfirmationSchema,
  assistantTurnSchema,
  type AssistantAccessDto,
  type AssistantConfirmationInput,
  type AssistantTurnInput,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AssistantService } from './assistant.service';
import { ASSISTANT_ROLLOUT, AssistantRollout } from './assistant-rollout';

const ASSISTANT_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * FastQue Action Assistant (issue #362). Signed-in users only (global JwtAuthGuard); which actions a
 * caller may run is decided per action, per shop, inside AssistantService — never by the client.
 *
 * Release gate: every route except `access` answers 404 unless the rollout enables the assistant for
 * this user (see AssistantRollout; OFF by default).
 */
@Controller(ASSISTANT_PATHS.assistant)
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    @Inject(ASSISTANT_ROLLOUT) private readonly rollout: AssistantRollout,
  ) {}

  private gate(user: AuthenticatedUser) {
    if (!this.rollout.enabledFor(user)) throw new NotFoundException();
  }

  @Get(ASSISTANT_PATHS.access)
  @Header('Cache-Control', 'private, no-store')
  access(@CurrentUser() user: AuthenticatedUser): AssistantAccessDto {
    return {
      enabled: this.rollout.enabledFor(user),
      writes: this.rollout.writesFor(user),
    };
  }

  @Get(ASSISTANT_PATHS.capabilities)
  @Header('Cache-Control', 'private, no-store')
  capabilities(@CurrentUser() user: AuthenticatedUser) {
    this.gate(user);
    return this.assistant.capabilities(user);
  }

  @Post(ASSISTANT_PATHS.turns)
  @HttpCode(200)
  @Throttle(ASSISTANT_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  turn(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(assistantTurnSchema)) body: AssistantTurnInput,
  ) {
    this.gate(user);
    return this.assistant.turn(user, body);
  }

  @Post(ASSISTANT_PATHS.confirmations)
  @HttpCode(200)
  @Throttle(ASSISTANT_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(assistantConfirmationSchema))
    body: AssistantConfirmationInput,
  ) {
    this.gate(user);
    return this.assistant.confirm(user, body);
  }

  // Optional private speech-to-text (self-hosted Whisper). Refused with 503 unless configured.
  // Audio stays in memory for this one request and is never stored or logged.
  @Post(ASSISTANT_PATHS.transcriptions)
  @HttpCode(200)
  @Throttle(ASSISTANT_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: ASSISTANT_LIMITS.maxAudioBytes, files: 1 },
    }),
  )
  transcribe(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('lang') lang?: string,
  ) {
    this.gate(user);
    return this.assistant.transcribe(
      file?.buffer ?? Buffer.alloc(0),
      file?.mimetype ?? '',
      lang === 'en' ? 'en' : 'hi',
    );
  }
}
