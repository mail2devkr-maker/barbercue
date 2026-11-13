import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  TextInput,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

/** Space kept between the focused field and the top of the keyboard. */
export const KEYBOARD_FIELD_GAP = 24;

/**
 * How far a scroll view must move so a field whose bottom edge is at `fieldBottom` (window
 * coordinates) sits `gap` above a keyboard whose top edge is at `keyboardTop`. Never negative:
 * a field that is already visible is never scrolled.
 */
export function keyboardOverlap(fieldBottom: number, keyboardTop: number, gap = KEYBOARD_FIELD_GAP): number {
  const overlap = fieldBottom + gap - keyboardTop;
  return overlap > 0 ? Math.ceil(overlap) : 0;
}

/** The keyboard's top edge in window coordinates, on both platforms. */
export function keyboardTopFrom(event: KeyboardEvent, windowHeight = Dimensions.get('window').height): number {
  const { screenY, height } = event.endCoordinates;
  if (Platform.OS === 'ios' && typeof screenY === 'number' && screenY > 0) return screenY;
  // Android draws edge-to-edge (SDK 57): the keyboard rises from the bottom of the window.
  return Math.max(0, windowHeight - height);
}

interface FocusedHost {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

/**
 * Owner-reported (13 Nov, Android + iOS): opening the keyboard left the field you were typing in
 * hidden behind it. This makes any scroll view keyboard-aware without a new native dependency:
 *  - Android: while the keyboard is open, `bottomInset` adds that much scrollable space at the end
 *    of the content (iOS gets the same from `automaticallyAdjustKeyboardInsets`), so even the last
 *    field on a page can be lifted above the keyboard;
 *  - both: once the keyboard is up, the focused field is measured and the page scrolls just enough
 *    to show it above the keyboard. A field that is already visible is never moved.
 * Spread `scrollProps` on the ScrollView and add `bottomInset` to its content's paddingBottom.
 * Pass `{ padAndroid: false }` when the scroll view already sits in a KeyboardAvoidingView on
 * Android (Screen / PremiumScreen), so the keyboard's height is never counted twice.
 */
export function useKeyboardAwareScroll({ padAndroid = true }: { padAndroid?: boolean } = {}): {
  scrollRef: RefObject<ScrollView | null>;
  bottomInset: number;
  scrollProps: {
    ref: RefObject<ScrollView | null>;
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    scrollEventThrottle: number;
  };
} {
  const scrollRef = useRef<ScrollView | null>(null);
  const offsetRef = useRef(0);
  const [bottomInset, setBottomInset] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reveal = (event: KeyboardEvent) => {
      if (Platform.OS === 'android' && padAndroid) setBottomInset(event.endCoordinates.height);
      if (timer) clearTimeout(timer);
      // Wait one layout pass so the extra inset (Android) / adjusted insets (iOS) are applied.
      timer = setTimeout(() => {
        const focused = TextInput.State.currentlyFocusedInput?.() as FocusedHost | null | undefined;
        if (!focused?.measureInWindow || !scrollRef.current) return;
        const keyboardTop = keyboardTopFrom(event);
        focused.measureInWindow((_x, y, _w, h) => {
          const delta = keyboardOverlap(y + h, keyboardTop);
          if (delta > 0) scrollRef.current?.scrollTo({ y: offsetRef.current + delta, animated: true });
        });
      }, Platform.OS === 'android' ? 120 : 60);
    };
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvent, reveal);
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      if (timer) clearTimeout(timer);
      setBottomInset(0);
    });
    return () => {
      if (timer) clearTimeout(timer);
      show.remove();
      hide.remove();
    };
  }, [padAndroid]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = event.nativeEvent.contentOffset.y;
  };

  return { scrollRef, bottomInset, scrollProps: { ref: scrollRef, onScroll, scrollEventThrottle: 16 } };
}
