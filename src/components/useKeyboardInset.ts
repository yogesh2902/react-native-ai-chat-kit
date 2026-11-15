import { useEffect, useState, type RefObject } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

type Measurable = {
  measure: (
    callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void,
  ) => void;
};

/**
 * Tracks the on-screen keyboard.
 *
 * - `visible`: keyboard is open (any platform). Used to drop the safe-area
 *   bottom inset, which the keyboard already covers.
 * - `overlap` (Android only): how many points of `ref`'s view the keyboard
 *   covers. Android apps are edge-to-edge since Android 15 / Expo SDK 53, so
 *   `adjustResize` no longer shrinks the window and KeyboardAvoidingView does
 *   nothing. Measuring the real overlap fixes that, and it is 0 on setups where
 *   the window *does* still resize, so space is never added twice.
 */
export function useKeyboardInset(ref: RefObject<Measurable | null>) {
  const [overlap, setOverlap] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      setVisible(true);
      if (Platform.OS !== 'android') return;
      const keyboardTop = e.endCoordinates.screenY;
      const node = ref.current;
      if (!node) {
        setOverlap(e.endCoordinates.height);
        return;
      }
      // `measure` (not measureInWindow, which subtracts the status bar on
      // Android) uses the same full-screen coordinates as `screenY`.
      node.measure((_x, _y, _width, height, _pageX, pageY) => {
        setOverlap(Math.max(0, Math.round(pageY + height - keyboardTop)));
      });
    };
    const onHide = () => {
      setVisible(false);
      setOverlap(0);
    };

    const subscriptions = [Keyboard.addListener(showEvent, onShow), Keyboard.addListener(hideEvent, onHide)];
    return () => subscriptions.forEach((s) => s.remove());
  }, [ref]);

  return { overlap, visible };
}
