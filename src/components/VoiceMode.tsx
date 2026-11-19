import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { toSpeakableText } from '../markdown/plainText';
import { fontStyle, useChatTheme, withAlpha } from '../theme';
import { getMessageText, type ChatMessage } from '../types';
import { useReducedMotion } from './animations';
import type { SpeechRecognizer, TextToSpeech } from './customization';

export type VoiceModeState = 'listening' | 'thinking' | 'speaking' | 'paused';

export type VoiceModeProps = {
  visible: boolean;
  onClose: () => void;
  voice: SpeechRecognizer;
  speech: TextToSpeech;
  /** `send` from useChat. */
  send: (text: string) => void;
  messages: ChatMessage[];
  isStreaming?: boolean;
  /** `stop` from useChat: interrupting while the answer is still being written stops it. */
  stop?: () => void;
  /** Called on state changes (e.g. for haptics). */
  onStateChange?: (state: VoiceModeState) => void;
};

/**
 * Hands-free conversation: listens, sends what you said when you stop talking,
 * reads the answer aloud, then listens again. Tap the orb to interrupt or pause.
 */
export function VoiceMode({ visible, onClose, voice, speech, send, messages, isStreaming, stop, onStateChange }: VoiceModeProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  const [state, setStateRaw] = useState<VoiceModeState>('paused');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const waitingFor = useRef<number | null>(null); // message count when we sent, to spot the reply
  const emptyTries = useRef(0);

  const setState = useCallback(
    (next: VoiceModeState) => {
      stateRef.current = next;
      setStateRaw(next);
      onStateChange?.(next);
    },
    [onStateChange],
  );

  const listen = useCallback(async () => {
    if (!visibleRef.current) return;
    setError(null);
    setHeard('');
    setState('listening');
    let final = '';
    try {
      await voice.start({
        onPartial: (t) => setHeard(t),
        onFinal: (t) => {
          final = t;
          setHeard(t);
        },
        onError: (e) => setError(e.message),
        onEnd: () => {
          if (!visibleRef.current || stateRef.current !== 'listening') return;
          const text = final.trim();
          if (!text) {
            // Nothing heard: try again a couple of times, then wait for a tap.
            emptyTries.current += 1;
            if (emptyTries.current < 3) void listenRef.current();
            else setState('paused');
            return;
          }
          emptyTries.current = 0;
          waitingFor.current = messagesRef.current.length;
          setState('thinking');
          send(text);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.voiceFailed);
      setState('paused');
    }
  }, [voice, send, setState, labels.voiceFailed]);
  const listenRef = useRef(listen);
  listenRef.current = listen;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // When the reply is finished, read it aloud, then listen again.
  useEffect(() => {
    if (stateRef.current !== 'thinking' || waitingFor.current === null || isStreaming) return;
    const reply = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!reply || messages.length <= waitingFor.current || reply.status === 'streaming') return;
    waitingFor.current = null;
    const text = toSpeakableText(getMessageText(reply));
    if (!text) {
      void listenRef.current();
      return;
    }
    setState('speaking');
    speech.speak(text, {
      onDone: () => {
        if (visibleRef.current && stateRef.current === 'speaking') void listenRef.current();
      },
    });
  }, [messages, isStreaming, speech, setState]);

  // Start listening when opened; clean everything up when closed.
  useEffect(() => {
    if (!visible) return;
    emptyTries.current = 0;
    void listenRef.current();
    return () => {
      voice.abort?.();
      speech.stop();
      waitingFor.current = null;
      stateRef.current = 'paused';
    };
  }, [visible, voice, speech]);

  const onOrbPress = () => {
    const s = stateRef.current;
    if (s === 'listening') void voice.stop(); // send what was said so far
    else if (s === 'speaking') {
      speech.stop();
      void listen();
    } else if (s === 'thinking') {
      stop?.();
      waitingFor.current = null;
      void listen();
    } else {
      emptyTries.current = 0;
      void listen();
    }
  };

  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant');
  const caption =
    state === 'listening'
      ? heard || labels.listening
      : state === 'thinking'
        ? heard
        : state === 'speaking'
          ? lastLines(toSpeakableText(lastReply ? getMessageText(lastReply) : ''))
          : labels.tapToTalk;
  const status = state === 'listening' ? labels.listening : state === 'thinking' ? labels.thinking : state === 'speaking' ? labels.speaking : labels.voicePaused;
  const hint = state === 'listening' ? labels.tapToSend : state === 'speaking' || state === 'thinking' ? labels.tapToInterrupt : labels.tapToTalk;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background }]} accessibilityViewIsModal>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.status, { color: colors.textMuted }, fontStyle(theme, 'bold')]}>
          {status}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${status}. ${hint}`}
          onPress={onOrbPress}
          style={styles.orbWrap}
        >
          <Orb state={state} color={colors.accent} />
        </Pressable>
        <Text numberOfLines={4} style={[styles.caption, { color: colors.text, fontSize: theme.fontSize * 1.1, lineHeight: theme.fontSize * 1.6 }, fontStyle(theme)]}>
          {caption}
        </Text>
        {error ? <Text style={[styles.error, { color: colors.danger }, fontStyle(theme)]}>{error}</Text> : null}
        <Text style={[styles.hint, { color: colors.textMuted }, fontStyle(theme)]}>{hint}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.endVoice}
          onPress={onClose}
          style={({ pressed }) => [styles.end, { backgroundColor: colors.danger, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={styles.endText}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function lastLines(text: string): string {
  return text.length > 220 ? `…${text.slice(-220)}` : text;
}

/** A soft orb: breathes while listening, pulses while thinking, ripples while speaking. */
function Orb({ state, color }: { state: VoiceModeState; color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || state === 'paused') {
      scale.setValue(1);
      ring.setValue(0);
      return;
    }
    const native = Platform.OS !== 'web';
    const speed = state === 'listening' ? 900 : state === 'thinking' ? 500 : 650;
    const to = state === 'listening' ? 1.12 : state === 'thinking' ? 1.05 : 1.18;
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: to, duration: speed, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(scale, { toValue: 1, duration: speed, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ]),
    );
    const ripple = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: native }));
    breathe.start();
    if (state === 'speaking' || state === 'listening') ripple.start();
    return () => {
      breathe.stop();
      ripple.stop();
      ring.setValue(0);
    };
  }, [state, reduced, scale, ring]);
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
  return (
    <View style={styles.orbArea}>
      <Animated.View style={[styles.ring, { borderColor: color, opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
      <Animated.View style={[styles.orb, { backgroundColor: withAlpha(color, state === 'paused' ? 0.35 : 0.9), transform: [{ scale }] }]}>
        <View style={[styles.orbCore, { backgroundColor: withAlpha('#FFFFFF', 0.22) }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  status: { position: 'absolute', top: Platform.OS === 'ios' ? 70 : 40, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  orbWrap: { marginBottom: 36 },
  orbArea: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 3 },
  orb: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  orbCore: { width: 70, height: 70, borderRadius: 35 },
  caption: { textAlign: 'center', minHeight: 80 },
  error: { textAlign: 'center', marginTop: 8, fontSize: 13 },
  hint: { position: 'absolute', bottom: 130, fontSize: 13, textAlign: 'center' },
  end: { position: 'absolute', bottom: 50, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  endText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
});
