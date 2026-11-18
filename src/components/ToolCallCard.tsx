import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme } from '../theme';
import type { ToolCallPart } from '../types';

/** "search_flights" → "Search flights" */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ToolCallCard({ part }: { part: ToolCallPart }) {
  const theme = useChatTheme();
  const title = part.label ?? humanizeToolName(part.name);
  const labels = useChatLabels();
  const statusText = part.state === 'running' ? labels.toolRunning : part.state === 'done' ? labels.toolDone : part.error ?? labels.toolFailed;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${title}: ${statusText}`}
      style={[
        styles.card,
        { backgroundColor: theme.colors.toolCardBackground, borderColor: theme.colors.border, borderRadius: theme.radius * 0.6 },
      ]}
    >
      <View style={styles.icon}>
        {part.state === 'running' ? (
          <ActivityIndicator size="small" color={theme.colors.textMuted} />
        ) : (
          <Text style={{ color: part.state === 'done' ? theme.colors.success : theme.colors.danger, fontSize: 15, fontWeight: '700' }}>
            {part.state === 'done' ? '✓' : '✕'}
          </Text>
        )}
      </View>
      <View style={styles.body}>
        <Text style={[{ color: theme.colors.text, fontSize: theme.fontSize * 0.9 }, fontStyle(theme, 'bold')]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[{ color: part.state === 'error' ? theme.colors.danger : theme.colors.textMuted, fontSize: theme.fontSize * 0.78 }, fontStyle(theme)]} numberOfLines={2}>
          {statusText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minWidth: 220,
  },
  icon: { width: 24, alignItems: 'center', marginRight: 10 },
  body: { flexShrink: 1 },
});
