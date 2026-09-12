import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fastQue, font, fontSize, lineHeightFor, premiumShadow, radius, space } from '../../lib/theme';
import { GradientView } from './GradientView';

export function PremiumScreen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[7] };
  if (!scroll) return <View style={[styles.screen, padding, contentStyle]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={fastQue.pink} colors={[fastQue.pink]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function PremiumCard({ children, style, strong = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean }) {
  return <View style={[styles.card, strong && styles.cardStrong, style]}>{children}</View>;
}

export function PremiumSectionHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function PremiumButton({ title, onPress, variant = 'primary', loading, disabled, style }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'quiet'; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const inactive = Boolean(loading || disabled);
  const content = loading ? <ActivityIndicator color={fastQue.text} /> : <Text style={[styles.buttonText, variant !== 'primary' && styles.secondaryButtonText]}>{title}</Text>;
  return (
    <Pressable onPress={onPress} disabled={inactive} accessibilityRole="button" style={({ pressed }) => [styles.buttonHit, inactive && styles.disabled, pressed && styles.pressed, style]}>
      {variant === 'primary' ? (
        <GradientView colors={[fastQue.gradientStart, fastQue.gradientMid, fastQue.gradientEnd]} stops={[0, 0.55, 1]} style={styles.primaryButton}>
          {content}
        </GradientView>
      ) : (
        <View style={[styles.secondaryButton, variant === 'quiet' && styles.quietButton]}>{content}</View>
      )}
    </Pressable>
  );
}

export function PremiumTextField(props: TextInputProps) {
  return <TextInput {...props} style={[styles.field, props.style]} placeholderTextColor={fastQue.textMuted} selectionColor={fastQue.pink} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: fastQue.background },
  content: { flexGrow: 1, paddingHorizontal: space[4] },
  card: { backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.lg, padding: space[4], ...premiumShadow },
  cardStrong: { backgroundColor: fastQue.cardStrong, borderColor: fastQue.borderStrong },
  heading: { marginBottom: space[4] },
  eyebrow: { color: fastQue.orange, fontFamily: font.bodyBold, fontSize: 11, lineHeight: lineHeightFor(11), letterSpacing: 1.7, textTransform: 'uppercase', marginBottom: space[1] },
  title: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl) },
  subtitle: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), marginTop: space[1] },
  buttonHit: { minHeight: 52, borderRadius: radius.md, overflow: 'hidden' },
  primaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingHorizontal: space[4] },
  secondaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.borderStrong, backgroundColor: fastQue.glassStrong, paddingHorizontal: space[4] },
  quietButton: { borderColor: fastQue.border, backgroundColor: 'transparent' },
  buttonText: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base) },
  secondaryButtonText: { color: fastQue.textSecondary },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.82 },
  field: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border, backgroundColor: fastQue.input, color: fastQue.text, paddingHorizontal: space[3], fontFamily: font.bodyRegular, fontSize: fontSize.base },
});
