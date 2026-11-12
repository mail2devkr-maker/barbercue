import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RevenueReportPanel } from '../RevenueReportPanel';
import { apiDownloadFile, apiFetch } from '../../../lib/api';
import * as Sharing from 'expo-sharing';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), apiDownloadFile: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    EmptyState: ({ title }: { title: string }) => createElement(Text, null, title),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, createElement(Text, null, title)),
  };
});

const metric = (net: number) => ({ completedVisits: 3, grossServiceValue: 900, estimatedServiceValue: 900, invoiceCount: 2, invoiceDiscounts: 0, invoicedAmount: 800, recordedCollections: net, refunds: 0, netRecordedCollections: net });
const report = (from: string, to: string, groupBy = 'day') => ({
  salonId: 's1', currency: 'INR', timeZone: 'Asia/Kolkata', from, to, groupBy, source: null,
  periods: [{ period: from, ...metric(700) }], totals: metric(700),
  byService: [{ key: 'svc', label: 'Haircut', serviceId: 'svc', ...metric(700) }], byStaff: [], byCustomer: [], bySource: [],
  dataSemantics: {},
});
const fetchMock = apiFetch as jest.Mock;
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/timezone')) return { timezone: 'Asia/Kolkata', countryCode: 'IN', suggestion: null };
    const q = new URLSearchParams(path.split('?')[1]);
    return report(q.get('from')!, q.get('to')!, q.get('groupBy') ?? 'day');
  });
});

it('loads the last 30 days in the shop time zone, then a custom range and weekly view', async () => {
  await render(<RevenueReportPanel salonId="s1" language={'EN' as never} />);
  expect(await screen.findByText('Net collected')).toBeTruthy();
  const first = fetchMock.mock.calls.find(([p]) => String(p).includes('/revenue/report?'))![0] as string;
  expect(first).toMatch(/^dashboard\/salons\/s1\/revenue\/report\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&groupBy=day/);
  await fireEvent.changeText(screen.getByLabelText('From'), '2026-10-01');
  await fireEvent.changeText(screen.getByLabelText('To'), '2026-10-31');
  await fireEvent.press(screen.getByLabelText('Show report'));
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('from=2026-10-01&to=2026-10-31&groupBy=day')));
  await fireEvent.press(screen.getByText('Weekly'));
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('from=2026-10-01&to=2026-10-31&groupBy=week')));
  expect(screen.getByText('Haircut')).toBeTruthy();
});

it('rejects a reversed range before calling the server', async () => {
  await render(<RevenueReportPanel salonId="s1" language={'EN' as never} />);
  await screen.findByText('Net collected');
  const calls = fetchMock.mock.calls.length;
  await fireEvent.changeText(screen.getByLabelText('From'), '2026-10-31');
  await fireEvent.changeText(screen.getByLabelText('To'), '2026-10-01');
  await fireEvent.press(screen.getByLabelText('Show report'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(fetchMock.mock.calls.length).toBe(calls);
});

it('downloads the Excel-compatible report for the loaded range and opens the share sheet', async () => {
  (apiDownloadFile as jest.Mock).mockResolvedValue('file:///cache/report.xml');
  await render(<RevenueReportPanel salonId="s1" language={'EN' as never} />);
  await screen.findByText('Net collected');
  await fireEvent.press(screen.getByLabelText('Download Excel'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
  expect((apiDownloadFile as jest.Mock).mock.calls[0][0]).toMatch(/^dashboard\/salons\/s1\/revenue\/report\.excel\.xml\?from=/);
});
