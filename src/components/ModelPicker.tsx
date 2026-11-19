import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme, withAlpha } from '../theme';

/** One choice in the model picker. */
export type ChatModelOption = {
  /** Sent to your transport / server as `model`. */
  id: string;
  /** Shown in the picker, e.g. "Claude Sonnet". */
  name: string;
  description?: string;
  /** Short tag such as "Fast" or "Reasoning". */
  badge?: string;
  /** Emoji or short text. */
  icon?: string;
};

export type ModelPickerProps = {
  models: ChatModelOption[];
  /** The selected model id. Defaults to the first model. */
  value?: string;
  onChange: (id: string) => void;
  /** Disable switching (e.g. while a reply streams). */
  disabled?: boolean;
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A pill showing the current model; tapping it opens a sheet to pick another.
 * ChatView shows it above the composer when you pass `models`; you can also
 * put it in your own header.
 */
export function ModelPicker({ models, value, onChange, disabled, bottomInset = 0, style }: ModelPickerProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.id === value) ?? models[0];
  if (!current) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${labels.currentModel(current.name)}. ${labels.chooseModel}`}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        hitSlop={6}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.pill,
          { borderColor: colors.border, backgroundColor: pressed ? colors.inputBackground : colors.background, opacity: disabled ? 0.5 : 1 },
          style,
        ]}
      >
        {current.icon ? <Text style={styles.pillIcon}>{current.icon}</Text> : null}
        <Text numberOfLines={1} style={[styles.pillText, { color: colors.text }, fontStyle(theme, 'bold')]}>
          {current.name}
        </Text>
        <Text style={[styles.caret, { color: colors.textMuted }]}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={labels.closeMenu}>
          <Pressable
            onPress={() => {}}
            accessibilityViewIsModal
            style={[
              styles.sheet,
              { backgroundColor: colors.background, paddingBottom: 12 + bottomInset, borderTopLeftRadius: theme.radius, borderTopRightRadius: theme.radius },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }, fontStyle(theme, 'bold')]}>
              {labels.chooseModel}
            </Text>
            <ScrollView style={styles.list}>
              {models.map((model) => {
                const selected = model.id === current.id;
                return (
                  <Pressable
                    key={model.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={[model.name, model.badge, model.description].filter(Boolean).join('. ')}
                    onPress={() => {
                      setOpen(false);
                      if (!selected) onChange(model.id);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        backgroundColor: selected ? withAlpha(colors.accent, 0.08) : pressed ? colors.inputBackground : 'transparent',
                        borderRadius: theme.radius * 0.6,
                      },
                    ]}
                  >
                    {model.icon ? <Text style={styles.rowIcon}>{model.icon}</Text> : null}
                    <View style={styles.rowText}>
                      <View style={styles.nameLine}>
                        <Text style={[{ color: colors.text, fontSize: theme.fontSize * 0.95 }, fontStyle(theme, 'bold')]}>{model.name}</Text>
                        {model.badge ? (
                          <View style={[styles.badge, { backgroundColor: withAlpha(colors.accent, 0.14) }]}>
                            <Text style={[styles.badgeText, { color: colors.accent }]}>{model.badge}</Text>
                          </View>
                        ) : null}
                      </View>
                      {model.description ? (
                        <Text style={[{ color: colors.textMuted, fontSize: theme.fontSize * 0.8, marginTop: 2 }, fontStyle(theme)]}>{model.description}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.check, { color: selected ? colors.accent : 'transparent' }]}>✓</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    maxWidth: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillIcon: { fontSize: 13 },
  pillText: { fontSize: 13, flexShrink: 1 },
  caret: { fontSize: 11, marginTop: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { paddingTop: 8, paddingHorizontal: 10, maxHeight: '75%' },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 10 },
  title: { fontSize: 15, marginHorizontal: 8, marginBottom: 8 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 2 },
  rowIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  rowText: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  check: { fontSize: 17, fontWeight: '800' },
});
