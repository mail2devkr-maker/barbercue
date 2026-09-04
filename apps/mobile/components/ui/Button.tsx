import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';

type Variant = 'primary' | 'secondary' | 'outline';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Primary = terracotta fill (the only action color). Secondary = ink-bordered cream. Outline =
 * lighter-weight ink-bordered, for secondary/tertiary actions (resend, cancel, etc). */
export function Button({ title, onPress, variant = 'primary', loading, disabled, style }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      style={[styles.base, variantStyles[variant], isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? color.accentContrast : color.ink} />
      ) : (
        <Text style={[styles.text, textVariantStyles[variant]]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  disabled: { opacity: 0.55 },
  text: { fontFamily: font.bodyBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base) },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.ink },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.border },
});

const textVariantStyles = StyleSheet.create({
  primary: { color: color.accentContrast },
  secondary: { color: color.ink },
  outline: { color: color.ink },
});
