import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme } from '../theme';
import type { ChatAttachment } from '../types';
import type {
  AttachmentPickers,
  SendButtonRenderProps,
  SpeechRecognizer,
  StopButtonRenderProps,
} from './customization';

export type ComposerProps = {
  onSend: (text: string, options?: { attachments?: ChatAttachment[] }) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Extra bottom padding, e.g. the safe-area inset. */
  bottomInset?: number;
  inputProps?: Omit<TextInputProps, 'value' | 'onChangeText'>;
  /** Rendered left of the input, after the attach button. */
  accessoryLeft?: React.ReactNode;
  /** Rendered right of the input, before the send button. */
  accessoryRight?: React.ReactNode;
  /** Replace the send button. Call `onPress` to send. */
  renderSendButton?: (props: SendButtonRenderProps) => React.ReactNode;
  /** Replace the stop button shown while a reply streams. */
  renderStopButton?: (props: StopButtonRenderProps) => React.ReactNode;
  /** Outer area (padding, background, top border). */
  style?: StyleProp<ViewStyle>;
  /** The rounded box around the input and buttons. */
  boxStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;

  /** Enables the attach button. See createExpoAttachmentPickers. */
  attachments?: AttachmentPickers;
  /** Max attachments per message. Default 5. */
  maxAttachments?: number;
  /** Enables the mic button (speech-to-text). See createExpoSpeechRecognizer / createWebSpeechRecognizer. */
  voice?: SpeechRecognizer;
  /** Send automatically when the user stops speaking. Default false (text lands in the input to review). */
  autoSendVoice?: boolean;
  /** Put the composer in edit mode: fills the input with `text` and shows an "Editing" banner. Change `key` to start a new edit. */
  editing?: { key: string; text: string } | null;
  onCancelEdit?: () => void;
};

const formatBytes = (n?: number) =>
  n === undefined ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function Composer({
  onSend,
  onStop,
  isStreaming,
  placeholder,
  disabled,
  bottomInset = 0,
  inputProps,
  accessoryLeft,
  accessoryRight,
  renderSendButton,
  renderStopButton,
  style,
  boxStyle,
  inputStyle,
  attachments: pickers,
  maxAttachments = 5,
  voice,
  autoSendVoice = false,
  editing,
  onCancelEdit,
}: ComposerProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  const [text, setText] = useState('');
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const baseTextRef = useRef('');
  const finalTextRef = useRef<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSend = !disabled && !isStreaming && !picking && !listening && (text.trim().length > 0 || pending.length > 0);

  const showError = (message: string) => {
    setError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 5000);
  };
  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  // Entering edit mode loads the message into the input.
  const editKey = editing?.key;
  useEffect(() => {
    if (editing) setText(editing.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey]);

  const submit = (value = text) => {
    if (disabled || isStreaming || picking) return;
    if (!value.trim() && pending.length === 0) return;
    onSend(value, pending.length ? { attachments: pending } : undefined);
    setText('');
    setPending([]);
  };

  // ---- Attachments ----
  const pickerOptions = [
    pickers?.pickImages && { key: 'images', label: labels.photos, icon: '🖼', run: pickers.pickImages },
    pickers?.takePhoto && { key: 'camera', label: labels.camera, icon: '📷', run: pickers.takePhoto },
    pickers?.pickDocuments && { key: 'files', label: labels.files, icon: '📄', run: pickers.pickDocuments },
  ].filter(Boolean) as { key: string; label: string; icon: string; run: () => Promise<ChatAttachment[]> }[];

  const runPicker = async (run: () => Promise<ChatAttachment[]>) => {
    setMenuOpen(false);
    if (pending.length >= maxAttachments) return showError(labels.maxAttachments(maxAttachments));
    setPicking(true);
    try {
      const picked = await run();
      if (picked.length) {
        setPending((prev) => {
          const room = maxAttachments - prev.length;
          if (picked.length > room) showError(labels.attachmentsSkipped(maxAttachments));
          return [...prev, ...picked.slice(0, Math.max(0, room))];
        });
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : labels.attachFailed);
    } finally {
      setPicking(false);
    }
  };

  const onAttachPress = () => {
    const only = pickerOptions[0];
    if (pickerOptions.length === 1 && only) void runPicker(only.run);
    else setMenuOpen((v) => !v);
  };

  // ---- Voice ----
  const startListening = async () => {
    if (!voice || listening) return;
    setMenuOpen(false);
    baseTextRef.current = text.trim() ? `${text.trim()} ` : '';
    finalTextRef.current = null;
    setListening(true);
    try {
      await voice.start({
        onPartial: (t) => setText(baseTextRef.current + t),
        onFinal: (t) => {
          finalTextRef.current = baseTextRef.current + t;
          setText(finalTextRef.current);
        },
        onError: (e) => showError(e.message),
        onEnd: () => {
          setListening(false);
          const final = finalTextRef.current;
          if (autoSendVoice && final && final.trim()) submit(final);
        },
      });
    } catch (e) {
      setListening(false);
      showError(e instanceof Error ? e.message : labels.voiceFailed);
    }
  };
  const stopListening = () => void voice?.stop();

  // Stop the recognizer if the composer unmounts mid-dictation.
  useEffect(() => () => voice?.abort?.(), [voice]);

  const regular = fontStyle(theme);
  const showMic = !!voice && !isStreaming && !listening && text.trim().length === 0 && pending.length === 0;

  let actionButton: React.ReactNode;
  if (isStreaming && onStop) {
    actionButton = renderStopButton ? (
      renderStopButton({ onPress: onStop })
    ) : (
      <Pressable accessibilityRole="button" accessibilityLabel={labels.stopGenerating} onPress={onStop} style={[styles.button, { backgroundColor: colors.accent }]}>
        <View style={[styles.stopIcon, { backgroundColor: colors.onAccent }]} />
      </Pressable>
    );
  } else if (listening) {
    actionButton = (
      <Pressable accessibilityRole="button" accessibilityLabel={labels.stopListening} onPress={stopListening} style={[styles.button, { backgroundColor: colors.danger }]}>
        <PulsingDot />
      </Pressable>
    );
  } else if (showMic) {
    actionButton = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.voiceInput}
        onPress={startListening}
        style={({ pressed }) => [styles.button, { backgroundColor: colors.accent, opacity: pressed ? 0.7 : 1 }]}
      >
        <MicIcon color={colors.onAccent} />
      </Pressable>
    );
  } else if (renderSendButton) {
    actionButton = renderSendButton({ onPress: () => submit(), disabled: !canSend });
  } else {
    actionButton = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.sendMessage}
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={() => submit()}
        style={[styles.button, { backgroundColor: colors.accent, opacity: canSend ? 1 : 0.3 }]}
      >
        <Text style={[styles.arrow, { color: colors.onAccent }]}>↑</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.wrap, { paddingBottom: 10 + bottomInset, borderTopColor: colors.border, backgroundColor: colors.background }, style]}>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.danger }, regular]}>
          {error}
        </Text>
      ) : null}

      {editing ? (
        <View style={[styles.editBanner, { borderColor: colors.border }]}>
          <Text style={[{ color: colors.textMuted, fontSize: 13 }, fontStyle(theme, 'bold')]}>✎ {labels.editing}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.cancelEdit}
            hitSlop={8}
            onPress={() => {
              setText('');
              onCancelEdit?.();
            }}
          >
            <Text style={[{ color: colors.accent, fontSize: 13 }, fontStyle(theme, 'bold')]}>{labels.cancelEdit}</Text>
          </Pressable>
        </View>
      ) : null}

      {menuOpen ? (
        <View style={[styles.menu, { backgroundColor: colors.inputBackground, borderColor: colors.border, borderRadius: theme.radius * 0.7 }]}>
          {pickerOptions.map((o) => (
            <Pressable
              key={o.key}
              accessibilityRole="button"
              accessibilityLabel={labels.attachFrom(o.label)}
              onPress={() => void runPicker(o.run)}
              style={({ pressed }) => [styles.menuItem, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={styles.menuIcon}>{o.icon}</Text>
              <Text style={[{ color: colors.text, fontSize: 14 }, regular]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.box, { backgroundColor: colors.inputBackground, borderColor: colors.border, borderRadius: theme.radius + 4 }, boxStyle]}>
        {pending.length > 0 || picking ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previews} contentContainerStyle={styles.previewsContent}>
            {pending.map((a) => (
              <View key={a.id} style={styles.previewItem}>
                {a.kind === 'image' ? (
                  <Image source={{ uri: a.uri }} style={[styles.thumb, { borderRadius: 10 }]} accessibilityLabel={a.name} />
                ) : (
                  <View style={[styles.fileChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={styles.fileIcon}>📄</Text>
                    <View style={styles.fileText}>
                      <Text numberOfLines={1} style={[{ color: colors.text, fontSize: 12 }, fontStyle(theme, 'bold')]}>
                        {a.name}
                      </Text>
                      <Text style={[{ color: colors.textMuted, fontSize: 11 }, regular]}>{formatBytes(a.size)}</Text>
                    </View>
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labels.removeAttachment(a.name)}
                  hitSlop={8}
                  onPress={() => setPending((prev) => prev.filter((p) => p.id !== a.id))}
                  style={[styles.remove, { backgroundColor: colors.text }]}
                >
                  <Text style={[styles.removeText, { color: colors.background }]}>✕</Text>
                </Pressable>
              </View>
            ))}
            {picking ? (
              <View style={[styles.thumb, styles.thumbLoading, { borderColor: colors.border }]}>
                <ActivityIndicator color={colors.textMuted} />
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        <View style={styles.row}>
          {pickerOptions.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.addAttachment}
              accessibilityState={{ expanded: menuOpen }}
              onPress={onAttachPress}
              disabled={picking || listening}
              hitSlop={6}
              style={({ pressed }) => [styles.attach, { opacity: pressed || picking || listening ? 0.5 : 1 }]}
            >
              <Text style={[styles.attachIcon, { color: colors.textMuted, transform: [{ rotate: menuOpen ? '45deg' : '0deg' }] }]}>＋</Text>
            </Pressable>
          ) : null}
          {accessoryLeft}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={listening ? labels.listening : placeholder ?? labels.placeholder}
            placeholderTextColor={listening ? colors.danger : colors.textMuted}
            multiline
            editable={!disabled && !listening}
            accessibilityLabel={labels.messageInput}
            style={[
              styles.input,
              { color: colors.text, fontSize: theme.fontSize },
              regular,
              Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
              inputStyle,
            ]}
            onKeyPress={(e) => {
              // Enter sends on web/desktop; Shift+Enter inserts a newline.
              const native = e.nativeEvent as { key: string; shiftKey?: boolean };
              if (Platform.OS === 'web' && native.key === 'Enter' && !native.shiftKey) {
                e.preventDefault?.();
                submit();
              }
            }}
            {...inputProps}
          />
          {accessoryRight}
          {actionButton}
        </View>
      </View>
    </View>
  );
}

/** Microphone drawn with plain Views (no icon font or SVG dependency): capsule, U-shaped holder, stand, base. */
function MicIcon({ color }: { color: string }) {
  return (
    <View style={styles.micWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.micCapsule, { backgroundColor: color }]} />
      <View style={[styles.micHolder, { borderColor: color }]} />
      <View style={[styles.micStand, { backgroundColor: color }]} />
      <View style={[styles.micBase, { backgroundColor: color }]} />
    </View>
  );
}

function PulsingDot() {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.35, duration: 500, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return <Animated.View style={[styles.pulse, { transform: [{ scale }] }]} />;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8 },
  error: { fontSize: 13, marginBottom: 6, marginHorizontal: 4 },
  editBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, marginHorizontal: 4 },
  menu: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, marginBottom: 8, paddingHorizontal: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  menuIcon: { fontSize: 16 },
  box: { borderWidth: StyleSheet.hairlineWidth, paddingLeft: 8, paddingRight: 6, paddingVertical: 6 },
  previews: { marginBottom: 6 },
  previewsContent: { gap: 10, paddingTop: 6, paddingHorizontal: 4, paddingRight: 10 },
  previewItem: { position: 'relative' },
  thumb: { width: 60, height: 60 },
  thumbLoading: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fileChip: { flexDirection: 'row', alignItems: 'center', height: 60, maxWidth: 200, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, gap: 8 },
  fileIcon: { fontSize: 22 },
  fileText: { flexShrink: 1 },
  remove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 11, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  attach: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
  attachIcon: { fontSize: 22, fontWeight: '400' },
  input: { flex: 1, maxHeight: 140, minHeight: 36, paddingTop: Platform.OS === 'ios' ? 8 : 6, paddingBottom: 6, marginHorizontal: 6 },
  button: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 18, fontWeight: '800', marginTop: -2 },
  stopIcon: { width: 11, height: 11, borderRadius: 2 },
  micWrap: { width: 16, height: 20, alignItems: 'center' },
  micCapsule: { position: 'absolute', top: 0, width: 8, height: 12, borderRadius: 4 },
  micHolder: {
    position: 'absolute',
    top: 6,
    width: 14,
    height: 9,
    borderWidth: 2,
    borderTopWidth: 0,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
  },
  micStand: { position: 'absolute', top: 15, width: 2, height: 3 },
  micBase: { position: 'absolute', top: 18, width: 8, height: 2, borderRadius: 1 },
  pulse: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF' },
});
