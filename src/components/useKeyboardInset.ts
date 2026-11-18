import { useEffect, useState, type RefObject } from 'react';
import { Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from 'react-native';

type Measurable = {
  measure: (
    callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void,
  ) => void;
};

/**
 * Tracks the on-screen keyboard.
 *
 * - `visible`: keyboard is open. Used to drop the safe-area bottom inset,
 *   which the keyboard already covers.
 * - `overlap`: how many points of `ref`'s view the keyboard covers, measured
 *   against the keyboard's real position. This replaces KeyboardAvoidingView,
 *   which leaves the input partly hidden behind iOS 26's floating keyboard, and
 *   does nothing on edge-to-edge Android. It is 0 when the window already
 *   resizes for the keyboard, so space is never added twice.
 */
export function useKeyboardInset(ref: RefObject<Measurable | null>) {
  const [overlap, setOverlap] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const ios = Platform.OS === 'ios';

    // Move the layout in step with the keyboard animation on iOS.
    const animate = (e: KeyboardEvent) => {
      if (!ios || !e.duration) return;
      LayoutAnimation.configureNext({
        duration: e.duration,
        update: { duration: e.duration, type: LayoutAnimation.Types.keyboard },
      });
    };

    const onShow = (e: KeyboardEvent) => {
      const keyboardTop = e.endCoordinates.screenY;
      const node = ref.current;
      if (!node) {
        animate(e);
        setVisible(true);
        setOverlap(e.endCoordinates.height);
        return;
      }
      // `measure` (not measureInWindow, which subtracts the status bar on
      // Android) uses the same screen coordinates as `screenY`.
      node.measure((_x, _y, _width, height, _pageX, pageY) => {
        animate(e);
        setVisible(true);
        setOverlap(Math.max(0, Math.round(pageY + height - keyboardTop)));
      });
    };
    const onHide = (e?: KeyboardEvent) => {
      if (e) animate(e);
      setVisible(false);
      setOverlap(0);
    };

    const subscriptions = ios
      ? [
          Keyboard.addListener('keyboardWillShow', onShow),
          // Height changes while open (predictive bar, emoji keyboard, dictation).
          Keyboard.addListener('keyboardWillChangeFrame', (e) => {
            if (e.endCoordinates.height > 0 && e.endCoordinates.screenY > 0) onShow(e);
          }),
          Keyboard.addListener('keyboardWillHide', onHide),
        ]
      : [Keyboard.addListener('keyboardDidShow', onShow), Keyboard.addListener('keyboardDidHide', onHide)];
    return () => subscriptions.forEach((s) => s.remove());
  }, [ref]);

  return { overlap, visible };
}
