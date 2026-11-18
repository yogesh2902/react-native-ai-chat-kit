import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { filterSessions, formatSessionTime, groupSessionsByDate } from '../sessions/groupSessions';
import type { ChatSessionMeta } from '../sessions/store';
import { ChatLabelsContext, mergeLabels, useChatLabels, type ChatLabelsOverrides } from '../labels';
import { fontStyle, useChatTheme } from '../theme';
import { ChatThemeProvider, type ThemeProps } from './ChatThemeProvider';

export type ChatHistoryItemRenderProps = {
  session: ChatSessionMeta;
  active: boolean;
  /** Open this chat. */
  onPress: () => void;
  /** Ask to delete (shows the Delete button in the default row). */
  onDelete?: () => void;
};

export type ChatHistoryProps = ThemeProps & {
  sessions: ChatSessionMeta[];
  activeSessionId?: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onNewChat?: () => void;
  /** Shows a "Clear all chats" button (with confirmation) below the list. */
  onClearAll?: () => void;
  isLoading?: boolean;
  /** Show a search box. Default true. */
  searchable?: boolean;
  title?: string;
  /** Rendered at the top, e.g. a Close button. */
  header?: React.ReactNode;
  emptyText?: string;
  style?: StyleProp<ViewStyle>;
  /** Translate or reword any text on this screen. */
  labels?: ChatLabelsOverrides;
  /** Render each row yourself. */
  renderItem?: (props: ChatHistoryItemRenderProps) => React.ReactNode;
};

/** A ChatGPT-style list of past conversations, grouped by date. */
export function ChatHistory({ colorScheme, theme, palette, labels, ...props }: ChatHistoryProps) {
  const merged = useMemo(() => mergeLabels(labels), [labels]);
  return (
    <ChatThemeProvider colorScheme={colorScheme} theme={theme} palette={palette}>
      <ChatLabelsContext.Provider value={merged}>
        <ChatHistoryInner {...props} />
      </ChatLabelsContext.Provider>
    </ChatThemeProvider>
  );
}

function ChatHistoryInner({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onNewChat,
  onClearAll,
  isLoading,
  searchable = true,
  title,
  header,
  emptyText,
  style,
  renderItem: renderCustomItem,
}: Omit<ChatHistoryProps, keyof ThemeProps | 'labels'>) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const [query, setQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const sections = useMemo(() => groupSessionsByDate(filterSessions(sessions, query), Date.now(), labels), [sessions, query, labels]);
  const { colors } = theme;
  const regular = fontStyle(theme);
  const bold = fontStyle(theme, 'bold');

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, style]}>
      {header}
      <View style={styles.top}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }, bold]}>
          {title ?? labels.chats}
        </Text>
        {onNewChat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.newChat.replace(/^\W+\s*/, '')}
            onPress={onNewChat}
            style={({ pressed }) => [styles.newButton, { backgroundColor: colors.accent, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[{ color: colors.onAccent, fontSize: 14 }, bold]}>{labels.newChat}</Text>
          </Pressable>
        ) : null}
      </View>

      {searchable ? (
        <View style={[styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={labels.searchChats}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={labels.searchChats}
            autoCorrect={false}
            style={[
              styles.searchInput,
              { color: colors.text },
              regular,
              Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
            ]}
          />
        </View>
      ) : null}

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={colors.textMuted} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.textMuted }, regular]}>{query ? labels.noMatches : emptyText ?? labels.noChats}</Text>
          }
          ListFooterComponent={
            onClearAll && sessions.length > 0 && !query ? (
              confirmingClear ? (
                <View style={[styles.clearConfirm, { borderColor: colors.border }]}>
                  <Text style={[{ color: colors.text, fontSize: 14, textAlign: 'center' }, regular]}>
                    {labels.clearAllConfirm(sessions.length)}
                  </Text>
                  <View style={styles.clearActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={labels.cancel}
                      onPress={() => setConfirmingClear(false)}
                      style={[styles.clearButton, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
                    >
                      <Text style={[{ color: colors.text }, bold]}>{labels.cancel}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={labels.deleteAll}
                      onPress={() => {
                        setConfirmingClear(false);
                        onClearAll();
                      }}
                      style={[styles.clearButton, { backgroundColor: colors.danger }]}
                    >
                      <Text style={[styles.deleteText, bold]}>{labels.deleteAll}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labels.clearAllChats}
                  onPress={() => setConfirmingClear(true)}
                  style={({ pressed }) => [styles.clearLink, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[{ color: colors.danger, fontSize: 14 }, bold]}>{labels.clearAllChats}</Text>
                </Pressable>
              )
            ) : undefined
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionTitle, { color: colors.textMuted }, bold]}>{section.title}</Text>
          )}
          renderItem={({ item }) => {
            const active = item.id === activeSessionId;
            if (renderCustomItem) {
              return (
                <>
                  {renderCustomItem({
                    session: item,
                    active,
                    onPress: () => onSelect(item.id),
                    onDelete: onDelete ? () => onDelete(item.id) : undefined,
                  })}
                </>
              );
            }
            const confirming = item.id === confirmingId;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.preview}`}
                accessibilityState={{ selected: active }}
                accessibilityHint={onDelete ? labels.longPressToDelete : undefined}
                onPress={() => (confirming ? setConfirmingId(null) : onSelect(item.id))}
                onLongPress={onDelete ? () => setConfirmingId(item.id) : undefined}
                style={({ pressed }) => [
                  styles.row,
                  { borderRadius: theme.radius * 0.7 },
                  (active || pressed) && { backgroundColor: colors.inputBackground },
                ]}
              >
                <View style={styles.rowText}>
                  <View style={styles.rowTop}>
                    <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }, bold]}>
                      {item.title}
                    </Text>
                    {!confirming ? (
                      <Text style={[styles.time, { color: colors.textMuted }, regular]}>{formatSessionTime(item.updatedAt, Date.now(), labels.months)}</Text>
                    ) : null}
                  </View>
                  {item.preview ? (
                    <Text numberOfLines={1} style={[styles.preview, { color: colors.textMuted }, regular]}>
                      {item.preview}
                    </Text>
                  ) : null}
                </View>
                {confirming && onDelete ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.deleteChat(item.title)}
                    onPress={() => {
                      setConfirmingId(null);
                      onDelete(item.id);
                    }}
                    style={[styles.delete, { backgroundColor: colors.danger }]}
                  >
                    <Text style={[styles.deleteText, bold]}>{labels.delete}</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800' },
  newButton: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  search: { marginHorizontal: 16, marginBottom: 4, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  searchInput: { fontSize: 15, paddingVertical: Platform.OS === 'ios' ? 10 : 6 },
  loading: { marginTop: 32 },
  listContent: { paddingHorizontal: 8, paddingBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 8, paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10 },
  rowText: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  time: { fontSize: 12, marginLeft: 8 },
  preview: { fontSize: 13, marginTop: 2 },
  delete: { marginLeft: 10, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  deleteText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  clearLink: { alignSelf: 'center', paddingVertical: 16, paddingHorizontal: 12, marginTop: 12 },
  clearConfirm: { marginTop: 16, marginHorizontal: 8, padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  clearActions: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  clearButton: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
});
