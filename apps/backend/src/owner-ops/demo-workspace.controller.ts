import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  Role,
  deleteDemoWorkspaceSchema,
  demoWorkspaceIdempotencyKeySchema,
  type AuthenticatedUser,
  type DeleteDemoWorkspaceInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DemoWorkspaceService } from './demo-workspace.service';

/**
 * Demo is a private owner dashboard preview, not a synthetic operating shop. Every record is
 * returned from one isolated payload table and no demo item is written to a live business table.
 */
@Controller('dashboard/salons/:salonId/demo')
@Roles(Role.SALON_OWNER)
export class DemoWorkspaceController {
  constructor(private readonly workspaces: DemoWorkspaceService) {}

  @Get('status')
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.workspaces.getStatus(user.id, salonId);
  }

  @Post('import')
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    const parsedKey =
      demoWorkspaceIdempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsedKey.success) {
      throw new AppException(
        'VALIDATION_ERROR',
        'A UUID Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.workspaces.import(user.id, salonId, parsedKey.data);
  }

  @Post('delete-preview')
  deletePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.workspaces.createDeletePreview(user.id, salonId);
  }

  @Get('workspaces/:workspaceId')
  getWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.getWorkspace(user.id, salonId, workspaceId);
  }

  @Delete()
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(deleteDemoWorkspaceSchema))
    body: DeleteDemoWorkspaceInput,
  ) {
    return this.workspaces.delete(
      user.id,
      salonId,
      body.workspaceId,
      body.confirmation,
      body.confirmationToken,
    );
  }
}
