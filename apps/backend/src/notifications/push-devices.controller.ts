import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  NOTIFICATION_PATHS,
  registerPushDeviceSchema,
  unregisterPushDeviceSchema,
  type AuthenticatedUser,
  type RegisterPushDeviceInput,
  type UnregisterPushDeviceInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PushDevicesService } from './push-devices.service';

@Controller(`${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.devices}`)
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @Post()
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerPushDeviceSchema))
    body: RegisterPushDeviceInput,
  ) {
    return this.devices.register(user.id, body);
  }

  @Post(NOTIFICATION_PATHS.unregister)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(unregisterPushDeviceSchema))
    body: UnregisterPushDeviceInput,
  ): Promise<void> {
    await this.devices.unregister(user.id, body);
  }
}
