import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { UserStatus, type AuthenticatedUser } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/services/token.service';

/**
 * API.md's `/realtime` namespace. JWT verified at handshake (`client.handshake.auth.token`),
 * mirroring JwtStrategy's own re-check of the user's live status rather than trusting the token's
 * claims for the whole connection lifetime. Every connection auto-joins `customer:{userId}`.
 * `salon:{salonId}` rooms are joined on request via `join:salon` — per API.md, this room serves
 * BOTH the staff/owner dashboard AND "a customer viewing a specific salon's live queue," and every
 * event payload is ids-only (no PII), so no additional salon-membership check gates the join
 * itself; the real access control lives on the REST endpoints (`SalonAccessService`), which is
 * what actually returns entry details/customer phone numbers/etc.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('missing token');
      const payload = this.jwtService.verify<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user || user.status !== UserStatus.ACTIVE)
        throw new Error('inactive user');

      const authenticatedUser: AuthenticatedUser = {
        id: user.id,
        roles: payload.roles,
      };

      (client.data as { user: AuthenticatedUser }).user = authenticatedUser;
      await client.join(`customer:${user.id}`);
    } catch (err) {
      this.logger.debug(
        `Rejected socket connection: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join:salon')
  async handleJoinSalon(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { salonId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.salonId) return { ok: false };
    await client.join(`salon:${body.salonId}`);
    return { ok: true };
  }

  emitQueueUpdated(salonId: string): void {
    this.server.to(`salon:${salonId}`).emit('queue.updated', { salonId });
  }

  emitQueueEntryReassigned(salonId: string, queueEntryId: string): void {
    this.server
      .to(`salon:${salonId}`)
      .emit('queue.entry.reassigned', { salonId, queueEntryId });
  }

  emitEntryCalled(
    salonId: string,
    queueEntryId: string,
    customerId: string | null,
  ): void {
    const payload = { salonId, queueEntryId };
    this.server.to(`salon:${salonId}`).emit('queue.entry.called', payload);
    if (customerId)
      this.server
        .to(`customer:${customerId}`)
        .emit('queue.entry.called', payload);
  }

  // Smart Queue (Phase 5) — "your turn is approaching" / "your wait changed a lot". Customer-room
  // only (not the salon room QueueService's other emits use): this is guidance for one specific
  // customer, not operational data the owner dashboard needs. Ids-only, same convention as every
  // other emit here — the client refetches GET queue-entries/mine/active for the actual numbers.
  emitQueueEntryWaitAlert(
    salonId: string,
    customerId: string,
    queueEntryId: string,
  ): void {
    this.server
      .to(`customer:${customerId}`)
      .emit('queue.entry.wait_alert', { salonId, queueEntryId });
  }

  emitStaffStatusChanged(salonId: string, staffId: string): void {
    this.server
      .to(`salon:${salonId}`)
      .emit('staff.status.changed', { salonId, staffId });
  }

  // Fired once, after a booking transaction commits successfully — never on a failed/rolled-back
  // create. Ids-only payload (same convention as emitEntryCalled): the owner dashboard refetches
  // authoritative booking data via the existing owner bookings API rather than trusting a payload
  // shape here, so this event can never leak customer details by itself.
  emitBookingCreated(salonId: string, bookingId: string): void {
    this.server.to(`salon:${salonId}`).emit('booking.created', { salonId, bookingId });
  }

  emitBookingCancelled(salonId: string, bookingId: string): void {
    this.server.to(`salon:${salonId}`).emit('booking.cancelled', { salonId, bookingId });
  }

  emitBookingRescheduled(salonId: string, bookingId: string): void {
    this.server.to(`salon:${salonId}`).emit('booking.rescheduled', { salonId, bookingId });
  }
}
