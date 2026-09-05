import { StyleSheet, View } from 'react-native';

export type TabIconName = 'home' | 'search' | 'bookings' | 'queue' | 'shop' | 'account' | 'today' | 'offer';

interface TabIconProps {
  name: TabIconName;
  color: string;
  size?: number;
}

/**
 * Native-drawn tab icons: deliberately composed from React Native views instead of text glyphs
 * or a font file, so Android release builds cannot render the square/missing-glyph fallback that
 * was observed on device. Navigation supplies the accessible tab label; these shapes are purely
 * visual and are hidden from the screen-reader tree.
 */
export function TabIcon({ name, color, size = 22 }: TabIconProps) {
  const stroke = Math.max(1.5, Math.round(size * 0.1));
  const base = { width: size, height: size };

  switch (name) {
    case 'home':
      return (
        <View style={[styles.icon, base]} accessible={false}>
          <View style={[styles.homeRoof, { borderLeftWidth: size * 0.36, borderRightWidth: size * 0.36, borderBottomWidth: size * 0.34, borderBottomColor: color }]} />
          <View style={[styles.homeBody, { width: size * 0.62, height: size * 0.47, borderColor: color, borderWidth: stroke }]} />
          <View style={[styles.homeDoor, { width: size * 0.15, height: size * 0.25, backgroundColor: color }]} />
        </View>
      );
    case 'search':
      return (
        <View style={[styles.icon, base]} accessible={false}>
          <View style={[styles.searchCircle, { width: size * 0.6, height: size * 0.6, borderColor: color, borderWidth: stroke }]} />
          <View style={[styles.searchHandle, { width: size * 0.4, height: stroke, right: size * 0.02, bottom: size * 0.14, backgroundColor: color }]} />
        </View>
      );
    case 'bookings':
      return (
        <View style={[styles.icon, base]} accessible={false}>
          <View style={[styles.calendar, { width: size * 0.76, height: size * 0.72, borderColor: color, borderWidth: stroke }]}>
            <View style={[styles.calendarTop, { backgroundColor: color, height: stroke }]} />
            <View style={styles.calendarRows}>
              <View style={[styles.calendarDot, { backgroundColor: color }]} />
              <View style={[styles.calendarDot, { backgroundColor: color }]} />
              <View style={[styles.calendarDot, { backgroundColor: color }]} />
              <View style={[styles.calendarDot, { backgroundColor: color }]} />
            </View>
          </View>
        </View>
      );
    case 'queue':
      return (
        <View style={[styles.icon, base]} accessible={false}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={[styles.queueRow, { top: size * (0.18 + row * 0.27) }]}>
              <View style={[styles.queueDot, { width: stroke * 1.5, height: stroke * 1.5, backgroundColor: color }]} />
              <View style={[styles.queueLine, { height: stroke, backgroundColor: color }]} />
            </View>
          ))}
        </View>
      );
    case 'shop':
      return (
        <View style={[styles.icon, base]} accessible={false}>
          <View style={[styles.shopAwning, { width: size * 0.82, height: size * 0.22, borderColor: color, borderWidth: stroke }]} />
          <View style={[styles.shopBody, { width: size * 0.68, height: size * 0.48, borderColor: color, borderWidth: stroke }]} />
          <View style={[styles.shopDoor, { width: size * 0.16, height: size * 0.28, borderColor: color, borderWidth: stroke }]} />
        </View>
      );
    case 'today':
      return (
        <View style={[styles.icon, base]} accessible={false}>
          <View style={[styles.calendar, { width: size * 0.76, height: size * 0.72, borderColor: color, borderWidth: stroke }]}>
            <View style={[styles.calendarTop, { backgroundColor: color, height: stroke }]} />
            <View style={[styles.todayCheck, { borderColor: color, borderBottomWidth: stroke, borderRightWidth: stroke }]} />
          </View>
        </View>
      );
    case 'account':
      return (
        <View style={[styles.icon, base]} accessible={false}>
          <View style={[styles.accountHead, { width: size * 0.36, height: size * 0.36, borderColor: color, borderWidth: stroke }]} />
          <View style={[styles.accountShoulders, { width: size * 0.72, height: size * 0.36, borderColor: color, borderWidth: stroke }]} />
        </View>
      );
    case 'offer':
      return (
        <View style={[styles.icon, base, { transform: [{ rotate: '-45deg' }] }]} accessible={false}>
          <View
            style={[
              styles.offerTag,
              { width: size * 0.62, height: size * 0.5, borderColor: color, borderWidth: stroke },
            ]}
          >
            <View style={[styles.offerHole, { width: stroke * 1.6, height: stroke * 1.6, borderRadius: stroke, backgroundColor: color }]} />
          </View>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
  homeRoof: { position: 'absolute', top: 1, width: 0, height: 0, borderTopWidth: 0, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  homeBody: { position: 'absolute', bottom: 1, borderRadius: 2 },
  homeDoor: { position: 'absolute', bottom: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  searchCircle: { position: 'absolute', top: 1, left: 1, borderRadius: 999 },
  searchHandle: { position: 'absolute', borderRadius: 999, transform: [{ rotate: '45deg' }] },
  calendar: { borderRadius: 3, justifyContent: 'flex-start', overflow: 'hidden' },
  calendarTop: { width: '100%' },
  calendarRows: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'space-evenly', gap: 2, paddingHorizontal: 2 },
  calendarDot: { width: 3, height: 3, borderRadius: 99 },
  queueRow: { position: 'absolute', left: '10%', width: '80%', flexDirection: 'row', alignItems: 'center', gap: 3 },
  queueDot: { borderRadius: 99 },
  queueLine: { flex: 1, borderRadius: 99 },
  shopAwning: { position: 'absolute', top: 2, borderRadius: 2 },
  shopBody: { position: 'absolute', bottom: 1, borderRadius: 2 },
  shopDoor: { position: 'absolute', bottom: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  todayCheck: { position: 'absolute', width: '42%', height: '22%', top: '47%', left: '26%', transform: [{ rotate: '45deg' }] },
  accountHead: { position: 'absolute', top: 1, borderRadius: 999 },
  accountShoulders: { position: 'absolute', bottom: 1, borderTopLeftRadius: 999, borderTopRightRadius: 999, borderBottomWidth: 0 },
  offerTag: { borderRadius: 3, alignItems: 'flex-end', justifyContent: 'flex-start', padding: 2 },
  offerHole: {},
});
