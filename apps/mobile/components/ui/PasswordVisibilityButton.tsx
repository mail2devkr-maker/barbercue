import { Pressable, StyleSheet, Text } from 'react-native';
import { Language } from '@barbercue/shared';
import { useLanguage } from '../../lib/language-context';
import { fastQue, font, fontSize, space } from '../../lib/theme';

/**
 * Owner request (16 Nov): let people see the password they are typing. A small Show / Hide button
 * that sits inside the right end of a password field; the field passes `visible` into
 * `secureTextEntry={!visible}` and adds `PASSWORD_FIELD_PADDING` so the text never runs under it.
 * Place it inside a `position: 'relative'` wrapper around the input.
 */
export const PASSWORD_FIELD_PADDING = 76;

export function PasswordVisibilityButton({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const { language } = useLanguage();
  const hi = language === Language.HI;
  const label = visible ? (hi ? 'छिपाएँ' : 'Hide') : (hi ? 'दिखाएँ' : 'Show');
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={visible ? (hi ? 'पासवर्ड छिपाएँ' : 'Hide password') : (hi ? 'पासवर्ड दिखाएँ' : 'Show password')}
      accessibilityState={{ checked: visible }}
      style={styles.button}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { position: 'absolute', right: space[2], top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: space[2] },
  text: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink },
});
