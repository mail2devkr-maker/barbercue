import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PushDeviceService } from './push-device.service';
import {
  registerPushDeviceSchema,
  unregisterPushDeviceSchema,
  type RegisterPushDeviceInput,
  type UnregisterPushDeviceInput,
} from './push-notifications.schemas';

// No @Roles() restriction, same reasoning as NotificationsController: any authenticated user
// (today, in practice, an owner or staff member on Codex's mobile app) can register a device for
// their own account. Scoping is entirely by userId from @CurrentUser().
@Controller('push-devices')
export class PushNotificationsController {
  constructor(private readonly pushDevices: PushDeviceService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerPushDeviceSchema))
    body: RegisterPushDeviceInput,
  ) {
    await this.pushDevices.register(user.id, body.expoPushToken, body.platform);
    return { ok: true };
  }

  @Post('unregister')
  @HttpCode(HttpStatus.OK)
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(unregisterPushDeviceSchema))
    body: UnregisterPushDeviceInput,
  ) {
    await this.pushDevices.unregister(user.id, body.expoPushToken);
    return { ok: true };
  }
}
