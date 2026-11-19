import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme, withAlpha } from '../theme';
import type { ChatSource } from '../types';

export type SourceListProps = {
  sources: ChatSource[];
  /** Tapping a source. Defaults to opening its URL. */
  onSourcePress?: (source: ChatSource, index: number) => void;
};

/** "example.com" from a URL (no www.). */
export function sourceDomain(url?: string): string {
  if (!url) return '';
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return (match?.[1] ?? url).replace(/^www\./i, '');
}

/** Numbered chips for the pages a reply cites. Scrolls sideways when there are many. */
export function SourceList({ sources, onSourcePress }: SourceListProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  if (!sources.length) return null;

  const open = (source: ChatSource, index: number) => {
    if (onSourcePress) onSourcePress(source, index);
    else if (source.url) void Linking.openURL(source.url).catch(() => {});
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.heading, { color: colors.textMuted }, fontStyle(theme, 'bold')]}>🔗 {labels.sources(sources.length)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {sources.map((source, i) => {
          const domain = sourceDomain(source.url);
          const title = source.title || domain || `Source ${i + 1}`;
          return (
            <Pressable
              key={`${source.url ?? source.title}-${i}`}
              accessibilityRole={source.url ? 'link' : 'text'}
              accessibilityLabel={labels.openSource(title)}
              onPress={() => open(source, i)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: pressed ? colors.inputBackground : colors.toolCardBackground,
                  borderColor: colors.border,
                  borderRadius: theme.radius * 0.6,
                },
              ]}
            >
              <View style={styles.top}>
                <View style={[styles.badge, { backgroundColor: withAlpha(colors.accent, 0.14) }]}>
                  <Text maxFontSizeMultiplier={1.3} style={[styles.badgeText, { color: colors.accent }]}>{i + 1}</Text>
                </View>
                {domain ? (
                  <Text numberOfLines={1} style={[styles.domain, { color: colors.textMuted }, fontStyle(theme)]}>
                    {domain}
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={2} style={[styles.title, { color: colors.text }, fontStyle(theme, 'bold')]}>
                {title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  heading: { fontSize: 12, marginBottom: 6 },
  row: { gap: 8, paddingRight: 8 },
  chip: { width: 168, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontWeight: '800' },
  domain: { fontSize: 11, flexShrink: 1 },
  title: { fontSize: 12.5, lineHeight: 17 },
});
