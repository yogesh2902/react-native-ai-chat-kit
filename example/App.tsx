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
} from 'react-native-ai-chat-kit';

// Set EXPO_PUBLIC_CHAT_URL to your backend to stream real responses.
// Without it the demo uses a mock transport, so no API key is needed.
const CHAT_URL = process.env.EXPO_PUBLIC_CHAT_URL;

// Conversations are saved on the device, so they survive app restarts.
const store = createKeyValueStore(AsyncStorage);

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

  const transport = useMemo(
    () => (CHAT_URL ? createStreamTransport({ url: CHAT_URL }) : createMockTransport()),
    [],
  );
  const chat = useChatSessions({ transport, store, restoreLastSession: true });
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
        header={
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <HeaderButton label="☰" color={colors.text} accessibilityLabel="Chat history" onPress={() => setHistoryOpen(true)} />
            <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
              {activeTitle}
            </Text>
            <View style={styles.headerActions}>
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
});
