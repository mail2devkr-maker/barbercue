import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { uiStringsFor } from '@barbercue/shared';
import EmployeeLoginScreen from '../EmployeeLoginScreen';
import { useAuth } from '../../lib/auth-context';

jest.mock('../../lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../components/ui', () => {
  const { createElement } = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  return {
    BrandLockup: () => null,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    PremiumButton: ({ title, onPress, loading }: { title: string; onPress: () => void; loading?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled: loading },
        createElement(Text, null, title)),
    PremiumScreen: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    PremiumSectionHeader: ({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) =>
      createElement(View, null, createElement(Text, null, eyebrow), createElement(Text, null, title), createElement(Text, null, subtitle)),
    PremiumTextField: (props: React.ComponentProps<typeof TextInput>) => createElement(TextInput, props),
  };
});

const employeeLoginMock = jest.fn();
const english = uiStringsFor('EN');

describe('EmployeeLoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({ employeeLogin: employeeLoginMock });
    employeeLoginMock.mockResolvedValue(undefined);
  });

  it('exposes the employee sign-in CTA and submits validated Employee ID credentials', async () => {
    await render(<EmployeeLoginScreen />);
    await fireEvent.changeText(screen.getByLabelText(english.employeeCodeLabel), 'fq-fe-00101');
    await fireEvent.changeText(screen.getByLabelText(english.employeePasswordLabel), 'valid-password');
    await fireEvent.press(screen.getByRole('button', { name: english.signInTitle }));

    await waitFor(() => expect(employeeLoginMock).toHaveBeenCalledWith({
      employeeCode: 'FQ-FE-00101',
      password: 'valid-password',
    }));
  });

  it('shows schema validation without making an authentication request', async () => {
    await render(<EmployeeLoginScreen />);
    await fireEvent.press(screen.getByRole('button', { name: english.signInTitle }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(employeeLoginMock).not.toHaveBeenCalled();
  });

  it('does not expose server authentication details in the signed-out UI', async () => {
    employeeLoginMock.mockRejectedValueOnce(new Error('employee exists but is deactivated'));
    await render(<EmployeeLoginScreen />);
    await fireEvent.changeText(screen.getByLabelText(english.employeeCodeLabel), 'FQ-FE-00101');
    await fireEvent.changeText(screen.getByLabelText(english.employeePasswordLabel), 'valid-password');
    await fireEvent.press(screen.getByRole('button', { name: english.signInTitle }));

    expect(await screen.findByRole('alert')).toHaveTextContent(english.couldNotSignIn);
    expect(screen.queryByText(/deactivated/)).toBeNull();
  });
});
