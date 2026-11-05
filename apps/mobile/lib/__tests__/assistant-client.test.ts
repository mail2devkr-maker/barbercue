import { AssistantActionId, Role, SessionAudience, type AssistantTurnDto } from '@barbercue/shared';
import { assistantSurfaceForUser, toAssistantDisplayTurn } from '../assistant-client';
import { resolveAssistantDestination } from '../assistant-navigation';

describe('mobile Assistant safety adapter', () => {
  it('accepts only the expected server-issued audience and role combinations', () => {
    expect(assistantSurfaceForUser({ audience: SessionAudience.CUSTOMER, roles: [Role.CUSTOMER] })).toBe('customer');
    expect(assistantSurfaceForUser({ audience: SessionAudience.STAFF, roles: [Role.SALON_STAFF] })).toBe('shop');
    expect(assistantSurfaceForUser({ audience: SessionAudience.STAFF, roles: [Role.SALON_OWNER] })).toBe('shop');
    expect(assistantSurfaceForUser({ audience: SessionAudience.EMPLOYEE, roles: [Role.FIELD_EXECUTIVE] })).toBe('employee');
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

  it('opens only known routes and binds shop navigation to the selected salon', () => {
    expect(resolveAssistantDestination({ navigateTo: '/account/bookings', surface: 'customer' })).toBe('customer-bookings');
    expect(resolveAssistantDestination({ navigateTo: '/account/favorites', surface: 'customer' })).toBe('customer-favorites');
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/queue', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBe('owner-queue');
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/offers', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBe('owner-offers');
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-2/queue', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: 'https://example.com', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/schedule', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/admin/crm', surface: 'shop', salonId: 'shop-1', isOwner: true })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/dashboard/salons/shop-1/revenue', surface: 'shop', salonId: 'shop-1', isOwner: false })).toBeNull();
    expect(resolveAssistantDestination({ navigateTo: '/employee', surface: 'employee' })).toBe('employee-dashboard');
  });
});
