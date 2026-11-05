import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { EMPLOYEE_PATHS, uiStringsFor, type EmployeeCrmDashboardDto, type EmployeeProfileDto } from '@barbercue/shared';
import EmployeeDashboardScreen from '../employee/EmployeeDashboardScreen';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

jest.mock('../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../components/ui', () => {
  const { createElement } = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    PremiumButton: ({ title, onPress }: { title: string; onPress: () => void }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, createElement(Text, null, title)),
    PremiumCard: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    PremiumScreen: ({ children, onRefresh }: { children: React.ReactNode; onRefresh: () => void }) =>
      createElement(View, { testID: 'employee-screen', onRefresh }, children),
    PremiumSectionHeader: ({ title, subtitle }: { title: string; subtitle?: string }) =>
      createElement(View, null, createElement(Text, null, title), createElement(Text, null, subtitle)),
  };
});

const apiFetchMock = apiFetch as jest.Mock;
const english = uiStringsFor('EN');
const profile: EmployeeProfileDto = {
  id: 'employee-1', employeeCode: 'FQ-FE-00101', fullName: 'Synthetic Field Executive', territory: 'North', joinedAt: '2026-01-01T00:00:00.000Z',
};
const dashboard: EmployeeCrmDashboardDto = {
  profile,
  counts: { leads: 4, onboarded: 2, visitsLast30Days: 3, openFollowUps: 1, overdueFollowUps: 0 },
  conversionRatePercent: 50,
  recentLeads: [{
    id: 'lead-1', shopName: 'Synthetic Shop', contactName: null, phone: null, email: null, city: 'Bengaluru', locality: null,
    addressLine: null, source: 'OTHER', status: 'NEW', notes: null, lostReason: null, onboardedAt: null,
    onboardedSalon: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  }],
  recentVisits: [],
  upcomingFollowUps: [],
};

function queueResponse(person: EmployeeProfileDto, summary: EmployeeCrmDashboardDto) {
  apiFetchMock
    .mockResolvedValueOnce(person)
    .mockResolvedValueOnce(summary);
}

describe('EmployeeDashboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({ logout: jest.fn().mockResolvedValue(undefined) });
  });

  it('loads the server-verified employee profile and scoped dashboard', async () => {
    queueResponse(profile, dashboard);
    await render(<EmployeeDashboardScreen />);

    expect(await screen.findByText('Synthetic Field Executive')).toBeTruthy();
    expect(screen.getByText('Synthetic Shop')).toBeTruthy();
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, `${EMPLOYEE_PATHS.employee}/${EMPLOYEE_PATHS.me}`);
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, `${EMPLOYEE_PATHS.employee}/${EMPLOYEE_PATHS.dashboard}`);
  });

  it('fails closed when the profile endpoint and dashboard identify different employees', async () => {
    queueResponse(profile, { ...dashboard, profile: { ...profile, id: 'different-employee' } });
    await render(<EmployeeDashboardScreen />);

    expect(await screen.findByRole('alert')).toHaveTextContent(english.employeeDashboardUnavailable);
    expect(screen.queryByText('Synthetic Field Executive')).toBeNull();
  });

  it('keeps the newest refreshed response when an older request completes later', async () => {
    const pending: Array<(value: unknown) => void> = [];
    apiFetchMock.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    await render(<EmployeeDashboardScreen />);
    await waitFor(() => expect(pending).toHaveLength(2));

    const screenRoot = screen.getByTestId('employee-screen');
    await act(async () => { await screenRoot.props.onRefresh(); });
    await waitFor(() => expect(pending).toHaveLength(4));

    const newerProfile = { ...profile, id: 'employee-newer', fullName: 'Latest Dashboard Identity' };
    const newerDashboard = { ...dashboard, profile: newerProfile, recentLeads: [] };
    await act(async () => {
      pending[2](newerProfile);
      pending[3](newerDashboard);
    });
    expect(await screen.findByText('Latest Dashboard Identity')).toBeTruthy();

    const staleProfile = { ...profile, id: 'employee-stale', fullName: 'Stale Dashboard Identity' };
    await act(async () => {
      pending[0](staleProfile);
      pending[1]({ ...dashboard, profile: staleProfile });
    });
    expect(screen.getByText('Latest Dashboard Identity')).toBeTruthy();
    expect(screen.queryByText('Stale Dashboard Identity')).toBeNull();
  });
});
