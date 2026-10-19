import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OwnerOpsErrorCode,
  type OwnerAssistantFigureDto,
  type OwnerAssistantIntent,
  type OwnerAssistantQueryDto,
  type OwnerAssistantQueryInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { OwnerOverviewService } from './owner-overview.service';

const NON_TODAY_PERIOD =
  /\b(yesterday|tomorrow|last week|this week|last month|this month|last year|this year)\b|कल|पिछले सप्ताह|इस सप्ताह|पिछले महीने|इस महीने/u;
const TODAY = /\b(today|aaj)\b|आज/u;

function normalize(question: string): string {
  return (
    question
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      // Indic vowel signs are Unicode marks, not letters. Preserve them so Hindi phrases
      // continue to match after punctuation cleanup.
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Only explicitly supported, read-only intents are executable. No free-form generation occurs. */
function intentFor(question: string): OwnerAssistantIntent | null {
  const q = normalize(question);
  if (NON_TODAY_PERIOD.test(q)) return null;

  const hasToday = TODAY.test(q);
  if (hasToday && /\b(summary|overview|saaransh)\b|सारांश/u.test(q)) {
    return 'TODAY_SUMMARY';
  }
  if (
    hasToday &&
    /\b(revenue|collection|collected|payment|payments|income|kamai)\b|कमाई|आमदनी|भुगतान/u.test(
      q,
    )
  ) {
    return 'TODAY_RECORDED_AND_ESTIMATED_VALUE';
  }
  if (/\b(waiting|wait|queue|intezar)\b|प्रतीक्षा|कतार/u.test(q)) {
    return 'WAITING_QUEUE_NOW';
  }
  if (/\b(in service|being served|serving now)\b|सेवा में/u.test(q)) {
    return 'IN_SERVICE_NOW';
  }
  if (
    hasToday &&
    /\b(appointment|appointments|booking|bookings)\b|बुकिंग/u.test(q)
  ) {
    return 'APPOINTMENTS_TODAY';
  }
  if (hasToday && /\b(completed|finished|served)\b|पूरी हुई|पूर्ण/u.test(q)) {
    return 'COMPLETED_SERVICES_TODAY';
  }
  if (
    /\b(available|free)\b.{0,40}\b(barber|barbers|staff)\b|\b(barber|barbers|staff)\b.{0,40}\b(available|free)\b|उपलब्ध/u.test(
      q,
    )
  ) {
    return 'AVAILABLE_BARBERS_NOW';
  }
  if (
    hasToday &&
    /\b(cancelled|canceled|cancellation|cancellations)\b|रद्द/u.test(q)
  ) {
    return 'CANCELLATIONS_TODAY';
  }
  return null;
}

function countFigure(
  metric: OwnerAssistantFigureDto['metric'],
  value: number,
): OwnerAssistantFigureDto {
  return { metric, value, unit: 'count', currency: null, estimated: false };
}

function moneyFigure(
  metric: OwnerAssistantFigureDto['metric'],
  value: number,
  currency: string | null,
  estimated: boolean,
): OwnerAssistantFigureDto {
  return { metric, value, unit: 'money', currency, estimated };
}

function moneyLabel(value: number, currency: string | null): string {
  return `${currency ?? 'Currency not configured'} ${value.toFixed(2)}`;
}

@Injectable()
export class OwnerAssistantService {
  constructor(
    private readonly salonAccess: SalonAccessService,
    private readonly overview: OwnerOverviewService,
  ) {}

  async query(
    userId: string,
    salonId: string,
    input: OwnerAssistantQueryInput,
  ): Promise<OwnerAssistantQueryDto> {
    // Check live salon ownership before interpreting input so an unauthorized caller cannot use
    // validation behavior to probe whether a salon's assistant feature accepts a particular query.
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const intent = intentFor(input.question);
    if (!intent) {
      throw new AppException(
        OwnerOpsErrorCode.OWNER_ASSISTANT_QUERY_UNSUPPORTED,
        'This question is not supported by the deterministic Owner Insights assistant.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        {
          supportedIntents: [
            'today summary',
            'today recorded collections and estimated service value',
            'appointments today',
            'completed services today',
            'waiting queue now',
            'in-service count now',
            'available barbers now',
            'cancellations today',
          ],
        },
      );
    }

    // OwnerOverview is the existing source of truth for salon timezone, recorded money, estimates,
    // appointment counts, queue state, staffing, and cancellations. It rechecks authorization too.
    const overview = await this.overview.getOverview(userId, salonId);
    const figures: OwnerAssistantFigureDto[] = [];

    switch (intent) {
      case 'TODAY_SUMMARY':
        figures.push(
          countFigure('appointmentsToday', overview.kpis.appointmentsToday),
          countFigure('waitingInQueue', overview.kpis.waitingInQueue),
          countFigure('inService', overview.kpis.inService),
          countFigure(
            'completedServicesToday',
            overview.kpis.completedServicesToday,
          ),
          countFigure('cancelledToday', overview.kpis.cancelledToday),
          moneyFigure(
            'recordedCollectionsToday',
            overview.kpis.recordedRevenueToday,
            overview.currency,
            false,
          ),
          moneyFigure(
            'estimatedServiceValueToday',
            overview.revenue.estimatedServiceValueToday,
            overview.currency,
            true,
          ),
        );
        break;
      case 'TODAY_RECORDED_AND_ESTIMATED_VALUE':
        figures.push(
          moneyFigure(
            'recordedCollectionsToday',
            overview.kpis.recordedRevenueToday,
            overview.currency,
            false,
          ),
          moneyFigure(
            'estimatedServiceValueToday',
            overview.revenue.estimatedServiceValueToday,
            overview.currency,
            true,
          ),
        );
        break;
      case 'APPOINTMENTS_TODAY':
        figures.push(
          countFigure('appointmentsToday', overview.kpis.appointmentsToday),
        );
        break;
      case 'COMPLETED_SERVICES_TODAY':
        figures.push(
          countFigure(
            'completedServicesToday',
            overview.kpis.completedServicesToday,
          ),
        );
        break;
      case 'WAITING_QUEUE_NOW':
        figures.push(
          countFigure('waitingInQueue', overview.kpis.waitingInQueue),
        );
        break;
      case 'IN_SERVICE_NOW':
        figures.push(countFigure('inService', overview.kpis.inService));
        break;
      case 'AVAILABLE_BARBERS_NOW':
        figures.push(
          countFigure('availableBarbers', overview.kpis.availableBarbers),
        );
        break;
      case 'CANCELLATIONS_TODAY':
        figures.push(
          countFigure('cancelledToday', overview.kpis.cancelledToday),
        );
        break;
    }

    const answer = this.answer(intent, overview, figures);
    return {
      salonId,
      mode: 'DETERMINISTIC',
      intent,
      localDate: overview.localDate,
      timezone: overview.timezone,
      answer,
      figures,
      generatedAt: overview.generatedAt,
    };
  }

  private answer(
    intent: OwnerAssistantIntent,
    overview: Awaited<ReturnType<OwnerOverviewService['getOverview']>>,
    figures: OwnerAssistantFigureDto[],
  ): string {
    const count = (metric: OwnerAssistantFigureDto['metric']) =>
      figures.find((figure) => figure.metric === metric)?.value ?? 0;
    const collections = figures.find(
      (figure) => figure.metric === 'recordedCollectionsToday',
    );
    const estimate = figures.find(
      (figure) => figure.metric === 'estimatedServiceValueToday',
    );
    const todayLabel = `${overview.localDate} (${overview.timezone})`;

    switch (intent) {
      case 'TODAY_SUMMARY':
        return `For ${todayLabel}: ${count('appointmentsToday')} appointments, ${count('waitingInQueue')} waiting, ${count('inService')} in service, ${count('completedServicesToday')} completed, and ${count('cancelledToday')} cancelled. Recorded collections are ${moneyLabel(collections?.value ?? 0, overview.currency)}; estimated completed-service value is ${moneyLabel(estimate?.value ?? 0, overview.currency)} and is not collected revenue.`;
      case 'TODAY_RECORDED_AND_ESTIMATED_VALUE':
        return `For ${todayLabel}, shop-recorded collections are ${moneyLabel(collections?.value ?? 0, overview.currency)}. Completed-service listed-price value is estimated at ${moneyLabel(estimate?.value ?? 0, overview.currency)}; this estimate is not collected revenue.`;
      case 'APPOINTMENTS_TODAY':
        return `${count('appointmentsToday')} appointments are scheduled for ${todayLabel}.`;
      case 'COMPLETED_SERVICES_TODAY':
        return `${count('completedServicesToday')} services were completed on ${todayLabel}.`;
      case 'WAITING_QUEUE_NOW':
        return `${count('waitingInQueue')} customers are currently waiting in the Live Queue.`;
      case 'IN_SERVICE_NOW':
        return `${count('inService')} services are currently in progress.`;
      case 'AVAILABLE_BARBERS_NOW':
        return `${count('availableBarbers')} barbers are currently available.`;
      case 'CANCELLATIONS_TODAY':
        return `${count('cancelledToday')} appointments were cancelled on ${todayLabel}.`;
    }
  }
}
