import React, { memo, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useChatTheme, type ChatTheme } from '../theme';
import { highlight } from './highlight';
import { parseBlocks, parseInline, type Block, type InlineNode } from './parse';

export type StreamingMarkdownProps = {
  children: string;
  /** True while tokens are still arriving: enables lenient parsing of the trailing block. */
  streaming?: boolean;
  color?: string;
  onLinkPress?: (url: string) => void;
  /** Called with the code when a code block's Copy button is tapped. Hides the button when omitted. */
  onCopyCode?: (code: string) => void;
  selectable?: boolean;
};

type Ctx = {
  theme: ChatTheme;
  color: string;
  onLinkPress: (url: string) => void;
  onCopyCode?: (code: string) => void;
  selectable: boolean;
};

export function StreamingMarkdown({
  children,
  streaming = false,
  color,
  onLinkPress,
  onCopyCode,
  selectable = true,
}: StreamingMarkdownProps) {
  const theme = useChatTheme();
  const blocks = useMemo(() => parseBlocks(children), [children]);
  const ctx: Ctx = {
    theme,
    color: color ?? theme.colors.assistantText,
    onLinkPress: onLinkPress ?? ((url) => void Linking.openURL(url).catch(() => {})),
    onCopyCode,
    selectable,
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
  (a.block.type !== 'code' || b.block.type !== 'code' || a.block.closed === b.block.closed),
);

function BlockView({ block, partial, ctx, first }: { block: Block; partial: boolean; ctx: Ctx; first: boolean }) {
  const { theme, color } = ctx;
  const base: TextStyle = { color, fontSize: theme.fontSize, lineHeight: theme.lineHeight };
  const spacing = first ? null : styles.spacing;

  switch (block.type) {
    case 'heading': {
      const scale = [1.5, 1.3, 1.15, 1.05, 1, 0.95][block.level - 1] ?? 1;
      return (
        <Text
          accessibilityRole="header"
          selectable={ctx.selectable}
          style={[base, spacing, { fontSize: theme.fontSize * scale, lineHeight: theme.fontSize * scale * 1.35, fontWeight: '700' }]}
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
      return <CodeBlock code={block.code} lang={block.lang} ctx={ctx} style={spacing} />;
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
              <Text key={i} style={styles.bold}>
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

function CodeBlock({ code, lang, ctx, style }: { code: string; lang: string; ctx: Ctx; style: any }) {
  const { theme } = ctx;
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => highlight(code, lang), [code, lang]);
  const syntaxColor = (kind: string) =>
    kind === 'plain' ? theme.colors.codeText : (theme.syntax as Record<string, string>)[kind] ?? theme.colors.codeText;

  return (
    <View style={[styles.code, style, { backgroundColor: theme.colors.codeBackground, borderRadius: theme.radius * 0.6 }]}>
      <View style={[styles.codeHeader, { backgroundColor: theme.colors.codeHeader }]}>
        <Text style={[styles.codeLang, { fontFamily: theme.monoFont }]}>{lang || 'code'}</Text>
        {ctx.onCopyCode ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy code"
            hitSlop={8}
            onPress={() => {
              ctx.onCopyCode?.(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Text style={styles.copy}>{copied ? 'Copied ✓' : 'Copy'}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text
          selectable={ctx.selectable}
          style={{ fontFamily: theme.monoFont, fontSize: theme.fontSize * 0.82, lineHeight: theme.fontSize * 1.3, color: theme.colors.codeText }}
        >
          {tokens.map((t, i) => (
            <Text key={i} style={{ color: syntaxColor(t.kind), fontStyle: t.kind === 'comment' ? 'italic' : 'normal' }}>
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
  const cellText: TextStyle = { color: ctx.color, fontSize: theme.fontSize * 0.92, lineHeight: theme.lineHeight * 0.92 };

  const renderRow = (cells: string[], header: boolean, key: number, isLast: boolean) => (
    <View key={key} style={[styles.row, { borderBottomColor: theme.colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      {Array.from({ length: columns }, (_, c) => (
        <View key={c} style={[styles.cell, { width: widths[c] }]}>
          <Text selectable={ctx.selectable} style={[cellText, header && styles.bold, { textAlign: block.align[c] ?? 'left' }]}>
            <Inline nodes={parseInline(cells[c] ?? '', partial && isLast)} ctx={ctx} />
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style}>
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
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  listItem: { flexDirection: 'row', marginTop: 4 },
  marker: { minWidth: 22, paddingRight: 6 },
  listText: { flex: 1 },
  code: { overflow: 'hidden' },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 },
  codeLang: { color: '#9AA0A8', fontSize: 12 },
  copy: { color: '#C9CDD3', fontSize: 12, fontWeight: '600' },
  codeScroll: { padding: 12 },
  table: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  cell: { paddingHorizontal: 10, paddingVertical: 8 },
});
