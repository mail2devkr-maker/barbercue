import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DashboardQueueController } from './dashboard-queue.controller';

// The mobile Live Queue shipped calling `queue-entries/:id/call` (no prefix), which 404'd in
// production ("Cannot POST /api/v1/queue-entries/<id>/call"). These tests pin the AUTHORITATIVE
// route table for every owner/staff queue mutation, so a client (and this controller) can never
// silently drift apart again.
describe('DashboardQueueController — operator route table', () => {
  const proto = DashboardQueueController.prototype as unknown as Record<string, unknown>;

  function route(handler: string): { method: RequestMethod; path: string } {
    const fn = proto[handler] as object;
    return {
      method: Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod,
      path: Reflect.getMetadata(PATH_METADATA, fn) as string,
    };
  }

  it('is mounted under the dashboard prefix, so every action below is dashboard/…', () => {
    expect(Reflect.getMetadata(PATH_METADATA, DashboardQueueController)).toBe('dashboard');
  });

  it.each([
    ['call', 'queue-entries/:id/call'],
    ['markArrived', 'queue-entries/:id/arrive'],
    ['assign', 'queue-entries/:id/assign'],
    ['noShow', 'queue-entries/:id/no-show'],
    ['cancel', 'queue-entries/:id/cancel'],
    ['complete', 'service-sessions/:id/complete'],
  ])('%s is POST %s (under dashboard/)', (handler, path) => {
    expect(route(handler)).toEqual({ method: RequestMethod.POST, path });
  });

  describe('delegation', () => {
    const queueService = {
      call: jest.fn(),
      markArrived: jest.fn(),
      assign: jest.fn(),
      noShow: jest.fn(),
      cancelByStaff: jest.fn(),
      completeSession: jest.fn(),
    };
    const controller = new DashboardQueueController(
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const user = { id: 'staff-1' } as never;

    beforeEach(() => jest.clearAllMocks());

    it('call -> QueueService.call(userId, entryId)', () => {
      controller.call(user, 'q1');
      expect(queueService.call).toHaveBeenCalledWith('staff-1', 'q1');
    });

    it('markArrived -> QueueService.markArrived(userId, entryId)', () => {
      controller.markArrived(user, 'q1');
      expect(queueService.markArrived).toHaveBeenCalledWith('staff-1', 'q1');
    });

    it('assign -> QueueService.assign(userId, entryId, body)', () => {
      const body = { staffId: 's', chairId: 'c' };
      controller.assign(user, 'q1', body as never);
      expect(queueService.assign).toHaveBeenCalledWith('staff-1', 'q1', body);
    });

    it('noShow -> QueueService.noShow(userId, entryId)', () => {
      controller.noShow(user, 'q1');
      expect(queueService.noShow).toHaveBeenCalledWith('staff-1', 'q1');
    });

    it('cancel -> QueueService.cancelByStaff(userId, entryId)', () => {
      controller.cancel(user, 'q1');
      expect(queueService.cancelByStaff).toHaveBeenCalledWith('staff-1', 'q1');
    });

    it('complete -> QueueService.completeSession(userId, sessionId) — the ServiceSession logic, not a direct QueueEntry write', () => {
      controller.complete(user, 'sess1');
      expect(queueService.completeSession).toHaveBeenCalledWith('staff-1', 'sess1');
    });
  });
});
