import React from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme, withAlpha, type ChatTheme } from '../theme';
import { FadeIn, usePressScale } from './animations';
import type { WelcomeCard, WelcomeConfig } from './customization';

/** The empty-chat screen built from `welcome`: logo, greeting and tappable starter cards. */
export function WelcomeScreen({ config, onSend }: { config: WelcomeConfig; onSend: (text: string) => void }) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  const grid = (config.cardLayout ?? 'grid') === 'grid';

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <FadeIn distance={12} duration={380} style={styles.hero}>
        {config.logo ? (
          <View style={styles.logoWrap}>
            {/* Layered soft circles in the accent color, standing in for a blur glow. */}
            <View pointerEvents="none" style={[styles.glow, styles.glow1, { backgroundColor: withAlpha(colors.accent, 0.06) }]} />
            <View pointerEvents="none" style={[styles.glow, styles.glow2, { backgroundColor: withAlpha(colors.accent, 0.1) }]} />
            <View pointerEvents="none" style={[styles.glow, styles.glow3, { backgroundColor: withAlpha(colors.accent, 0.16) }]} />
            {config.logo}
          </View>
        ) : null}
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: theme.fontSize * 1.6 }, fontStyle(theme, 'bold')]}>
          {config.title ?? labels.emptyTitle}
        </Text>
        {config.subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: theme.fontSize * 0.95 }, fontStyle(theme)]}>{config.subtitle}</Text>
        ) : null}
      </FadeIn>
      {config.cards?.length ? (
        <View style={[styles.cards, grid && styles.cardsGrid]}>
          {config.cards.map((card, i) => (
            <FadeIn key={card.title} delay={160 + i * 70} style={grid ? styles.cardGridSlot : undefined}>
              <Card card={card} grid={grid} theme={theme} onPress={() => onSend(card.prompt ?? card.title)} />
            </FadeIn>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Card({ card, grid, theme, onPress }: { card: WelcomeCard; grid: boolean; theme: ChatTheme; onPress: () => void }) {
  const { colors } = theme;
  const press = usePressScale(0.96);
  return (
    <Animated.View style={[press.style, grid && styles.fill]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={card.description ? `${card.title}. ${card.description}` : card.title}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.card,
          grid ? styles.cardGrid : styles.cardList,
          {
            backgroundColor: colors.inputBackground,
            borderColor: hovered ? withAlpha(colors.accent, 0.5) : colors.border,
            borderRadius: theme.radius * 0.85,
          },
        ]}
      >
        {card.icon ? (
          <View style={[grid ? styles.iconGrid : styles.iconList, { backgroundColor: withAlpha(colors.accent, 0.1) }]}>
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  hero: { alignItems: 'center' },
  logoWrap: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', marginTop: 16, marginBottom: 34 },
  glow: { position: 'absolute', borderRadius: 999 },
  glow1: { width: 150, height: 150 },
  glow2: { width: 108, height: 108 },
  glow3: { width: 72, height: 72 },
  title: { textAlign: 'center', letterSpacing: -0.4 },
  subtitle: { textAlign: 'center', marginTop: 6, maxWidth: 420 },
  cards: { marginTop: 26, width: '100%', maxWidth: 560, gap: 10 },
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cardGridSlot: { width: '48.5%' },
  fill: { flex: 1 },
  card: { borderWidth: 1, padding: 12 },
  cardGrid: { minHeight: 104, flex: 1 },
  cardList: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconGrid: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  iconList: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 18 },
  cardText: { flexShrink: 1 },
});
