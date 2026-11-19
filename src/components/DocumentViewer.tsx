import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';
import { StreamingMarkdown } from '../markdown/StreamingMarkdown';
import { fontStyle, useChatTheme, withAlpha } from '../theme';
import type { FilePart } from '../types';

/**
 * How the viewer shows files it can't render on its own (PDFs) and how "Open in…"
 * works. See createExpoDocumentViewer (react-native-webview + expo-sharing).
 */
export type DocumentViewerAdapter = {
  /** Render a PDF inside the viewer. Return undefined if this platform can't (the viewer then offers "Open in…"). */
  renderPdf?: (file: FilePart) => React.ReactNode | undefined;
  /** Open or share the file with another app. */
  open?: (file: FilePart) => void | Promise<void>;
};

export type DocumentViewerProps = {
  /** The file to show; null hides the viewer. */
  file: FilePart | null;
  onClose: () => void;
  adapter?: DocumentViewerAdapter;
  topInset?: number;
};

const formatBytes = (n?: number) =>
  n === undefined ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const extension = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
const CODE_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'json', 'py', 'java', 'kt', 'swift', 'go', 'rs', 'rb', 'php', 'c', 'cpp', 'h', 'cs', 'sh', 'yml', 'yaml', 'toml', 'xml', 'html', 'css', 'sql', 'csv', 'tsv', 'log']);

/** Full-screen preview of a document from the chat: text files render here; PDFs through the adapter. */
export function DocumentViewer({ file, onClose, adapter, topInset = 0 }: DocumentViewerProps) {
  const theme = useChatTheme();
  const labels = useChatLabels();
  const { colors } = theme;
  const ext = file ? extension(file.name) : '';
  const isPdf = file?.mimeType === 'application/pdf' || ext === 'pdf';
  const pdf = file && isPdf ? adapter?.renderPdf?.(file) : undefined;
  const canOpen = !!file && !!adapter?.open && (!!file.uri || !!file.base64);

  let body: React.ReactNode;
  if (!file) body = null;
  else if (file.text !== undefined) {
    body =
      ext === 'md' || ext === 'markdown' || file.mimeType === 'text/markdown' ? (
        <ScrollView contentContainerStyle={styles.textBody}>
          <StreamingMarkdown color={colors.text}>{file.text}</StreamingMarkdown>
        </ScrollView>
      ) : CODE_EXTENSIONS.has(ext) ? (
        <ScrollView contentContainerStyle={styles.textBody}>
          <StreamingMarkdown color={colors.text}>{'```' + ext + '\n' + file.text + '\n```'}</StreamingMarkdown>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.textBody}>
          <Text selectable style={[{ color: colors.text, fontSize: theme.fontSize * 0.95, lineHeight: theme.lineHeight }, fontStyle(theme)]}>
            {file.text}
          </Text>
        </ScrollView>
      );
  } else if (pdf !== undefined) {
    body = <View style={styles.fill}>{pdf}</View>;
  } else {
    body = (
      <View style={styles.empty}>
        <Text style={styles.bigIcon}>📄</Text>
        <Text style={[{ color: colors.text, fontSize: theme.fontSize, textAlign: 'center' }, fontStyle(theme, 'bold')]}>{file.name}</Text>
        <Text style={[{ color: colors.textMuted, fontSize: theme.fontSize * 0.88, textAlign: 'center', marginTop: 6 }, fontStyle(theme)]}>
          {labels.noPreview}
        </Text>
      </View>
    );
  }

  return (
    <Modal visible={!!file} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background }]} accessibilityViewIsModal>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: Math.max(topInset, Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8) },
          ]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel={labels.closeDocument} hitSlop={12} onPress={onClose} style={styles.headerButton}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>✕</Text>
          </Pressable>
          <View style={styles.titleWrap}>
            <Text numberOfLines={1} accessibilityRole="header" style={[{ color: colors.text, fontSize: 15 }, fontStyle(theme, 'bold')]}>
              {file?.name}
            </Text>
            <Text style={[{ color: colors.textMuted, fontSize: 12 }, fontStyle(theme)]}>
              {[isPdf ? 'PDF' : ext ? ext.toUpperCase() : file?.mimeType, formatBytes(file?.size)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {canOpen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.openIn}
              onPress={() => file && void Promise.resolve(adapter?.open?.(file)).catch(() => {})}
              style={({ pressed }) => [styles.openButton, { backgroundColor: withAlpha(colors.accent, pressed ? 0.2 : 0.12) }]}
            >
              <Text style={[{ color: colors.accent, fontSize: 13 }, fontStyle(theme, 'bold')]}>{labels.openIn}</Text>
            </Pressable>
          ) : (
            <View style={styles.headerButton} />
          )}
        </View>
        {body}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1 },
  openButton: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  textBody: { padding: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  bigIcon: { fontSize: 56, marginBottom: 12 },
});
