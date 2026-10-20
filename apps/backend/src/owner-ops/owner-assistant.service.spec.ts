import { HttpStatus } from '@nestjs/common';
import { OwnerOpsErrorCode, type OwnerOverviewDto } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { OwnerOverviewService } from './owner-overview.service';
import { OwnerAssistantService } from './owner-assistant.service';

describe('OwnerAssistantService', () => {
  const overview = {
    salonId: 'salon-1',
    salonName: 'Synthetic Shop',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    localDate: '2026-10-20',
    generatedAt: '2026-10-20T10:00:00.000Z',
    kpis: {
      appointmentsToday: 4,
      customersServedToday: 2,
      waitingInQueue: 3,
      inService: 1,
      availableBarbers: 2,
      busyBarbers: 1,
      activeStaff: 3,
      completedServicesToday: 2,
      cancelledToday: 1,
      recordedRevenueToday: 245,
      recordedPaymentsToday: 2,
    },
    revenue: { estimatedServiceValueToday: 380 },
  } as OwnerOverviewDto;

  const salonAccess = {
    assertOwnerOrAdminAccess: jest.fn().mockResolvedValue(undefined),
  };
  const overviewService = {
    getOverview: jest.fn().mockResolvedValue(overview),
  };
  let service: OwnerAssistantService;

  beforeEach(() => {
    jest.clearAllMocks();
    salonAccess.assertOwnerOrAdminAccess.mockResolvedValue(undefined);
    overviewService.getOverview.mockResolvedValue(overview);
    service = new OwnerAssistantService(
      salonAccess as unknown as SalonAccessService,
      overviewService as unknown as OwnerOverviewService,
    );
  });

  it('answers a supported English appointment query using only the authorized overview', async () => {
    const result = await service.query('owner-1', 'salon-1', {
      question: 'How many appointments today?',
    });

    expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
    expect(overviewService.getOverview).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
    expect(result).toMatchObject({
      salonId: 'salon-1',
      mode: 'DETERMINISTIC',
      intent: 'APPOINTMENTS_TODAY',
      localDate: '2026-10-20',
      timezone: 'Asia/Kolkata',
      figures: [
        {
          metric: 'appointmentsToday',
          value: 4,
          unit: 'count',
          estimated: false,
        },
      ],
    });
    expect(result.answer).toContain('4 appointments');
    expect(result).not.toHaveProperty('question');
  });

  it('keeps recorded collections separate from estimated service value in English and Hinglish', async () => {
    const result = await service.query('owner-1', 'salon-1', {
      question: 'Aaj ki collection kitni hai?',
    });

    expect(result.intent).toBe('TODAY_RECORDED_AND_ESTIMATED_VALUE');
    expect(result.figures).toEqual([
      {
        metric: 'recordedCollectionsToday',
        value: 245,
        unit: 'money',
        currency: 'INR',
        estimated: false,
      },
      {
        metric: 'estimatedServiceValueToday',
        value: 380,
        unit: 'money',
        currency: 'INR',
        estimated: true,
      },
    ]);
    expect(result.answer).toContain('not collected revenue');
  });

  it('recognizes a documented Hindi revenue query without treating a non-today period as today', async () => {
    const result = await service.query('owner-1', 'salon-1', {
      question: 'आज की कमाई कितनी हुई?',
    });
    expect(result.intent).toBe('TODAY_RECORDED_AND_ESTIMATED_VALUE');

    await expect(
      service.query('owner-1', 'salon-1', {
        question: 'कल की कमाई कितनी हुई?',
      }),
    ).rejects.toMatchObject({
      code: OwnerOpsErrorCode.OWNER_ASSISTANT_QUERY_UNSUPPORTED,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  });

  it('answers current queue and staffing intents without returning customer or staff identities', async () => {
    const waiting = await service.query('owner-1', 'salon-1', {
      question: 'How many customers are waiting in the queue now?',
    });
    const available = await service.query('owner-1', 'salon-1', {
      question: 'How many barbers are available now?',
    });

    expect(waiting.intent).toBe('WAITING_QUEUE_NOW');
    expect(waiting.figures[0].value).toBe(3);
    expect(available.intent).toBe('AVAILABLE_BARBERS_NOW');
    expect(available.figures[0].value).toBe(2);
    expect(JSON.stringify([waiting, available])).not.toContain(
      'Synthetic Shop',
    );
  });

  it('rejects unsupported periods without pretending to answer them', async () => {
    for (const question of [
      'What was our revenue yesterday?',
      'How many barbers are available next week?',
      'Who is available on 2026-10-25?',
      'How many appointments in 2 weeks?',
      'अगले सप्ताह कितने ग्राहक प्रतीक्षा करेंगे?',
    ]) {
      await expect(
        service.query('owner-1', 'salon-1', { question }),
      ).rejects.toMatchObject({
        code: OwnerOpsErrorCode.OWNER_ASSISTANT_QUERY_UNSUPPORTED,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    expect(overviewService.getOverview).not.toHaveBeenCalled();
  });

  it('checks salon authorization before interpreting a question', async () => {
    const denied = new Error('denied');
    salonAccess.assertOwnerOrAdminAccess.mockRejectedValueOnce(denied);
    await expect(
      service.query('other-owner', 'salon-1', { question: 'unknown request' }),
    ).rejects.toBe(denied);
    expect(overviewService.getOverview).not.toHaveBeenCalled();
  });

  it('does not echo unsupported question content in its error', async () => {
    try {
      await service.query('owner-1', 'salon-1', {
        question: 'Customer 9876543210 please tell me their details',
      });
      throw new Error('expected unsupported question to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as Error).message).not.toContain('9876543210');
    }
  });
});
