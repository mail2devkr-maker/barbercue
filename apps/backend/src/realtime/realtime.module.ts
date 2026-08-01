import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    // Read-only verification usage (jwtService.verify at handshake) — no signing here, so no
    // signOptions needed. Same secret as AuthModule's own registration.
    JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
