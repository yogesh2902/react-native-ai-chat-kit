/**
 * Ready-made adapters for Expo modules. You pass the modules in, so this
 * library never depends on them: install only what you use.
 *
 *   import * as ImagePicker from 'expo-image-picker';
 *   import * as DocumentPicker from 'expo-document-picker';
 *   import * as ImageManipulator from 'expo-image-manipulator';
 *   const attachments = createExpoAttachmentPickers({ ImagePicker, DocumentPicker, ImageManipulator });
 */
import type { AttachmentPickers, ChatFeedbackEvent, ChatFeedbackHandler, SpeechRecognizer, TextToSpeech } from '../components/customization';
import React from 'react';
import type { DocumentViewerAdapter } from '../components/DocumentViewer';
import type { ChatAttachment, FilePart } from '../types';

// ---- Minimal structural types for the Expo modules (no import needed) ----

type PickerAsset = {
  uri: string;
  width?: number;
  height?: number;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string;
  base64?: string | null;
};
type PickerResult = { canceled: boolean; assets: PickerAsset[] | null };
type ImagePickerModule = {
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<PickerResult>;
  launchCameraAsync?: (options: Record<string, unknown>) => Promise<PickerResult>;
  requestCameraPermissionsAsync?: () => Promise<{ granted: boolean }>;
};
type DocumentAsset = { uri: string; name: string; size?: number; mimeType?: string; base64?: string };
type DocumentPickerModule = {
  getDocumentAsync: (options: Record<string, unknown>) => Promise<{ canceled: boolean; assets: DocumentAsset[] | null }>;
};
type SavedImage = { uri: string; width: number; height: number; base64?: string };
type ImageManipulatorModule = {
  ImageManipulator: {
    manipulate: (uri: string) => {
      resize: (size: { width?: number; height?: number }) => unknown;
      renderAsync: () => Promise<{ saveAsync: (options: { compress?: number; format?: any; base64?: boolean }) => Promise<SavedImage> }>;
    };
  };
};

export type ImageOptimizationOptions = {
  /** Longest side in pixels after resizing. Default 1568 (what Claude, GPT and Gemini all handle well). */
  maxDimension?: number;
  /** JPEG quality 0–1. Default 0.7. */
  quality?: number;
};

export type ExpoAttachmentPickersOptions = {
  ImagePicker?: ImagePickerModule;
  DocumentPicker?: DocumentPickerModule;
  /** Strongly recommended: resizes and compresses images before upload. */
  ImageManipulator?: ImageManipulatorModule;
  image?: ImageOptimizationOptions;
  /** Max images per pick. Default 4. */
  selectionLimit?: number;
  /** Reject documents bigger than this (bytes). Default 10 MB. */
  maxFileBytes?: number;
};

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|html?|ya?ml|log|js|jsx|ts|tsx|py|java|kt|swift|go|rb|rs|c|cpp|h|css|sql|sh)$/i;
const MAX_TEXT_CHARS = 200_000;

let idCounter = 0;
const newId = () => `att_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
const bytesOf = (base64: string) => Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);

/** Decode base64 to a UTF-8 string without relying on TextDecoder (not in every Hermes build). */
/**
 * Read a picked file from its local URI. expo-document-picker only returns base64 on
 * web; on iOS and Android we read the cached copy ourselves (fetch works on file:// URIs).
 */
async function readPickedFile(uri: string, as: 'text' | 'base64'): Promise<string> {
  const response = await fetch(uri);
  if (as === 'text') return response.text();
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });
}

export function base64ToUtf8(base64: string): string {
  const decode = (globalThis as { atob?: (data: string) => string }).atob;
  if (!decode) throw new Error('base64 decoding (atob) is not available in this JavaScript runtime.');
  const binary = decode(base64);
  let out = '';
  for (let i = 0; i < binary.length; ) {
    const c = binary.charCodeAt(i++);
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (binary.charCodeAt(i++) & 0x3f));
    else if (c < 0xf0) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((binary.charCodeAt(i++) & 0x3f) << 6) | (binary.charCodeAt(i++) & 0x3f));
    } else {
      const cp =
        (((c & 0x07) << 18) | ((binary.charCodeAt(i++) & 0x3f) << 12) | ((binary.charCodeAt(i++) & 0x3f) << 6) | (binary.charCodeAt(i++) & 0x3f)) -
        0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

/** Resize + compress an image to JPEG and return it with base64 data. */
export async function optimizeImage(
  manipulator: ImageManipulatorModule,
  image: { uri: string; width?: number; height?: number },
  options: ImageOptimizationOptions = {},
): Promise<SavedImage & { base64: string }> {
  const { maxDimension = 1568, quality = 0.7 } = options;
  const ctx = manipulator.ImageManipulator.manipulate(image.uri);
  const w = image.width ?? 0;
  const h = image.height ?? 0;
  if (w > maxDimension || h > maxDimension || (!w && !h)) {
    // Unknown size: bound the width; the aspect ratio is kept.
    ctx.resize(w >= h ? { width: maxDimension } : { height: maxDimension });
  }
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ compress: quality, format: 'jpeg', base64: true });
  if (!saved.base64) throw new Error('Image optimization returned no data.');
  return saved as SavedImage & { base64: string };
}

/**
 * Attachment pickers for `<ChatView attachments={…} />` built on expo-image-picker,
 * expo-document-picker and expo-image-manipulator (all work in Expo Go).
 * Images are resized and compressed before upload; PDFs are sent as-is;
 * text files (txt, md, csv, json, code…) are read and given to the model as text.
 */
export function createExpoAttachmentPickers(options: ExpoAttachmentPickersOptions): AttachmentPickers {
  const { ImagePicker, DocumentPicker, ImageManipulator, image: imageOptions, selectionLimit = 4, maxFileBytes = 10 * 1024 * 1024 } = options;
  const quality = imageOptions?.quality ?? 0.7;

  const fromImageAsset = async (asset: PickerAsset, fallbackName: string): Promise<ChatAttachment> => {
    const name = asset.fileName || fallbackName;
    if (ImageManipulator && asset.mimeType !== 'image/gif') {
      const out = await optimizeImage(ImageManipulator, asset, imageOptions);
      return {
        id: newId(),
        kind: 'image',
        uri: out.uri,
        name: name.replace(/\.(heic|heif|png|webp)$/i, '.jpg'),
        mimeType: 'image/jpeg',
        width: out.width,
        height: out.height,
        base64: out.base64,
        size: bytesOf(out.base64),
        originalSize: asset.fileSize,
      };
    }
    if (!asset.base64) throw new Error('Could not read the image.');
    return {
      id: newId(),
      kind: 'image',
      uri: asset.uri,
      name,
      mimeType: asset.mimeType === 'image/gif' ? 'image/gif' : 'image/jpeg',
      width: asset.width,
      height: asset.height,
      base64: asset.base64,
      size: bytesOf(asset.base64),
      originalSize: asset.fileSize,
    };
  };

  // Without a manipulator, let the picker compress (no resize) and return base64 itself.
  const pickerOptions = {
    mediaTypes: ['images'],
    quality: ImageManipulator ? 1 : quality,
    base64: !ImageManipulator,
    exif: false,
  };

  const pickers: AttachmentPickers = {};

  if (ImagePicker) {
    pickers.pickImages = async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        ...pickerOptions,
        allowsMultipleSelection: selectionLimit > 1,
        selectionLimit,
      });
      if (result.canceled || !result.assets) return [];
      return Promise.all(result.assets.map((a, i) => fromImageAsset(a, `photo-${i + 1}.jpg`)));
    };
    if (ImagePicker.launchCameraAsync) {
      pickers.takePhoto = async () => {
        const permission = await ImagePicker.requestCameraPermissionsAsync?.();
        if (permission && !permission.granted) throw new Error('Camera permission was denied.');
        const result = await ImagePicker.launchCameraAsync!(pickerOptions);
        if (result.canceled || !result.assets) return [];
        return Promise.all(result.assets.map((a) => fromImageAsset(a, 'camera.jpg')));
      };
    }
  }

  if (DocumentPicker) {
    pickers.pickDocuments = async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/*', 'application/json', 'image/*', '*/*'],
        multiple: true,
        copyToCacheDirectory: true,
        base64: true,
      });
      if (result.canceled || !result.assets) return [];
      const out: ChatAttachment[] = [];
      for (const doc of result.assets) {
        const mimeType = doc.mimeType ?? (doc.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        const size = doc.size ?? (doc.base64 ? bytesOf(doc.base64) : undefined);
        if (size !== undefined && size > maxFileBytes) {
          throw new Error(`"${doc.name}" is larger than ${Math.round(maxFileBytes / 1024 / 1024)} MB.`);
        }
        if (mimeType.startsWith('image/')) {
          out.push(await fromImageAsset({ uri: doc.uri, fileName: doc.name, mimeType, base64: doc.base64, fileSize: doc.size }, doc.name));
        } else if (mimeType === 'application/pdf') {
          const base64 = doc.base64 || (await readPickedFile(doc.uri, 'base64').catch(() => ''));
          if (!base64) throw new Error(`Could not read "${doc.name}".`);
          out.push({ id: newId(), kind: 'file', uri: doc.uri, name: doc.name, mimeType, size: size ?? bytesOf(base64), base64 });
        } else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml' || TEXT_EXTENSIONS.test(doc.name)) {
          let text = doc.base64 ? base64ToUtf8(doc.base64) : await readPickedFile(doc.uri, 'text').catch(() => null);
          if (text === null) throw new Error(`Could not read "${doc.name}".`);
          if (text.length > MAX_TEXT_CHARS) text = `${text.slice(0, MAX_TEXT_CHARS)}\n…(truncated)`;
          out.push({ id: newId(), kind: 'file', uri: doc.uri, name: doc.name, mimeType: mimeType.startsWith('text/') ? mimeType : 'text/plain', size, text });
        } else {
          throw new Error(`"${doc.name}" isn't supported. Share images, PDFs or text files.`);
        }
      }
      return out;
    };
  }

  return pickers;
}

// ---- Voice ----

type ExpoSpeechModule = {
  speak: (text: string, options?: { language?: string; rate?: number; onDone?: () => void; onStopped?: () => void; onError?: () => void }) => void;
  stop: () => void | Promise<void>;
};

/** Read replies aloud with expo-speech (works in Expo Go). */
export function createExpoSpeech(Speech: ExpoSpeechModule, options: { language?: string; rate?: number } = {}): TextToSpeech {
  return {
    speak(text, { onDone }) {
      void Speech.stop();
      Speech.speak(text, { ...options, onDone, onStopped: onDone, onError: onDone });
    },
    stop() {
      void Speech.stop();
    },
  };
}

type Subscription = { remove: () => void };
type ExpoSpeechRecognitionModuleShape = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: { lang?: string; interimResults?: boolean; continuous?: boolean }) => void;
  stop: () => void;
  abort: () => void;
  addListener: (event: string, listener: (event: any) => void) => Subscription;
};

/**
 * Speech-to-text with expo-speech-recognition (needs a development build,
 * not Expo Go; add its config plugin for the microphone permission text).
 *
 *   import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
 *   const voice = createExpoSpeechRecognizer(ExpoSpeechRecognitionModule, { lang: 'en-US' });
 */
export function createExpoSpeechRecognizer(
  module: ExpoSpeechRecognitionModuleShape,
  options: { lang?: string } = {},
): SpeechRecognizer {
  let subs: Subscription[] = [];
  const cleanup = () => {
    subs.forEach((s) => s.remove());
    subs = [];
  };
  return {
    async start(cb) {
      cleanup();
      const permission = await module.requestPermissionsAsync();
      if (!permission.granted) {
        cb.onError(new Error('Microphone permission was denied.'));
        cb.onEnd();
        return;
      }
      let finished = false;
      subs = [
        module.addListener('result', (e: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
          const text = e.results?.[0]?.transcript ?? '';
          if (e.isFinal) cb.onFinal(text);
          else cb.onPartial(text);
        }),
        module.addListener('error', (e: { error?: string; message?: string }) => {
          // "no-speech" / "aborted" are normal endings, not failures worth showing.
          if (e.error !== 'no-speech' && e.error !== 'aborted') cb.onError(new Error(e.message || e.error || 'Speech recognition failed.'));
        }),
        module.addListener('end', () => {
          if (finished) return;
          finished = true;
          cleanup();
          cb.onEnd();
        }),
      ];
      module.start({ lang: options.lang ?? 'en-US', interimResults: true, continuous: false });
    },
    stop() {
      module.stop();
    },
    abort() {
      module.abort();
    },
  };
}

// ---- Haptics (expo-haptics) ----

type HapticsModule = {
  impactAsync: (style: any) => Promise<void>;
  selectionAsync: () => Promise<void>;
  notificationAsync: (type: any) => Promise<void>;
  ImpactFeedbackStyle: { Light: any; Medium: any; Heavy?: any; Soft?: any; Rigid?: any };
  NotificationFeedbackType: { Success: any; Warning: any; Error: any };
};

/** What each event does. `null` turns an event off. */
export type HapticPattern = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error' | null;

const DEFAULT_HAPTICS: Record<ChatFeedbackEvent, HapticPattern> = {
  send: 'light',
  replyDone: null,
  error: 'error',
  rate: 'selection',
  longPress: 'medium',
  select: 'selection',
  swipeReply: 'light',
};

/**
 * Light haptic taps on send, rate, long-press and more.
 *
 *   import * as Haptics from 'expo-haptics';
 *   <ChatView haptics={createExpoHaptics(Haptics)} />
 *
 * Change or silence events with `{ replyDone: 'success', send: null }`.
 */
export function createExpoHaptics(Haptics: HapticsModule, patterns: Partial<Record<ChatFeedbackEvent, HapticPattern>> = {}): ChatFeedbackHandler {
  const map = { ...DEFAULT_HAPTICS, ...patterns };
  return (event) => {
    const pattern = map[event];
    if (!pattern) return;
    let done: Promise<void> | undefined;
    if (pattern === 'selection') done = Haptics.selectionAsync();
    else if (pattern === 'success' || pattern === 'warning' || pattern === 'error') {
      const type = { success: 'Success', warning: 'Warning', error: 'Error' }[pattern] as 'Success' | 'Warning' | 'Error';
      done = Haptics.notificationAsync(Haptics.NotificationFeedbackType[type]);
    } else {
      const style = { light: 'Light', medium: 'Medium', heavy: 'Heavy' }[pattern] as 'Light' | 'Medium' | 'Heavy';
      done = Haptics.impactAsync(Haptics.ImpactFeedbackStyle[style] ?? Haptics.ImpactFeedbackStyle.Medium);
    }
    // Haptics are best effort (simulators, web, devices without a motor).
    done?.catch?.(() => {});
  };
}

// ---- Sounds (expo-audio) ----

type AudioPlayer = { play: () => void; seekTo: (seconds: number) => unknown; volume?: number };
type AudioModule = { createAudioPlayer: (source: any) => AudioPlayer };

/** A sound source: `require('./ding.mp3')` or `{ uri }`. */
export type SoundSource = number | { uri: string };

/** The kit's own short sounds (send pop, reply chime, error blip). */
export function defaultChatSounds(): Partial<Record<ChatFeedbackEvent, SoundSource>> {
  return {
    send: require('../../assets/sounds/send.wav'),
    replyDone: require('../../assets/sounds/reply.wav'),
    error: require('../../assets/sounds/error.wav'),
  };
}

/**
 * Short sounds on send, when a reply finishes, and on errors. Off by default in
 * ChatView; opt in by passing this. Respects the iPhone silent switch.
 *
 *   import * as Audio from 'expo-audio';
 *   <ChatView sounds={createExpoSounds(Audio)} />
 *
 * Use your own files with `{ sounds: { replyDone: require('./ding.mp3') } }`
 * (merged over the built-in ones; `null` turns an event off).
 */
export function createExpoSounds(
  Audio: AudioModule,
  options: { sounds?: Partial<Record<ChatFeedbackEvent, SoundSource | null>>; volume?: number } = {},
): ChatFeedbackHandler {
  const sources = { ...defaultChatSounds(), ...options.sounds };
  const players = new Map<ChatFeedbackEvent, AudioPlayer>();
  return (event) => {
    const source = sources[event];
    if (!source) return;
    try {
      let player = players.get(event);
      if (!player) {
        player = Audio.createAudioPlayer(source);
        if (options.volume !== undefined) player.volume = options.volume;
        players.set(event, player);
      }
      void Promise.resolve(player.seekTo(0)).catch(() => {});
      player.play();
    } catch {
      // Sounds are best effort.
    }
  };
}

// ---- Document preview (react-native-webview + expo-sharing) ----

type WebViewComponent = React.ComponentType<Record<string, unknown>>;
/** expo-file-system/legacy: used to copy a file into the app's cache before sharing it. */
type LegacyFileSystemModule = {
  cacheDirectory: string | null;
  copyAsync: (options: { from: string; to: string }) => Promise<void>;
  makeDirectoryAsync?: (uri: string, options?: { intermediates?: boolean }) => Promise<void>;
  writeAsStringAsync?: (uri: string, contents: string, options?: { encoding?: 'base64' | 'utf8' }) => Promise<void>;
};

type SharingModule = {
  shareAsync: (url: string, options?: { mimeType?: string; UTI?: string; dialogTitle?: string }) => Promise<void>;
  isAvailableAsync?: () => Promise<boolean>;
};

/**
 * PDF preview and "Open in…" for the document viewer.
 *
 *   import { WebView } from 'react-native-webview';
 *   import * as Sharing from 'expo-sharing';
 *   import * as FileSystem from 'expo-file-system/legacy';
 *   <ChatView documentViewer={createExpoDocumentViewer({ WebView, Sharing, FileSystem })} />
 *
 * iOS and web show PDFs inside the app; Android WebView can't, so Android offers
 * "Open in…" (your PDF app) instead. Text files never need this adapter.
 * With FileSystem, the file is first copied into the app's cache under its real name,
 * which Expo Go requires for sharing and which gives the share sheet a proper file name.
 */
export function createExpoDocumentViewer({
  WebView,
  Sharing,
  FileSystem,
}: {
  WebView?: WebViewComponent;
  Sharing?: SharingModule;
  FileSystem?: LegacyFileSystemModule;
}): DocumentViewerAdapter {
  /** A copy in the app's own cache, named like the original (falls back to the original URI). */
  const shareableUri = async (file: FilePart): Promise<string | undefined> => {
    if (!FileSystem?.cacheDirectory) return file.uri;
    const dir = `${FileSystem.cacheDirectory}chat-share/`;
    const target = `${dir}${file.name.replace(/[^\w.\- ]+/g, '_')}`;
    try {
      await FileSystem.makeDirectoryAsync?.(dir, { intermediates: true }).catch(() => {});
      // Prefer the data we already hold: the picker's cache file may not be readable (e.g. in Expo Go).
      if (file.base64 && FileSystem.writeAsStringAsync) await FileSystem.writeAsStringAsync(target, file.base64, { encoding: 'base64' });
      else if (file.text !== undefined && FileSystem.writeAsStringAsync) await FileSystem.writeAsStringAsync(target, file.text);
      else if (file.uri) await FileSystem.copyAsync({ from: file.uri, to: target });
      else return undefined;
      return target;
    } catch {
      return file.uri;
    }
  };
  const pdfUri = (file: FilePart) => file.uri ?? (file.base64 ? `data:application/pdf;base64,${file.base64}` : undefined);
  return {
    renderPdf: WebView
      ? (file) => {
          const uri = pdfUri(file);
          // Read lazily so this module also loads outside React Native (tests, servers).
          const { Platform } = require('react-native') as typeof import('react-native');
          if (!uri || Platform.OS === 'android') return undefined;
          const directory = uri.startsWith('file://') ? uri.slice(0, uri.lastIndexOf('/') + 1) : undefined;
          return React.createElement(WebView, {
            source: { uri },
            originWhitelist: ['*'],
            allowFileAccess: true,
            ...(directory ? { allowingReadAccessToURL: directory } : {}),
            style: { flex: 1 },
          });
        }
      : undefined,
    open: Sharing
      ? async (file) => {
          if (Sharing.isAvailableAsync && !(await Sharing.isAvailableAsync())) return;
          const uri = await shareableUri(file);
          if (!uri) return;
          await Sharing.shareAsync(uri, {
            mimeType: file.mimeType,
            ...(file.mimeType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
            dialogTitle: file.name,
          });
        }
      : undefined,
  };
}
