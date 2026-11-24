import { useRealInsets } from './TopBrandBar';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { font, fontSize, radius, space } from '../lib/theme';
import { useThemedStyles, type ThemeTokens } from '../lib/theme-mode';

export interface AppMenuItem {
  key: string;
  label: string;
  onPress: () => void;
}

export interface AppMenuSection {
  title: string;
  items: AppMenuItem[];
}

/**
 * The "☰ Menu" sheet (owner request: every page one tap away, like a shopping app's menu tab).
 * Pure React Native (Modal + ScrollView), so it ships over the air with no native dependency.
 * Each item closes the sheet first, then navigates.
 */
export function AppMenuSheet({
  visible,
  onClose,
  title,
  sections,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sections: AppMenuSection[];
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useRealInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
        <View style={[styles.sheet, { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[3] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close menu" style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {sections
              .filter((s) => s.items.length > 0)
              .map((section) => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.items.map((item) => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                      onPress={() => {
                        onClose();
                        item.onPress();
                      }}
                    >
                      <Text style={styles.itemText}>{item.label}</Text>
                      <Text style={styles.chevron}>›</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = ({ fastQue }: ThemeTokens) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row' },
    sheet: { width: '84%', maxWidth: 380, backgroundColor: fastQue.background, borderRightWidth: 1, borderRightColor: fastQue.border },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingBottom: space[3], borderBottomWidth: 1, borderBottomColor: fastQue.border },
    title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
    close: { padding: space[1] },
    closeText: { fontSize: fontSize.lg, color: fastQue.textSecondary },
    list: { paddingHorizontal: space[3], paddingBottom: space[5] },
    section: { marginTop: space[4] },
    sectionTitle: { fontFamily: font.bodyBold, fontSize: fontSize.xs, letterSpacing: 1.1, textTransform: 'uppercase', color: fastQue.textMuted, marginBottom: space[1], paddingHorizontal: space[2] },
    item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[3], paddingHorizontal: space[2], borderRadius: radius.md, minHeight: 48 },
    itemPressed: { backgroundColor: fastQue.card },
    itemText: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: fastQue.text, flex: 1 },
    chevron: { fontSize: fontSize.lg, color: fastQue.textMuted, marginLeft: space[2] },
  });
