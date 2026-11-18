import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme } from '../theme';
import type { ChatMessage } from '../types';

export type MessageMenuItem = {
  key: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  onPress: () => void;
};

/** Bottom sheet opened by long-pressing a message. */
export function MessageMenu({
  message,
  items,
  onClose,
  bottomInset = 0,
}: {
  message: ChatMessage | null;
  items: MessageMenuItem[];
  onClose: () => void;
  bottomInset?: number;
}) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;

  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={labels.closeMenu}>
        <Pressable
          // Taps inside the sheet don't close it.
          onPress={() => {}}
          accessibilityViewIsModal
          accessibilityLabel={labels.messageOptions}
          style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: 12 + bottomInset, borderTopLeftRadius: theme.radius, borderTopRightRadius: theme.radius }]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {items.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.inputBackground : 'transparent' }]}
            >
              {item.icon ? <Text style={styles.icon}>{item.icon}</Text> : null}
              <Text style={[{ color: item.destructive ? colors.danger : colors.text, fontSize: theme.fontSize }, fontStyle(theme)]}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.cancel}
            onPress={onClose}
            style={({ pressed }) => [styles.item, styles.cancel, { borderTopColor: colors.border, backgroundColor: pressed ? colors.inputBackground : 'transparent' }]}
          >
            <Text style={[{ color: colors.textMuted, fontSize: theme.fontSize }, fontStyle(theme, 'bold')]}>{labels.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { paddingTop: 8, paddingHorizontal: 8 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10 },
  icon: { fontSize: 18, width: 24, textAlign: 'center' },
  cancel: { justifyContent: 'center', marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0 },
});
