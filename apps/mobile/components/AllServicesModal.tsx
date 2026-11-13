import { FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SERVICE_CATALOG, type ServiceCatalogItem } from '../lib/service-catalog';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { SafeImage } from './ui';

/**
 * Owner report (14 Nov): "View all" under Popular Services jumped straight to search. It now opens
 * every service as a photo grid; tapping one searches shops for that service.
 */
export function AllServicesModal({
  visible,
  hindi,
  onClose,
  onPick,
}: {
  visible: boolean;
  hindi: boolean;
  onClose: () => void;
  onPick: (value: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= 600 ? 4 : 3;
  const gap = space[3];
  const tile = Math.floor((width - space[4] * 2 - gap * (columns - 1)) / columns);

  const renderItem = ({ item }: { item: ServiceCatalogItem }) => {
    const label = hindi ? item.hi : item.en;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => onPick(item.value)}
        style={[styles.tile, { width: tile }]}
        testID={`all-services-${item.value}`}
      >
        <SafeImage url={item.imageUrl} alt={label} style={[styles.image, { width: tile, height: tile }]} />
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.root, { paddingTop: insets.top + space[2] }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{hindi ? 'सभी सेवाएं' : 'All services'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={hindi ? 'बंद करें' : 'Close'} onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <FlatList
          data={SERVICE_CATALOG}
          keyExtractor={(item) => item.value}
          numColumns={columns}
          key={`cols-${columns}`}
          renderItem={renderItem}
          columnWrapperStyle={{ gap }}
          contentContainerStyle={[styles.grid, { gap, paddingBottom: insets.bottom + space[6] }]}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: fastQue.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl), color: fastQue.text },
  close: { fontFamily: font.bodyBold, fontSize: fontSize.lg, color: fastQue.text },
  grid: { paddingHorizontal: space[4] },
  tile: { alignItems: 'center' },
  image: { borderRadius: radius.lg, backgroundColor: fastQue.card },
  label: {
    marginTop: space[2],
    textAlign: 'center',
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: fastQue.text,
  },
});
