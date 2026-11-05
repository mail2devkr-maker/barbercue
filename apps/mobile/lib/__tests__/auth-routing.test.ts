import { Role, SessionAudience } from '@barbercue/shared';
import { getAuthenticatedDestination, isAuthorizedEmployeeSession } from '../auth-routing';

describe('authenticated mobile role routing', () => {
  it('opens the employee shell only for the EMPLOYEE audience with its single FIELD_EXECUTIVE role', () => {
    const employee = { audience: SessionAudience.EMPLOYEE, roles: [Role.FIELD_EXECUTIVE] };
    expect(isAuthorizedEmployeeSession(employee)).toBe(true);
    expect(getAuthenticatedDestination(employee)).toBe('employee');
  });

  it.each([
    ['employee role in a customer audience', { audience: SessionAudience.CUSTOMER, roles: [Role.FIELD_EXECUTIVE] }],
    ['employee role in a staff audience', { audience: SessionAudience.STAFF, roles: [Role.FIELD_EXECUTIVE] }],
    ['mixed employee and customer roles', { audience: SessionAudience.EMPLOYEE, roles: [Role.FIELD_EXECUTIVE, Role.CUSTOMER] }],
    ['owner role in a customer audience', { audience: SessionAudience.CUSTOMER, roles: [Role.SALON_OWNER] }],
    ['customer with an unrelated global role', { audience: SessionAudience.CUSTOMER, roles: [Role.CUSTOMER, Role.PLATFORM_ADMIN] }],
    ['salon owner with an unrelated global role', { audience: SessionAudience.STAFF, roles: [Role.SALON_OWNER, Role.PLATFORM_ADMIN] }],
    ['staff role in an employee audience', { audience: SessionAudience.EMPLOYEE, roles: [Role.SALON_STAFF] }],
  ])('rejects %s instead of routing into customer or salon surfaces', (_label, user) => {
    expect(getAuthenticatedDestination(user)).toBe('restricted');
  });

  it('preserves existing owner, staff, and customer routing', () => {
    expect(getAuthenticatedDestination({ audience: SessionAudience.STAFF, roles: [Role.SALON_OWNER] })).toBe('owner');
    expect(getAuthenticatedDestination({ audience: SessionAudience.STAFF, roles: [Role.SALON_OWNER, Role.SALON_STAFF] })).toBe('owner');
    expect(getAuthenticatedDestination({ audience: SessionAudience.STAFF, roles: [Role.SALON_STAFF] })).toBe('staff');
    expect(getAuthenticatedDestination({ audience: SessionAudience.CUSTOMER, roles: [Role.CUSTOMER] })).toBe('customer');
  });

  it('does not treat unknown or administrator-only roles as customers', () => {
    expect(getAuthenticatedDestination({ audience: SessionAudience.ADMIN, roles: [Role.PLATFORM_ADMIN] })).toBe('restricted');
    expect(getAuthenticatedDestination({ audience: SessionAudience.CUSTOMER, roles: [] })).toBe('restricted');
  });
});
