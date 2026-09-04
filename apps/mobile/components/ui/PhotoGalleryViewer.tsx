import { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { color, font, fontSize, space } from '../../lib/theme';
import { useLanguage } from '../../lib/language-context';
import { SafeImage } from './SafeImage';

export type GalleryPhoto = { id: string; url: string; altText: string | null };

/**
 * Full-screen swipe-through viewer opened by tapping a thumbnail in the horizontal photo strip —
 * the mobile equivalent of apps/web/components/salon/PhotoGallery.tsx's click-to-lightbox. Paging
 * ScrollView rather than a gesture/pinch-zoom library: a salon photo gallery only needs "swipe to
 * the next photo," and pulling in reanimated/gesture-handler for zoom would be the "unrelated
 * mobile redesign" this task explicitly isn't.
 */
export function PhotoGalleryViewer({
  photos,
  initialIndex,
  salonName,
  visible,
  onClose,
}: {
  photos: GalleryPhoto[];
  initialIndex: number;
  salonName: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(initialIndex);
  const screenWidth = Dimensions.get('window').width;
  const scrollRef = useRef<ScrollView>(null);

  const handleShow = useCallback(() => {
    setIndex(initialIndex);
    // Modal mounts its content fresh each time it opens, but the ScrollView's initial scroll
    // offset can race the layout pass on some devices — an explicit jump on the next frame is the
    // reliable way to land on the tapped photo instead of always the first one.
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: initialIndex * screenWidth, animated: false });
    });
  }, [initialIndex, screenWidth]);

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
      setIndex(Math.max(0, Math.min(photos.length - 1, next)));
    },
    [photos.length, screenWidth],
  );

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onShow={handleShow} onRequestClose={onClose}>
      <View style={styles.container} accessibilityViewIsModal>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumEnd}
        >
          {photos.map((photo) => (
            <View key={photo.id} style={[styles.page, { width: screenWidth }]}>
              <SafeImage
                url={photo.url}
                alt={photo.altText ?? salonName}
                style={styles.image}
                resizeMode="contain"
              />
            </View>
          ))}
        </ScrollView>

        <View style={styles.topBar}>
          <Text style={styles.counter}>
            {index + 1} / {photos.length}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t.closePhotoGallery}
            hitSlop={space[3]}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.ink },
  page: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  topBar: {
    position: 'absolute',
    top: space[6],
    left: space[4],
    right: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.sm,
    color: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: 999,
    overflow: 'hidden',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: { color: '#ffffff', fontSize: fontSize.base, fontFamily: font.bodySemiBold },
});
