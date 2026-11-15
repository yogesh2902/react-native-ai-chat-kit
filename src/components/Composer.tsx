import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { fontStyle, useChatTheme } from '../theme';
import type { SendButtonRenderProps, StopButtonRenderProps } from './customization';

export type ComposerProps = {
  onSend: (text: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Extra bottom padding, e.g. the safe-area inset. */
  bottomInset?: number;
  inputProps?: Omit<TextInputProps, 'value' | 'onChangeText'>;
  /** Rendered left of the input, e.g. an attachment button. */
  accessoryLeft?: React.ReactNode;
  /** Rendered right of the input, before the send button, e.g. a mic button. */
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
};

export function Composer({
  onSend,
  onStop,
  isStreaming,
  placeholder = 'Message',
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
}: ComposerProps) {
  const theme = useChatTheme();
  const [text, setText] = useState('');
  const canSend = !disabled && !isStreaming && text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={[styles.wrap, { paddingBottom: 10 + bottomInset, borderTopColor: theme.colors.border, backgroundColor: theme.colors.background }, style]}>
      <View style={[styles.box, { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border, borderRadius: theme.radius + 4 }, boxStyle]}>
        {accessoryLeft}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          editable={!disabled}
          accessibilityLabel="Message input"
          style={[
            styles.input,
            { color: theme.colors.text, fontSize: theme.fontSize },
            fontStyle(theme),
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
        {isStreaming && onStop ? (
          renderStopButton ? (
            renderStopButton({ onPress: onStop })
          ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop generating"
            onPress={onStop}
            style={[styles.button, { backgroundColor: theme.colors.accent }]}
          >
            <View style={[styles.stopIcon, { backgroundColor: theme.colors.onAccent }]} />
          </Pressable>
          )
        ) : renderSendButton ? (
          renderSendButton({ onPress: submit, disabled: !canSend })
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={submit}
            style={[styles.button, { backgroundColor: theme.colors.accent, opacity: canSend ? 1 : 0.3 }]}
          >
            <Text style={[styles.arrow, { color: theme.colors.onAccent }]}>↑</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8 },
  box: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: StyleSheet.hairlineWidth, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, maxHeight: 140, minHeight: 36, paddingTop: Platform.OS === 'ios' ? 8 : 6, paddingBottom: 6, marginRight: 6 },
  button: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 18, fontWeight: '800', marginTop: -2 },
  stopIcon: { width: 11, height: 11, borderRadius: 2 },
});
