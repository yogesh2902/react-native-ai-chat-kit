import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Platform, Pressable, Share, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChatHistory,
  ChatView,
  createExpoAttachmentPickers,
  createExpoSpeech,
  createKeyValueStore,
  createMockTransport,
  createNetInfoMonitor,
  createWebNetworkMonitor,
  createWebSpeechRecognizer,
  getMessageText,
  isWebSpeechRecognitionAvailable,
  createStreamTransport,
  darkTheme,
  lightTheme,
  useChatSessions,
  useChatTheme,
  PALETTE_NAMES,
  applyPalette,
  type ChatLabelsOverrides,
  type ChatPalette,
  type ChatLayout,
  type MessageAction,
  type WelcomeConfig,
  type ChatStyles,
  type SpeechRecognizer,
  type ChatThemeOverrides,
  type ToolCallPart,
} from 'react-native-ai-chat-kit';

// Set EXPO_PUBLIC_CHAT_URL to your backend to stream real responses.
// Without it the demo uses a mock transport, so no API key is needed.
const CHAT_URL = process.env.EXPO_PUBLIC_CHAT_URL;

// Conversations are saved on the device, so they survive app restarts.
const store = createKeyValueStore(AsyncStorage);

// Photos, camera and files. Images are resized to 1568px and compressed to JPEG before upload.
const attachments = createExpoAttachmentPickers({ ImagePicker, DocumentPicker, ImageManipulator });

// Read replies aloud (works in Expo Go).
const speech = createExpoSpeech(Speech);

// Speech-to-text. Real apps on iOS/Android use createExpoSpeechRecognizer(ExpoSpeechRecognitionModule)
// from 'expo-speech-recognition', which needs a development build (it isn't in Expo Go).
// On web we use the browser's recognizer; in Expo Go a demo recognizer types a sample sentence.
const voice: SpeechRecognizer =
  Platform.OS === 'web' && isWebSpeechRecognitionAvailable() ? createWebSpeechRecognizer() : createDemoSpeechRecognizer();

function createDemoSpeechRecognizer(): SpeechRecognizer {
  let timer: ReturnType<typeof setInterval> | null = null;
  let finish: (() => void) | null = null;
  return {
    start(cb) {
      const words = 'Plan a weekend trip to Goa with beaches and good food'.split(' ');
      let i = 0;
      finish = () => {
        if (timer) clearInterval(timer);
        timer = null;
        cb.onFinal(words.slice(0, Math.max(i, 1)).join(' '));
        cb.onEnd();
        finish = null;
      };
      timer = setInterval(() => {
        i++;
        if (i >= words.length) finish?.();
        else cb.onPartial(words.slice(0, i).join(' '));
      }, 220);
    },
    stop: () => finish?.(),
    abort: () => {
      if (timer) clearInterval(timer);
      timer = null;
      finish = null;
    },
  };
}

// ---- Translation demo (अ button): every label can be overridden ----
const hindi: ChatLabelsOverrides = {
  placeholder: 'कुछ भी पूछें…',
  emptyTitle: 'मैं कैसे मदद करूँ?',
  copy: 'कॉपी',
  copied: 'कॉपी हो गया ✓',
  retry: 'फिर से',
  listen: '🔊 सुनें',
  stopSpeaking: '■ रोकें',
  edit: 'बदलें',
  editing: 'संदेश बदल रहे हैं',
  cancelEdit: 'रद्द करें',
  stopped: 'रोका गया',
  toolRunning: 'काम चल रहा है…',
  toolDone: 'पूरा हुआ',
  chats: 'चैट',
  newChat: '＋ नई चैट',
  searchChats: 'चैट खोजें',
  noChats: 'अभी कोई चैट नहीं',
  clearAllChats: 'सभी चैट हटाएं',
  today: 'आज',
  yesterday: 'कल',
  previous7Days: 'पिछले 7 दिन',
  previous30Days: 'पिछले 30 दिन',
};

const arabic: ChatLabelsOverrides = {
  placeholder: 'اسأل أي شيء…',
  emptyTitle: 'كيف يمكنني المساعدة؟',
  copy: 'نسخ',
  copied: 'تم النسخ ✓',
  retry: 'إعادة',
  listen: '🔊 استمع',
  stopSpeaking: '■ إيقاف',
  edit: 'تعديل',
  editing: 'تعديل الرسالة',
  cancelEdit: 'إلغاء',
  thinking: 'يفكر…',
  stopped: 'تم الإيقاف',
  toolRunning: 'جارٍ العمل…',
  toolDone: 'تم',
  deleteMessage: 'حذف الرسالة',
  cancel: 'إلغاء',
  chats: 'المحادثات',
  newChat: '＋ محادثة جديدة',
  searchChats: 'ابحث في المحادثات',
  noChats: 'لا توجد محادثات بعد',
  clearAllChats: 'حذف كل المحادثات',
  today: 'اليوم',
  yesterday: 'أمس',
  previous7Days: 'آخر 7 أيام',
  previous30Days: 'آخر 30 يومًا',
  offline: 'أنت غير متصل. سيتم الإرسال عند عودة الاتصال.',
  reconnecting: 'عاد الاتصال. جارٍ إعادة المحاولة…',
};

type Language = 'en' | 'hi' | 'ar';
const LANGUAGES: Language[] = ['en', 'hi', 'ar'];
const labelsFor = { en: undefined, hi: hindi, ar: arabic } as const;
const LANGUAGE_BUTTON = { en: 'अ', hi: 'ع', ar: 'A' } as const;

// Empty screen with starter cards.
// Reads the chat theme, so the logo follows the palette and dark mode.
function DemoLogo() {
  const theme = useChatTheme();
  return <Text style={{ fontSize: 40, color: theme.colors.accent }}>✦</Text>;
}

const welcome: WelcomeConfig = {
  logo: <DemoLogo />,
  subtitle: 'Try a card below, or type anything. This demo runs without an API key.',
  cards: [
    { icon: '✈️', title: 'Plan a trip', description: 'Flights and ideas for Goa', prompt: 'Plan a trip to Goa' },
    { icon: '💻', title: 'Setup code', description: 'Add the kit to an app', prompt: 'Show me the setup code' },
    { icon: '🧩', title: 'What can you render?', description: 'Markdown, tables, code' },
    { icon: '🖼', title: 'Send a photo', description: 'Tap ＋ below to attach one', prompt: 'How do I attach a photo?' },
  ],
};

// Extra message actions: Share shows under replies; Delete is in the long-press menu.
const messageActions: MessageAction[] = [
  { key: 'share', icon: '↗', label: 'Share', inline: true, onPress: (m) => void Share.share({ message: getMessageText(m) }) },
];

// Offline banner + auto-retry when the connection comes back.
const network = Platform.OS === 'web' ? createWebNetworkMonitor() : createNetInfoMonitor(NetInfo);

// 🎨 cycles through the built-in layouts, then a fully custom brand look.
type Look = ChatLayout | 'brand';
const LOOKS: Look[] = ['minimal', 'bubbles', 'compact', 'brand'];

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
  const accent = (p: ChatPalette) => applyPalette(scheme === 'dark' ? darkTheme : lightTheme, p, scheme).colors.accent;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [look, setLook] = useState<Look>('minimal');
  const branded = look === 'brand';
  const [language, setLanguage] = useState<Language>('en');
  const [palette, setPalette] = useState<ChatPalette>('violet');

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
        labels={labelsFor[language]}
        direction={language === 'ar' ? 'rtl' : 'ltr'}
        placeholder={language === 'en' ? 'Ask anything…' : undefined}
        layout={branded ? 'minimal' : look}
        palette={palette}
        welcome={welcome}
        showTimestamps
        typingIndicator="text"
        streamingCursor
        messageActions={messageActions}
        allowDelete
        network={network}
        onFeedback={(message, rating) => console.log('[feedback]', rating, message.id)}
        suggestions={['What can you render?', 'Plan a trip to Goa', 'Show me the setup code']}
        onCopyCode={(code) => Clipboard.setStringAsync(code)}
        onCopyMessage={(text) => Clipboard.setStringAsync(text)}
        bottomInset={insets.bottom}
        attachments={attachments}
        voice={voice}
        speech={speech}
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
              <HeaderButton
                label={LANGUAGE_BUTTON[language]}
                color={colors.text}
                accessibilityLabel="Switch language"
                onPress={() => setLanguage(LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]!)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Switch palette"
                hitSlop={10}
                onPress={() => setPalette(PALETTE_NAMES[(PALETTE_NAMES.indexOf(palette) + 1) % PALETTE_NAMES.length]!)}
                style={[styles.paletteDot, { backgroundColor: accent(palette) }]}
              />
              <HeaderButton
                label="🎨"
                color={colors.text}
                accessibilityLabel="Switch look"
                onPress={() => setLook(LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length]!)}
              />
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
          labels={labelsFor[language]}
          palette={palette}
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
  paletteDot: { width: 18, height: 18, borderRadius: 9, alignSelf: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  flightCard: { marginVertical: 6, padding: 12, borderRadius: 10, backgroundColor: '#EDE7FF', borderLeftWidth: 4, borderLeftColor: BRAND },
  flightTitle: { fontSize: 15, fontWeight: '700', color: '#1F1633' },
  flightSub: { fontSize: 13, color: '#5B4B8A', marginTop: 2 },
  brandSend: { backgroundColor: BRAND, borderRadius: 8, paddingHorizontal: 14, height: 34, justifyContent: 'center' },
  brandSendText: { color: '#FFFFFF', fontWeight: '700' },
});
