import { AssistantActionId, Role, SessionAudience, type AssistantTurnDto } from '@barbercue/shared';
import {
  assistantConfirmationCanProceed,
  assistantConfirmationReadiness,
  assistantSurfaceForUser,
  pendingAssistantConfirmation,
  toAssistantDisplayTurn,
} from '../assistant-client';
import { resolveAssistantDestination } from '../assistant-navigation';

describe('mobile Assistant safety adapter', () => {
  it('accepts only the expected server-issued audience and role combinations', () => {
    expect(assistantSurfaceForUser({ audience: SessionAudience.CUSTOMER, roles: [Role.CUSTOMER] })).toBe('customer');
    expect(assistantSurfaceForUser({ audience: SessionAudience.STAFF, roles: [Role.SALON_STAFF] })).toBe('shop');
    expect(assistantSurfaceForUser({ audience: SessionAudience.STAFF, roles: [Role.SALON_OWNER] })).toBe('shop');
    expect(assistantSurfaceForUser({ audience: SessionAudience.EMPLOYEE, roles: [Role.FIELD_EXECUTIVE] })).toBeNull();
    expect(assistantSurfaceForUser({ audience: SessionAudience.CUSTOMER, roles: [Role.SALON_OWNER] })).toBeNull();
    expect(assistantSurfaceForUser({ audience: SessionAudience.STAFF, roles: [Role.SALON_STAFF, Role.PLATFORM_ADMIN] })).toBeNull();
    expect(assistantSurfaceForUser({ audience: SessionAudience.ADMIN, roles: [Role.PLATFORM_ADMIN] })).toBeNull();
  });

  it('drops write confirmation tokens from the screen model', () => {
    const turn = {
      requestId: 'req-1',
      status: 'NEEDS_CONFIRMATION',
      action: { id: AssistantActionId.QUEUE_CANCEL, title: 'Cancel queue entry', kind: 'WRITE' },
      message: 'Please check and confirm. Nothing has changed yet.',
      confirmation: { token: 'must-not-be-retained', expiresAt: '2026-11-04T00:00:00.000Z' },
      completedAt: '2026-11-04T00:00:00.000Z',
    } satisfies AssistantTurnDto;
    const display = toAssistantDisplayTurn(turn);
    expect(display.status).toBe('NEEDS_CONFIRMATION');
    expect(display.message).toContain('Nothing has changed');
    expect('confirmation' in display).toBe(false);
    expect(JSON.stringify(display)).not.toContain('must-not-be-retained');
  });

  it('fails closed if the server says a write completed without mobile confirmation', () => {
    const turn = {
      requestId: 'req-2',
      status: 'DONE',
      action: { id: AssistantActionId.QUEUE_CANCEL, title: 'Cancel queue entry', kind: 'WRITE' },
      message: 'Cancelled.',
      completedAt: '2026-11-04T00:00:00.000Z',
    } satisfies AssistantTurnDto;
    const display = toAssistantDisplayTurn(turn);
    expect(display.status).toBe('FAILED');
    expect(display.message).toContain('cannot confirm changes');
  });

  it('accepts a completed write only when it came from the explicit confirmation response', () => {
    const turn = {
      requestId: 'req-confirmed',
      status: 'DONE',
      action: { id: AssistantActionId.QUEUE_CANCEL, title: 'Cancel queue entry', kind: 'WRITE' },
      message: 'Queue entry cancelled.',
      completedAt: '2026-11-04T00:00:00.000Z',
    } satisfies AssistantTurnDto;

    expect(toAssistantDisplayTurn(turn).status).toBe('FAILED');
    expect(toAssistantDisplayTurn(turn, true).status).toBe('DONE');
  });

  it('issues an in-memory confirmation only for enabled, pending write previews', () => {
    const turn = {
      requestId: 'req-pending',
      status: 'NEEDS_CONFIRMATION',
      action: { id: AssistantActionId.QUEUE_CANCEL, title: 'Cancel queue entry', kind: 'WRITE' },
      message: 'Preview only.',
      confirmation: { token: 'short-lived-token', expiresAt: '2026-11-05T01:00:00.000Z' },
      completedAt: '2026-11-05T00:00:00.000Z',
    } satisfies AssistantTurnDto;

    const pending = pendingAssistantConfirmation(turn, true, 'shop', 'salon-1');
    expect(pending).toEqual({ token: 'short-lived-token', expiresAt: '2026-11-05T01:00:00.000Z', surface: 'shop', salonId: 'salon-1', requiresAcknowledgement: false });
    expect(pendingAssistantConfirmation(turn, false, 'shop', 'salon-1')).toBeNull();
    expect(pendingAssistantConfirmation({ ...turn, status: 'DONE' }, true, 'shop', 'salon-1')).toBeNull();
    expect(pendingAssistantConfirmation({ ...turn, action: { ...turn.action!, kind: 'READ' } }, true, 'shop', 'salon-1')).toBeNull();

    const highRisk = { ...turn, preview: { rows: [], risk: 'high' } } satisfies AssistantTurnDto;
    const highRiskPending = pendingAssistantConfirmation(highRisk, true, 'shop', 'salon-1')!;
    expect(highRiskPending.requiresAcknowledgement).toBe(true);
    expect(assistantConfirmationCanProceed(highRiskPending, false)).toBe(false);
    expect(assistantConfirmationCanProceed(highRiskPending, true)).toBe(true);
    expect(assistantConfirmationCanProceed(pending!, false)).toBe(true);
  });

  it('expires confirmations and rejects confirmation after a role or shop switch', () => {
    const pending = {
      token: 'short-lived-token',
      expiresAt: '2026-11-05T01:00:00.000Z',
      surface: 'shop' as const,
      salonId: 'salon-1',
      requiresAcknowledgement: false,
    };
    expect(assistantConfirmationReadiness(pending, { surface: 'shop', salonId: 'salon-1', now: Date.parse('2026-11-05T00:30:00.000Z') })).toBe('ready');
    expect(assistantConfirmationReadiness(pending, { surface: 'shop', salonId: 'salon-2', now: Date.parse('2026-11-05T00:30:00.000Z') })).toBe('context-changed');
    expect(assistantConfirmationReadiness(pending, { surface: 'customer', salonId: null, now: Date.parse('2026-11-05T00:30:00.000Z') })).toBe('context-changed');
    expect(assistantConfirmationReadiness(pending, { surface: 'shop', salonId: 'salon-1', now: Date.parse('2026-11-05T01:00:00.000Z') })).toBe('expired');
  });

  it('opens only known routes and binds shop navigation to the selected salon', () => {
    expect(resolveAssistantDestination({ navigateTo: '/account/bookings', surface: 'customer' })).toBe('customer-bookings');
    expect(resolveAssistantDestination({ navigateTo: '/account/favorites', surface: 'customer' })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/queue', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBe('owner-queue');
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/offers', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBe('owner-offers');
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-2/queue', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: 'https://example.com', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/schedule', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/admin/crm', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/revenue', surface: 'shop', salonId: 'shop-1', isOwner: false })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/employee', surface: 'employee' })).toBeNull();
  });
});
