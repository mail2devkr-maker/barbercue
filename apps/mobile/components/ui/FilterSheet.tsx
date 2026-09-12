import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';

interface FilterSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Accessibility label for the close control and the tap-outside backdrop. */
  closeLabel: string;
  children: ReactNode;
}

/**
 * Shared bottom-sheet chrome for the Distance/Price/Service filter dropdowns on
 * SalonSearchScreen. Built from RN's own Modal/Pressable/View only (no new native dependency, per
 * the owner's explicit ask) — `onRequestClose` gives Android hardware-back dismissal for free, and
 * the full-screen Pressable backdrop gives tap-outside dismissal.
 */
export function FilterSheet({ visible, title, onClose, closeLabel, children }: FilterSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={closeLabel} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={10} style={styles.closeButton}>
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(9,9,12,0.72)' },
  card: {
    maxHeight: '75%',
    backgroundColor: fastQue.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderBottomWidth: 0,
    paddingBottom: space[5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: fastQue.border,
  },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
  closeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: fastQue.glassStrong },
  closeGlyph: { color: fastQue.textSecondary, fontSize: 15, fontFamily: font.bodyBold },
});
