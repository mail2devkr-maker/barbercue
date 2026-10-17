import { DEMO_WORKSPACE_BANNER } from '@barbercue/shared';
import { createDemoWorkspaceDataset } from './demo-workspace.dataset';

describe('createDemoWorkspaceDataset', () => {
  const base = {
    workspaceId: 'workspace-test-1',
    generatedAt: new Date('2026-10-17T08:30:00.000Z'),
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  };

  it('is deterministic for a workspace and contains only namespaced synthetic identifiers', () => {
    const first = createDemoWorkspaceDataset(base);
    const retry = createDemoWorkspaceDataset(base);
    expect(first).toEqual(retry);
    expect(first.banner).toBe(DEMO_WORKSPACE_BANNER);
    expect(first.demoShop.synthetic).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(
      /\+91\d{10}|@gmail\.com|@fastque\.com/i,
    );
    expect(
      first.customers.every(
        (customer) =>
          customer.phone === null &&
          customer.email.endsWith('@example.invalid'),
      ),
    ).toBe(true);
    for (const item of [
      ...first.customers,
      ...first.staff,
      ...first.services,
      ...first.visits,
      ...first.bookings,
    ]) {
      expect(item.id.startsWith('demo:workspace-test-1:')).toBe(true);
    }
  });

  it('covers visit states and 30-day, weekly, monthly, staff/service/customer projections', () => {
    const dataset = createDemoWorkspaceDataset(base);
    expect(dataset.visits.map((visit) => visit.status)).toEqual(
      expect.arrayContaining([
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW',
        'WAITING',
        'IN_SERVICE',
      ]),
    );
    expect(dataset.revenue.daily).toHaveLength(30);
    expect(dataset.revenue.weekly).toHaveLength(8);
    expect(dataset.revenue.monthly).toHaveLength(6);
    expect(dataset.revenue.byService).toHaveLength(dataset.services.length);
    expect(dataset.revenue.byStaff).toHaveLength(dataset.staff.length);
    expect(dataset.revenue.byCustomer).toHaveLength(dataset.customers.length);
    expect(dataset.revenue.disclaimer).toMatch(
      /not recorded revenue or payments/i,
    );
  });

  it('does not link demo bookings to separate demo queue visits or represent sample projections as real payments', () => {
    const dataset = createDemoWorkspaceDataset(base);
    expect(
      dataset.bookings.every((booking) => booking.linkedQueueVisitId === null),
    ).toBe(true);
    expect(
      dataset.invoices.every((invoice) => invoice.isRecordedPayment === false),
    ).toBe(true);
    expect(
      dataset.visits.every(
        (visit) => visit.paymentProjection === 'SIMULATED_ONLY',
      ),
    ).toBe(true);
  });
});
