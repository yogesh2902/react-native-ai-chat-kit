import React, { createContext, memo, useContext, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useChatLabels } from '../labels';
import { fontStyle, useChatTheme, type ChatTheme } from '../theme';
import { highlight } from './highlight';
import { parseBlocks, parseInline, type Block, type InlineNode } from './parse';

/** How code blocks look. Pass as `codeBlocks` on ChatView (or StreamingMarkdown). */
export type CodeBlockOptions = {
  /** Syntax colors. Default true. */
  highlight?: boolean;
  /** Line numbers in a gutter. Default false. */
  lineNumbers?: boolean;
  /** 'dark' (default, editor look), 'light', or 'auto' to follow the chat's light/dark mode. */
  theme?: 'dark' | 'light' | 'auto';
  /** The header bar with the language and Copy button. Default true. */
  header?: boolean;
  /** Render code blocks yourself (e.g. with a full syntax highlighter). Return undefined to use the default. */
  renderCodeBlock?: (props: { code: string; language: string; streaming: boolean }) => React.ReactNode | undefined;
};

export const CodeBlockOptionsContext = createContext<CodeBlockOptions>({});

/** GitHub-light style colors for `codeBlocks.theme: 'light'`. */
export const lightCodeColors = {
  background: '#F6F8FA',
  header: '#EAEEF2',
  text: '#24292F',
  muted: '#57606A',
  border: 'rgba(0,0,0,0.08)',
  syntax: {
    keyword: '#CF222E',
    string: '#0A3069',
    comment: '#6E7781',
    number: '#0550AE',
    fn: '#8250DF',
    type: '#953800',
    property: '#0550AE',
    operator: '#CF222E',
    punctuation: '#24292F',
    tag: '#116329',
    attr: '#0550AE',
    inserted: '#116329',
    deleted: '#82071E',
    meta: '#8250DF',
  } as Record<string, string>,
};

const isDarkColor = (hex: string) => {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 140;
};

export type StreamingMarkdownProps = {
  children: string;
  /** True while tokens are still arriving: enables lenient parsing of the trailing block. */
  streaming?: boolean;
  color?: string;
  onLinkPress?: (url: string) => void;
  /** Called with the code when a code block's Copy button is tapped. Hides the button when omitted. */
  onCopyCode?: (code: string) => void;
  selectable?: boolean;
  /** Code block options. Defaults to the ones ChatView provides via `codeBlocks`. */
  codeBlocks?: CodeBlockOptions;
};

type Ctx = {
  theme: ChatTheme;
  color: string;
  onLinkPress: (url: string) => void;
  onCopyCode?: (code: string) => void;
  selectable: boolean;
  code: CodeBlockOptions;
};

export function StreamingMarkdown({
  children,
  streaming = false,
  color,
  onLinkPress,
  onCopyCode,
  selectable = true,
  codeBlocks,
}: StreamingMarkdownProps) {
  const theme = useChatTheme();
  const contextCode = useContext(CodeBlockOptionsContext);
  const blocks = useMemo(() => parseBlocks(children), [children]);
  const ctx: Ctx = {
    theme,
    color: color ?? theme.colors.assistantText,
    onLinkPress: onLinkPress ?? ((url) => void Linking.openURL(url).catch(() => {})),
    onCopyCode,
    selectable,
    code: codeBlocks ?? contextCode,
  };

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <MemoBlock
          key={index}
          block={block}
          partial={streaming && index === blocks.length - 1}
          ctx={ctx}
          first={index === 0}
        />
      ))}
    </View>
  );
}

/** Completed blocks have identical `raw` text between renders, so they skip re-rendering. */
const MemoBlock = memo(BlockView, (a, b) =>
  a.block.raw === b.block.raw &&
  a.partial === b.partial &&
  a.first === b.first &&
  a.ctx.theme === b.ctx.theme &&
  a.ctx.color === b.ctx.color &&
  !!a.ctx.onCopyCode === !!b.ctx.onCopyCode &&
  a.ctx.code === b.ctx.code &&
  (a.block.type !== 'code' || b.block.type !== 'code' || a.block.closed === b.block.closed),
);

function BlockView({ block, partial, ctx, first }: { block: Block; partial: boolean; ctx: Ctx; first: boolean }) {
  const { theme, color } = ctx;
  const base: TextStyle = { color, fontSize: theme.fontSize, lineHeight: theme.lineHeight, ...fontStyle(theme) };
  const spacing = first ? null : styles.spacing;

  switch (block.type) {
    case 'heading': {
      const scale = [1.5, 1.3, 1.15, 1.05, 1, 0.95][block.level - 1] ?? 1;
      return (
        <Text
          accessibilityRole="header"
          selectable={ctx.selectable}
          style={[base, spacing, { fontSize: theme.fontSize * scale, lineHeight: theme.fontSize * scale * 1.35, ...fontStyle(theme, 'bold') }]}
        >
          <Inline nodes={parseInline(block.text, partial)} ctx={ctx} />
        </Text>
      );
    }
    case 'paragraph':
      return (
        <Text selectable={ctx.selectable} style={[base, spacing]}>
          <Inline nodes={parseInline(block.text, partial)} ctx={ctx} />
        </Text>
      );
    case 'blockquote':
      return (
        <View style={[spacing, styles.quote, { borderLeftColor: theme.colors.quoteBar }]}>
          <Text selectable={ctx.selectable} style={[base, { color: theme.colors.textMuted }]}>
            <Inline nodes={parseInline(block.text, partial)} ctx={ctx} />
          </Text>
        </View>
      );
    case 'hr':
      return <View style={[styles.hr, spacing, { backgroundColor: theme.colors.border }]} />;
    case 'list':
      return (
        <View style={spacing}>
          {block.items.map((item, i) => {
            const isLast = i === block.items.length - 1;
            const marker =
              item.checked !== undefined ? (item.checked ? '☑' : '☐') : block.ordered && item.depth === 0 ? `${block.start + i}.` : item.depth > 0 ? '◦' : '•';
            return (
              <View key={i} style={[styles.listItem, { paddingLeft: item.depth * 18 }]}>
                <Text style={[base, styles.marker, { color: theme.colors.textMuted }]}>{marker}</Text>
                <Text selectable={ctx.selectable} style={[base, styles.listText]}>
                  <Inline nodes={parseInline(item.text, partial && isLast)} ctx={ctx} />
                </Text>
              </View>
            );
          })}
        </View>
      );
    case 'code':
      return <CodeBlock code={block.code} lang={block.lang} ctx={ctx} style={spacing} streaming={partial} />;
    case 'table':
      return <Table block={block} ctx={ctx} partial={partial} style={spacing} />;
    default:
      return null;
  }
}

function Inline({ nodes, ctx }: { nodes: InlineNode[]; ctx: Ctx }) {
  const { theme } = ctx;
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return node.text;
          case 'strong':
            return (
              <Text key={i} style={fontStyle(theme, 'bold')}>
                <Inline nodes={node.children} ctx={ctx} />
              </Text>
            );
          case 'em':
            return (
              <Text key={i} style={styles.italic}>
                <Inline nodes={node.children} ctx={ctx} />
              </Text>
            );
          case 'del':
            return (
              <Text key={i} style={styles.strike}>
                <Inline nodes={node.children} ctx={ctx} />
              </Text>
            );
          case 'code':
            return (
              <Text
                key={i}
                style={{
                  fontFamily: theme.monoFont,
                  fontSize: theme.fontSize * 0.88,
                  backgroundColor: theme.colors.inlineCodeBackground,
                }}
              >
                {` ${node.text} `}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={i}
                accessibilityRole="link"
                style={{ color: theme.colors.link, textDecorationLine: 'underline' }}
                onPress={() => ctx.onLinkPress(node.href)}
              >
                <Inline nodes={node.children} ctx={ctx} />
              </Text>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function CodeBlock({ code, lang, ctx, style, streaming }: { code: string; lang: string; ctx: Ctx; style: any; streaming: boolean }) {
  const { theme, code: options } = ctx;
  const labels = useChatLabels();
  const [copied, setCopied] = useState(false);
  const highlightOn = options.highlight !== false;
  const tokens = useMemo(() => (highlightOn ? highlight(code, lang) : [{ kind: 'plain' as const, text: code }]), [code, lang, highlightOn]);
  const custom = options.renderCodeBlock?.({ code, language: lang, streaming });
  if (custom !== undefined) return <View style={style}>{custom}</View>;

  const light = options.theme === 'light' || (options.theme === 'auto' && !isDarkColor(theme.colors.background));
  const palette = light
    ? { background: lightCodeColors.background, header: lightCodeColors.header, text: lightCodeColors.text, muted: lightCodeColors.muted, border: lightCodeColors.border, syntax: lightCodeColors.syntax }
    : { background: theme.colors.codeBackground, header: theme.colors.codeHeader, text: theme.colors.codeText, muted: '#9AA0A8', border: 'rgba(255,255,255,0.06)', syntax: theme.syntax as Record<string, string> };
  const syntaxColor = (kind: string) => (kind === 'plain' ? palette.text : palette.syntax[kind] ?? palette.text);
  const fontSize = theme.fontSize * 0.82;
  const lineHeight = theme.fontSize * 1.3;
  const lineCount = options.lineNumbers ? code.replace(/\n$/, '').split('\n').length : 0;

  return (
    <View style={[styles.code, style, { backgroundColor: palette.background, borderColor: palette.border, borderRadius: theme.radius * 0.7 }]}>
      {options.header !== false ? (
        <View style={[styles.codeHeader, { backgroundColor: palette.header }]}>
          <View style={styles.codeTitle}>
            <View style={styles.dots}>
              <View style={[styles.dot, { backgroundColor: '#FF5F57' }]} />
              <View style={[styles.dot, { backgroundColor: '#FEBC2E' }]} />
              <View style={[styles.dot, { backgroundColor: '#28C840' }]} />
            </View>
            <Text style={[styles.codeLang, { fontFamily: theme.monoFont, color: palette.muted }]}>{lang || 'code'}</Text>
          </View>
          {ctx.onCopyCode ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.copyCode}
              hitSlop={8}
              onPress={() => {
                ctx.onCopyCode?.(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Text style={[styles.copy, { color: light ? palette.text : '#C9CDD3' }]}>{copied ? labels.copied : `⧉ ${labels.copy}`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        {lineCount > 0 ? (
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.gutter, { fontFamily: theme.monoFont, fontSize, lineHeight, color: palette.muted }]}
          >
            {Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n')}
          </Text>
        ) : null}
        <Text selectable={ctx.selectable} style={{ fontFamily: theme.monoFont, fontSize, lineHeight, color: palette.text }}>
          {tokens.map((t, i) => (
            <Text
              key={i}
              style={{
                color: syntaxColor(t.kind),
                fontStyle: t.kind === 'comment' ? 'italic' : 'normal',
                backgroundColor: t.kind === 'inserted' ? 'rgba(46,160,67,0.15)' : t.kind === 'deleted' ? 'rgba(248,81,73,0.15)' : undefined,
              }}
            >
              {t.text}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}

function Table({ block, ctx, partial, style }: { block: Extract<Block, { type: 'table' }>; ctx: Ctx; partial: boolean; style: any }) {
  const { theme } = ctx;
  const columns = block.header.length;
  const widths = useMemo(() => {
    const w: number[] = [];
    for (let c = 0; c < columns; c++) {
      let len = block.header[c]?.length ?? 0;
      for (const row of block.rows) len = Math.max(len, row[c]?.length ?? 0);
      w.push(Math.min(260, Math.max(72, len * theme.fontSize * 0.55 + 24)));
    }
    return w;
  }, [block, columns, theme.fontSize]);
  const cellText: TextStyle = { color: ctx.color, fontSize: theme.fontSize * 0.92, lineHeight: theme.lineHeight * 0.92, ...fontStyle(theme) };

  const renderRow = (cells: string[], header: boolean, key: number, isLast: boolean) => (
    <View key={key} style={[styles.row, { borderBottomColor: theme.colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      {Array.from({ length: columns }, (_, c) => (
        <View key={c} style={[styles.cell, { width: widths[c] }]}>
          <Text selectable={ctx.selectable} style={[cellText, header && fontStyle(theme, 'bold'), { textAlign: !block.align[c] || block.align[c] === 'left' ? 'auto' : block.align[c] }]}>
            <Inline nodes={parseInline(cells[c] ?? '', partial && isLast)} ctx={ctx} />
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Don't stretch the table to the scroll view's height: on Android a
      // horizontal ScrollView can keep a taller height from mid-stream layouts.
      style={[styles.tableScroll, style]}
      contentContainerStyle={styles.tableContent}
    >
      <View style={[styles.table, { borderColor: theme.colors.border, borderRadius: theme.radius * 0.5 }]}>
        <View style={{ backgroundColor: theme.colors.inlineCodeBackground }}>{renderRow(block.header, true, -1, false)}</View>
        {block.rows.map((row, r) => renderRow(row, false, r, r === block.rows.length - 1))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexShrink: 1 },
  spacing: { marginTop: 10 },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  listItem: { flexDirection: 'row', marginTop: 4 },
  marker: { minWidth: 22, paddingRight: 6 },
  listText: { flex: 1 },
  code: { overflow: 'hidden', borderWidth: 1 },
  gutter: { textAlign: 'right', marginRight: 12, opacity: 0.6 },
  codeTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5, opacity: 0.9 },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 },
  codeLang: { fontSize: 12 },
  copy: { fontSize: 12, fontWeight: '600' },
  codeScroll: { padding: 12 },
  tableScroll: { flexGrow: 0 },
  tableContent: { alignItems: 'flex-start' },
  table: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: 10, paddingVertical: 8 },
});
