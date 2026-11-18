import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme } from '../theme';
import type { WelcomeConfig } from './customization';

/** The empty-chat screen built from `welcome`: logo, greeting and tappable starter cards. */
export function WelcomeScreen({ config, onSend }: { config: WelcomeConfig; onSend: (text: string) => void }) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  const grid = (config.cardLayout ?? 'grid') === 'grid';

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {config.logo ? <View style={styles.logo}>{config.logo}</View> : null}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: theme.fontSize * 1.5 }, fontStyle(theme, 'bold')]}>
        {config.title ?? labels.emptyTitle}
      </Text>
      {config.subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: theme.fontSize * 0.95 }, fontStyle(theme)]}>{config.subtitle}</Text>
      ) : null}
      {config.cards?.length ? (
        <View style={[styles.cards, grid && styles.cardsGrid]}>
          {config.cards.map((card) => (
            <Pressable
              key={card.title}
              accessibilityRole="button"
              accessibilityLabel={card.description ? `${card.title}. ${card.description}` : card.title}
              onPress={() => onSend(card.prompt ?? card.title)}
              style={({ pressed }) => [
                styles.card,
                grid ? styles.cardGrid : styles.cardList,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                  borderRadius: theme.radius * 0.8,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {card.icon ? (
                <View style={grid ? styles.iconGrid : styles.iconList}>
                  {typeof card.icon === 'string' ? <Text style={styles.iconText}>{card.icon}</Text> : card.icon}
                </View>
              ) : null}
              <View style={styles.cardText}>
                <Text style={[{ color: colors.text, fontSize: theme.fontSize * 0.92 }, fontStyle(theme, 'bold')]} numberOfLines={2}>
                  {card.title}
                </Text>
                {card.description ? (
                  <Text style={[{ color: colors.textMuted, fontSize: theme.fontSize * 0.8, marginTop: 2 }, fontStyle(theme)]} numberOfLines={2}>
                    {card.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  logo: { marginBottom: 16 },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginTop: 6, maxWidth: 420 },
  cards: { marginTop: 24, width: '100%', maxWidth: 560, gap: 10 },
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  cardGrid: { width: '48.5%', minHeight: 92 },
  cardList: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconGrid: { marginBottom: 8 },
  iconList: { width: 32, alignItems: 'center' },
  iconText: { fontSize: 22 },
  cardText: { flexShrink: 1 },
});
