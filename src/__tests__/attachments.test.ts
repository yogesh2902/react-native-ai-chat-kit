import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64ToUtf8, createExpoAttachmentPickers, createExpoSpeechRecognizer, optimizeImage } from '../adapters/expo';
import { toSpeakableText } from '../markdown/plainText';
import { buildProviderRequest } from '../providers';
import { createProviderTransport } from '../transports/provider';
import { toSimpleMessages } from '../transports/stream';
import type { ChatMessage } from '../types';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Fake expo-image-manipulator that records the resize and returns a "JPEG" of the target size. */
function fakeManipulator() {
  const calls: { uri: string; resize?: { width?: number; height?: number }; save?: Record<string, unknown> }[] = [];
  return {
    calls,
    module: {
      ImageManipulator: {
        manipulate(uri: string) {
          const call: (typeof calls)[number] = { uri };
          calls.push(call);
          const ctx = {
            resize(size: { width?: number; height?: number }) {
              call.resize = size;
              return ctx;
            },
            async renderAsync() {
              return {
                async saveAsync(options: Record<string, unknown>) {
                  call.save = options;
                  const w = call.resize?.width ?? 1000;
                  return { uri: `file:///cache/${calls.length}.jpg`, width: w, height: Math.round(w * 0.75), base64: 'A'.repeat(4000) };
                },
              };
            },
          };
          return ctx;
        },
      },
    },
  };
}

describe('image optimization', () => {
  it('resizes large photos to 1568px and compresses to JPEG', async () => {
    const m = fakeManipulator();
    const out = await optimizeImage(m.module, { uri: 'file:///big.heic', width: 4032, height: 3024 });
    expect(m.calls[0]).toMatchObject({ resize: { width: 1568 }, save: { compress: 0.7, format: 'jpeg', base64: true } });
    expect(out.base64).toHaveLength(4000);
  });

  it('keeps small photos at their size (still compressed)', async () => {
    const m = fakeManipulator();
    await optimizeImage(m.module, { uri: 'file:///small.jpg', width: 800, height: 600 });
    expect(m.calls[0]!.resize).toBeUndefined();
    expect(m.calls[0]!.save).toMatchObject({ format: 'jpeg' });
  });

  it('bounds the longer side for portrait photos', async () => {
    const m = fakeManipulator();
    await optimizeImage(m.module, { uri: 'p.jpg', width: 3000, height: 4000 }, { maxDimension: 1024, quality: 0.5 });
    expect(m.calls[0]).toMatchObject({ resize: { height: 1024 }, save: { compress: 0.5 } });
  });
});

describe('createExpoAttachmentPickers', () => {
  it('picks and optimizes photos', async () => {
    const m = fakeManipulator();
    const ImagePicker = {
      launchImageLibraryAsync: vi.fn(async () => ({
        canceled: false,
        assets: [{ uri: 'file:///IMG_1.HEIC', width: 4032, height: 3024, fileName: 'IMG_1.HEIC', fileSize: 3_500_000 }],
      })),
    };
    const pickers = createExpoAttachmentPickers({ ImagePicker, ImageManipulator: m.module, selectionLimit: 3 });
    const [img] = await pickers.pickImages!();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], selectionLimit: 3, base64: false }));
    expect(img).toMatchObject({ kind: 'image', name: 'IMG_1.jpg', mimeType: 'image/jpeg', width: 1568, originalSize: 3_500_000, size: 3000 });
  });

  it('returns nothing when the user cancels', async () => {
    const pickers = createExpoAttachmentPickers({ ImagePicker: { launchImageLibraryAsync: async () => ({ canceled: true, assets: null }) } });
    expect(await pickers.pickImages!()).toEqual([]);
  });

  it('turns documents into PDF data, inline text, or a clear error', async () => {
    const docs = [
      { uri: 'file:///r.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 600, base64: 'JVBERi0x' },
      { uri: 'file:///n.txt', name: 'notes.txt', mimeType: 'text/plain', size: 30, base64: b64('Budget: ₹25,000 ✓') },
      { uri: 'file:///d.csv', name: 'data.csv', mimeType: 'application/octet-stream', size: 8, base64: b64('a,b\n1,2') },
    ];
    const DocumentPicker = { getDocumentAsync: vi.fn(async () => ({ canceled: false, assets: docs })) };
    const pickers = createExpoAttachmentPickers({ DocumentPicker });
    const out = await pickers.pickDocuments!();
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ base64: true, multiple: true }));
    expect(out[0]).toMatchObject({ kind: 'file', mimeType: 'application/pdf', base64: 'JVBERi0x' });
    expect(out[1]).toMatchObject({ kind: 'file', text: 'Budget: ₹25,000 ✓' });
    expect(out[2]).toMatchObject({ kind: 'file', text: 'a,b\n1,2', mimeType: 'text/plain' });

    const zip = createExpoAttachmentPickers({
      DocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets: [{ uri: 'x', name: 'a.zip', mimeType: 'application/zip', base64: 'AA==' }] }) },
    });
    await expect(zip.pickDocuments!()).rejects.toThrow('"a.zip" isn\'t supported');

    const huge = createExpoAttachmentPickers({
      maxFileBytes: 100,
      DocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets: [{ uri: 'x', name: 'big.pdf', mimeType: 'application/pdf', size: 5000, base64: 'AA==' }] }) },
    });
    await expect(huge.pickDocuments!()).rejects.toThrow('larger than');
  });

  it('decodes UTF-8 text including emoji', () => {
    expect(base64ToUtf8(b64('héllo 😀 नमस्ते'))).toBe('héllo 😀 नमस्ते');
  });
});

describe('attachments reach the model', () => {
  const message: ChatMessage = {
    id: 'u',
    role: 'user',
    createdAt: 0,
    parts: [
      { type: 'image', uri: 'file:///a.jpg', mimeType: 'image/jpeg', base64: 'IMG' },
      { type: 'file', name: 'report.pdf', mimeType: 'application/pdf', base64: 'PDF' },
      { type: 'file', name: 'notes.txt', mimeType: 'text/plain', text: 'Fly Friday' },
      { type: 'text', text: 'Plan my trip' },
    ],
  };

  it('toSimpleMessages sends images/PDFs as data and inlines text files before the question', () => {
    expect(toSimpleMessages([message])).toEqual([
      {
        role: 'user',
        content: '<document name="notes.txt">\nFly Friday\n</document>\n\nPlan my trip',
        attachments: [
          { mimeType: 'image/jpeg', data: 'IMG' },
          { mimeType: 'application/pdf', data: 'PDF', name: 'report.pdf' },
        ],
      },
    ]);
  });

  it('notes images whose data was not saved', () => {
    const old: ChatMessage = { ...message, parts: [{ type: 'image', uri: 'file:///gone.jpg' }, { type: 'text', text: 'What is this?' }] };
    expect(toSimpleMessages([old])[0]!.content).toBe('[An image was shared here but is no longer available.]\n\nWhat is this?');
  });

  it('each provider gets the right attachment format', () => {
    const [m] = toSimpleMessages([message]);
    const openai = buildProviderRequest({ provider: 'openai', apiKey: 'k', model: 'x' }, [m!]).body as any;
    expect(openai.messages[0].content.map((c: any) => c.type)).toEqual(['image_url', 'file', 'text']);
    const gemini = buildProviderRequest({ provider: 'gemini', apiKey: 'k', model: 'x' }, [m!]).body as any;
    expect(gemini.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'IMG' } });
  });
});

describe('createProviderTransport', () => {
  const g = globalThis as { __DEV__?: boolean };
  afterEach(() => {
    delete g.__DEV__;
    vi.restoreAllMocks();
  });

  it('refuses to run in production builds unless explicitly allowed', () => {
    g.__DEV__ = false;
    const config = { provider: 'anthropic' as const, apiKey: 'k', model: 'claude-sonnet-5-5' };
    expect(() => createProviderTransport(config)).toThrow('disabled in production');
    expect(() => createProviderTransport({ ...config, dangerouslyAllowApiKeyInApp: true })).not.toThrow();
  });

  it('warns in development and validates config', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => createProviderTransport({ provider: 'openai', apiKey: '', model: 'm' })).toThrow('Missing API key');
    expect(() => createProviderTransport({ provider: 'bogus' as any, apiKey: 'k', model: 'm' })).toThrow('must be one of');
    createProviderTransport({ provider: 'openai', apiKey: 'k', model: 'm' });
    expect(warn.mock.calls.flat().join(' ')).toContain('prototyping');
  });
});

describe('voice', () => {
  it('createExpoSpeechRecognizer maps partial and final results', async () => {
    const listeners: Record<string, (e: any) => void> = {};
    const module = {
      requestPermissionsAsync: async () => ({ granted: true }),
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      addListener: (event: string, fn: (e: any) => void) => {
        listeners[event] = fn;
        return { remove: () => delete listeners[event] };
      },
    };
    const seen: string[] = [];
    const recognizer = createExpoSpeechRecognizer(module, { lang: 'hi-IN' });
    await recognizer.start({
      onPartial: (t) => seen.push(`partial:${t}`),
      onFinal: (t) => seen.push(`final:${t}`),
      onError: (e) => seen.push(`error:${e.message}`),
      onEnd: () => seen.push('end'),
    });
    expect(module.start).toHaveBeenCalledWith({ lang: 'hi-IN', interimResults: true, continuous: false });
    listeners.result!({ results: [{ transcript: 'plan a' }], isFinal: false });
    listeners.result!({ results: [{ transcript: 'plan a trip' }], isFinal: true });
    listeners.error!({ error: 'no-speech', message: 'silence' }); // ignored
    listeners.end!({});
    expect(seen).toEqual(['partial:plan a', 'final:plan a trip', 'end']);
    expect(Object.keys(listeners)).toEqual([]); // cleaned up
  });

  it('reports denied microphone permission', async () => {
    const recognizer = createExpoSpeechRecognizer({
      requestPermissionsAsync: async () => ({ granted: false }),
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      addListener: () => ({ remove() {} }),
    });
    const seen: string[] = [];
    await recognizer.start({ onPartial() {}, onFinal() {}, onError: (e) => seen.push(e.message), onEnd: () => seen.push('end') });
    expect(seen).toEqual(['Microphone permission was denied.', 'end']);
  });

  it('toSpeakableText strips markdown and code for read-aloud', () => {
    const md = '# Trip\n\nI found **3 options**:\n\n- IndiGo at `06:10`\n- [Akasa](https://x.y)\n\n```js\nconsole.log(1)\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(toSpeakableText(md)).toBe('Trip\nI found 3 options:\nIndiGo at 06:10\nAkasa\n(code omitted)\nA, B\n1, 2');
  });
});
