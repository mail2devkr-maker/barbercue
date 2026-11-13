import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Role, type SalonStaffDto } from '@barbercue/shared';
import { canPermanentlyDelete, PermanentDeletePanel, StaffManageActions } from '../StaffAdmin';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../ui', () => {
  const { Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled, accessibilityState: { disabled: !!disabled } }, createElement(Text, null, title)),
  };
});

const member = { id: 'st1', displayName: 'Staff 1', phone: null, email: 'staff1@example.test', roleInSalon: 'BARBER', status: 'ACTIVE', hasPassword: false, accessRevoked: false, bio: null, photoUrl: null, yearsExperience: null } as unknown as SalonStaffDto;
const fetchMock = apiFetch as jest.Mock;
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue({}); });

it('only owners and platform admins may permanently delete (same rule as the website)', () => {
  expect(canPermanentlyDelete([Role.SALON_OWNER])).toBe(true);
  expect(canPermanentlyDelete([Role.CO_FOUNDER])).toBe(false);
  expect(canPermanentlyDelete([Role.SALON_STAFF])).toBe(false);
  expect(canPermanentlyDelete(undefined)).toBe(false);
});

it('marks a staff member not working, resends the invitation, and removes access only after confirming', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
  const onChanged = jest.fn();
  await render(<StaffManageActions salonId="s1" member={member} language={'EN' as never} canDelete={false} onChanged={onChanged} />);
  await fireEvent(screen.getByLabelText('Staff 1 working'), 'valueChange', false);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/staff/st1', { method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE' }) }));
  fetchMock.mockResolvedValueOnce({ staff: member, invitationSent: true, inviteUrl: null });
  await fireEvent.press(screen.getByLabelText('Resend invitation'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/staff/st1/resend-invite', { method: 'POST' }));
  await fireEvent.press(screen.getByLabelText('Remove access'));
  expect(alert).toHaveBeenCalled();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/staff/st1/access/revoke', { method: 'POST', body: '{}' }));
  expect(screen.queryByLabelText('Delete permanently')).toBeNull(); // not offered without permission
  alert.mockRestore();
});

it('permanent delete: preview first, Confirm stays disabled until the exact name AND the acknowledgement, then sends the single-use token', async () => {
  fetchMock.mockImplementation(async (path: string) => path.endsWith('/deletion-preview')
    ? { kind: 'staff', target: { id: 'st1', name: 'Staff 1', status: 'ACTIVE' }, salon: { id: 's1', name: 'Shop' }, deletable: true, blockers: [], effects: ['Removes the roster entry'], confirmName: 'Staff 1', alternative: null, token: 'tok_'.padEnd(30, 'x') }
    : { deleted: true });
  const onDeleted = jest.fn();
  await render(<PermanentDeletePanel kind="staff" salonId="s1" targetId="st1" language={'EN' as never} onClose={jest.fn()} onDeleted={onDeleted} />);
  await screen.findByText('• Removes the roster entry');
  expect(fetchMock).toHaveBeenCalledTimes(1); // opening only previews
  const confirm = () => screen.getByLabelText('Confirm Delete');
  expect(confirm().props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Type the name to confirm'), 'Staff 1');
  expect(confirm().props.accessibilityState.disabled).toBe(true); // name alone is not enough
  await fireEvent.press(screen.getByRole('checkbox'));
  expect(confirm().props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(confirm());
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenLastCalledWith('dashboard/salons/s1/staff/st1/permanent-deletion', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'tok_'.padEnd(30, 'x'), typedName: 'Staff 1', acknowledged: true }) }));
});

it('permanent delete shows blockers and offers no Confirm when the server says it is not deletable', async () => {
  fetchMock.mockResolvedValue({ kind: 'staff', target: { id: 'st1', name: 'Staff 1', status: 'ACTIVE' }, salon: { id: 's1', name: 'Shop' }, deletable: false, blockers: [{ code: 'HAS_HISTORY', message: 'Has completed services' }], effects: [], confirmName: 'Staff 1', alternative: 'Mark them not working instead.' });
  await render(<PermanentDeletePanel kind="staff" salonId="s1" targetId="st1" language={'EN' as never} onClose={jest.fn()} onDeleted={jest.fn()} />);
  expect(await screen.findByText('• Has completed services')).toBeTruthy();
  expect(screen.getByText('Mark them not working instead.')).toBeTruthy();
  expect(screen.queryByLabelText('Confirm Delete')).toBeNull();
});
