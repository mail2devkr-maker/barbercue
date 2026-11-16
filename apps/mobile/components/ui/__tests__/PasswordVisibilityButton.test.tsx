import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Language } from '@barbercue/shared';
import { PASSWORD_FIELD_PADDING, PasswordVisibilityButton } from '../PasswordVisibilityButton';

let mockLanguage: string = 'EN';
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: mockLanguage }) }));

function Field() {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <TextInput testID="pw" secureTextEntry={!visible} defaultValue="secret" style={{ paddingRight: PASSWORD_FIELD_PADDING }} />
      <PasswordVisibilityButton visible={visible} onToggle={() => setVisible((v) => !v)} />
    </View>
  );
}

describe('PasswordVisibilityButton', () => {
  beforeEach(() => { mockLanguage = 'EN'; });

  it('shows the password on Show and hides it again on Hide', async () => {
    await render(<Field />);
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);
    expect(screen.getByText('Hide')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Hide password'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
    expect(screen.getByText('Show')).toBeTruthy();
  });

  it('is labelled in Hindi for Hindi users', async () => {
    mockLanguage = Language.HI;
    await render(<Field />);
    expect(screen.getByText('दिखाएँ')).toBeTruthy();
    expect(screen.getByLabelText('पासवर्ड दिखाएँ')).toBeTruthy();
  });
});
