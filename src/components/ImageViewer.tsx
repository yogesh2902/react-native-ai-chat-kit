import React from 'react';
import { Image, Modal, Platform, Pressable, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useChatLabels } from '../labels';

export type ImageViewerProps = {
  /** The image to show; null hides the viewer. */
  image: { uri: string; alt?: string } | null;
  onClose: () => void;
  /** Show a Share button. Default true. */
  shareable?: boolean;
  topInset?: number;
};

/** Full-screen view of an image from the chat, with Close and Share. */
export function ImageViewer({ image, onClose, shareable = true, topInset = 0 }: ImageViewerProps) {
  const labels = useChatLabels();
  const canShare = shareable && !!image && !image.uri.startsWith('data:');
  return (
    <Modal visible={!!image} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.root} accessibilityViewIsModal>
        {image ? (
          <Image
            source={{ uri: image.uri }}
            accessibilityLabel={image.alt ?? labels.image}
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            style={styles.image}
          />
        ) : null}
        <View style={[styles.bar, { paddingTop: Math.max(topInset, Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={labels.closeImage} hitSlop={12} onPress={onClose} style={styles.button}>
            <Text style={styles.buttonText}>✕</Text>
          </Pressable>
          {canShare ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.shareImage}
              hitSlop={12}
              onPress={() => {
                if (!image) return;
                void Share.share(Platform.OS === 'ios' ? { url: image.uri } : { message: image.uri }).catch(() => {});
              }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>↗</Text>
            </Pressable>
          ) : null}
        </View>
        {image?.alt ? (
          <Text style={styles.caption} numberOfLines={3}>
            {image.alt}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  button: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  caption: { position: 'absolute', bottom: 40, left: 20, right: 20, color: '#FFFFFF', textAlign: 'center', fontSize: 14, opacity: 0.85 },
});
