import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ContactsCheckPanel } from '../ContactsCheckPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { status = 0; } }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, createElement(Text, null, title)),
  };
});

const fetchMock = apiFetch as jest.Mock;

it('checks a pasted list on the server, shows only the last four digits, and offers no ledger when it is off', async () => {
  fetchMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path.endsWith('/capabilities')) return { features: { contactImport: { status: 'DISABLED' } } };
    const count = JSON.parse(init!.body!).contacts.length;
    return { previewOnly: true, summary: { total: count, validatedForReview: 1, invalidPhone: 1, consentRequired: 0, consentEvidenceIncomplete: 0, consentTimestampInvalid: 0, duplicateInBatch: 0 }, items: [{ index: 0, status: 'VALIDATED_FOR_REVIEW' }, { index: 1, status: 'INVALID_PHONE' }] };
  });
  await render(<ContactsCheckPanel salonId="s1" />);
  await fireEvent.press(screen.getByLabelText('Check list'));
  expect(await screen.findByText('Add at least one phone number.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Contact list'), '9876543210\n12');
  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByLabelText('Check list'));
  expect(await screen.findByText('••••3210 · Looks complete')).toBeTruthy();
  const post = fetchMock.mock.calls.find(([p]) => String(p).endsWith('/contacts/preview'));
  expect(JSON.parse(post[1].body).contacts[0]).toMatchObject({ phone: '9876543210', consent: { granted: true, source: 'OWNER_ATTESTED' } });
  expect(screen.queryByLabelText('Save agreement records')).toBeNull();
  expect(screen.queryByText(/9876543210/)).toBeNull();
});

it('offers saving agreement records only where the ledger is SANDBOX-enabled', async () => {
  fetchMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/capabilities')) return { features: { contactImport: { status: 'SANDBOX' } } };
    return { previewOnly: true, summary: { total: 1, validatedForReview: 1, invalidPhone: 0, consentRequired: 0, consentEvidenceIncomplete: 0, consentTimestampInvalid: 0, duplicateInBatch: 0 }, items: [{ index: 0, status: 'VALIDATED_FOR_REVIEW' }] };
  });
  await render(<ContactsCheckPanel salonId="s1" />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await fireEvent.changeText(screen.getByLabelText('Contact list'), '9876543210, IN_PERSON, 2026-09-30');
  await fireEvent.press(screen.getByLabelText('Check list'));
  expect(await screen.findByLabelText('Save agreement records')).toBeTruthy();
});
