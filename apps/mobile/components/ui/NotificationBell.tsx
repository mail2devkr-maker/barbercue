import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize } from '../../lib/theme';

/**
 * Issue 7 (mobile stabilization mission) — a directly-visible entry point to the existing
 * NotificationsScreen, so an owner/staff/customer doesn't have to already know to drill into
 * Account first. Native-drawn (matches TabIcon's own reasoning: no font-glyph dependency), badge
 * count capped the same way the Account tab's own tabBarBadge already is.
 */
export function NotificationBell({ unreadCount, onPress }: { unreadCount: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      style={styles.button}
    >
      <View style={styles.bellShape}>
        <View style={styles.bellBody} />
        <View style={styles.bellClapper} />
      </View>
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  bellShape: { width: 20, height: 20, alignItems: 'center' },
  bellBody: {
    width: 16,
    height: 14,
    borderWidth: 2,
    borderColor: color.ink,
    borderBottomWidth: 0,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
  },
  bellClapper: { width: 6, height: 3, borderRadius: 2, backgroundColor: color.ink, marginTop: 1 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontFamily: font.bodyBold, fontSize: 9 },
});
