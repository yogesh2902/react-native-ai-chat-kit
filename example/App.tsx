import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChatHistory,
  ChatView,
  createKeyValueStore,
  createMockTransport,
  createStreamTransport,
  darkTheme,
  lightTheme,
  useChatSessions,
  type ChatStyles,
  type ChatThemeOverrides,
  type ToolCallPart,
} from 'react-native-ai-chat-kit';

// Set EXPO_PUBLIC_CHAT_URL to your backend to stream real responses.
// Without it the demo uses a mock transport, so no API key is needed.
const CHAT_URL = process.env.EXPO_PUBLIC_CHAT_URL;

// Conversations are saved on the device, so they survive app restarts.
const store = createKeyValueStore(AsyncStorage);

// ---- Customization demo (🎨 button): a brand look built only from public props ----
const BRAND = '#7C3AED';
const brandTheme: ChatThemeOverrides = {
  colors: { accent: BRAND, userBubble: BRAND, userText: '#FFFFFF', link: BRAND, assistantBubble: '#F4F0FF', assistantText: '#1F1633' },
  radius: 8,
};
const brandStyles: ChatStyles = {
  composerBox: { borderColor: BRAND, borderWidth: 1.5 },
  suggestionChip: { borderColor: BRAND, backgroundColor: '#F4F0FF' },
  suggestionText: { color: BRAND, fontWeight: '600' },
};

function Avatar({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: color }]}>
      <Text style={styles.avatarText}>{label}</Text>
    </View>
  );
}

function FlightCard({ part }: { part: ToolCallPart }) {
  const found = (part.result as { found?: number } | undefined)?.found;
  return (
    <View style={styles.flightCard}>
      <Text style={styles.flightTitle}>✈️  {part.state === 'running' ? 'Searching flights…' : `${found ?? 0} flights found`}</Text>
      <Text style={styles.flightSub}>Delhi → Goa · Next Friday</Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Demo />
    </SafeAreaProvider>
  );
}

function Demo() {
  const insets = useSafeAreaInsets();
  const system = useColorScheme();
  const [scheme, setScheme] = useState<'light' | 'dark'>(system === 'dark' ? 'dark' : 'light');
  const colors = (scheme === 'dark' ? darkTheme : lightTheme).colors;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [branded, setBranded] = useState(false);

  const transport = useMemo(
    () => (CHAT_URL ? createStreamTransport({ url: CHAT_URL }) : createMockTransport()),
    [],
  );
  const chat = useChatSessions({ transport, store, restoreLastSession: true, maxAgeDays: 30 });
  const activeTitle = chat.sessions.find((s) => s.id === chat.activeSessionId)?.title ?? 'New chat';

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ChatView
        {...chat}
        colorScheme={scheme}
        placeholder="Ask anything…"
        suggestions={['What can you render?', 'Plan a trip to Goa', 'Show me the setup code']}
        onCopyCode={(code) => Clipboard.setStringAsync(code)}
        onCopyMessage={(text) => Clipboard.setStringAsync(text)}
        bottomInset={insets.bottom}
        {...(branded && {
          theme: scheme === 'light' ? brandTheme : { colors: { accent: BRAND, userBubble: BRAND, link: '#A78BFA' }, radius: 8 },
          styles: brandStyles,
          renderAvatar: (m) => (m.role === 'assistant' ? <Avatar label="AI" color={BRAND} /> : null),
          renderToolCall: (part) => (part.name === 'search_flights' ? <FlightCard part={part} /> : undefined),
          renderSendButton: ({ onPress, disabled }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              onPress={onPress}
              disabled={disabled}
              style={[styles.brandSend, { opacity: disabled ? 0.4 : 1 }]}
            >
              <Text style={styles.brandSendText}>Send</Text>
            </Pressable>
          ),
        })}
        header={
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <HeaderButton label="☰" color={colors.text} accessibilityLabel="Chat history" onPress={() => setHistoryOpen(true)} />
            <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
              {activeTitle}
            </Text>
            <View style={styles.headerActions}>
              <HeaderButton label="🎨" color={colors.text} accessibilityLabel="Toggle brand style" onPress={() => setBranded(!branded)} />
              <HeaderButton
                label={scheme === 'dark' ? '☀︎' : '☾'}
                color={colors.text}
                accessibilityLabel="Toggle dark mode"
                onPress={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}
              />
              <HeaderButton label="＋" color={colors.text} accessibilityLabel="New chat" onPress={chat.newSession} />
            </View>
          </View>
        }
      />

      <SlideOver visible={historyOpen} onClose={() => setHistoryOpen(false)}>
        <ChatHistory
          colorScheme={scheme}
          sessions={chat.sessions}
          activeSessionId={chat.activeSessionId}
          isLoading={chat.isLoadingSessions}
          onSelect={(id) => {
            setHistoryOpen(false);
            void chat.openSession(id);
          }}
          onDelete={(id) => void chat.deleteSession(id)}
          onClearAll={() => void chat.clearSessions()}
          onNewChat={() => {
            chat.newSession();
            setHistoryOpen(false);
          }}
          header={
            <View style={[styles.historyTop, { paddingTop: insets.top + 6 }]}>
              <HeaderButton label="✕" color={colors.text} accessibilityLabel="Close history" onPress={() => setHistoryOpen(false)} />
            </View>
          }
          style={{ paddingBottom: insets.bottom }}
        />
      </SlideOver>
    </View>
  );
}

/** Full-screen panel that slides in from the left; Android back button closes it. */
function SlideOver({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, progress]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) return null;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });
  return <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>{children}</Animated.View>;
}

function HeaderButton({
  label,
  color,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  color: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.5 : 1 }]}
    >
      <Text style={{ color, fontSize: 20, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  headerActions: { flexDirection: 'row', gap: 14 },
  headerButton: { paddingHorizontal: 6, minWidth: 28, alignItems: 'center' },
  historyTop: { flexDirection: 'row', paddingHorizontal: 10 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  flightCard: { marginVertical: 6, padding: 12, borderRadius: 10, backgroundColor: '#EDE7FF', borderLeftWidth: 4, borderLeftColor: BRAND },
  flightTitle: { fontSize: 15, fontWeight: '700', color: '#1F1633' },
  flightSub: { fontSize: 13, color: '#5B4B8A', marginTop: 2 },
  brandSend: { backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 14, height: 34, justifyContent: 'center' },
  brandSendText: { color: '#FFFFFF', fontWeight: '700' },
});
