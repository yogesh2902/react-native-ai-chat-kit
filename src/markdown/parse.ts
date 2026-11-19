import { isInlineMath } from './math';

/**
 * A small, dependency-free markdown parser designed for *streaming* text.
 *
 * - Block parsing is line-based and never throws on half-written input.
 * - An unclosed code fence becomes an open code block (`closed: false`).
 * - When `partial` is true, unclosed inline markers (`**bold`, `` `code ``)
 *   are styled through to the end instead of flashing as raw symbols.
 * - Every block carries its `raw` source so renderers can memoize completed
 *   blocks and only re-render the one still receiving tokens.
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'math'; tex: string };

export type ListItem = { text: string; depth: number; checked?: boolean };
export type TableAlign = 'left' | 'center' | 'right';

export type Block =
  | { type: 'heading'; level: number; text: string; raw: string }
  | { type: 'paragraph'; text: string; raw: string }
  | { type: 'code'; lang: string; code: string; closed: boolean; raw: string }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[]; raw: string }
  | { type: 'blockquote'; text: string; raw: string }
  | { type: 'table'; header: string[]; align: TableAlign[]; rows: string[][]; raw: string }
  | { type: 'hr'; raw: string }
  | { type: 'math'; tex: string; closed: boolean; raw: string }
  | { type: 'image'; src: string; alt: string; raw: string };

export type MarkdownOptions = {
  /** Parse LaTeX: `$$…$$` / `\[…\]` blocks and `$…$` / `\(…\)` inline. Default false. */
  math?: boolean;
};

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += s[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    LIST_ITEM.test(line) ||
    QUOTE.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-'))
  );
}

export function parseBlocks(source: string, options: MarkdownOptions = {}): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i++;
      continue;
    }

    // Display math: $$ … $$ or \[ … \] (possibly still open while streaming)
    if (options.math) {
      const trimmed = line.trim();
      const open = trimmed.startsWith('$$') ? '$$' : trimmed.startsWith('\\[') ? '\\[' : null;
      if (open) {
        const close = open === '$$' ? '$$' : '\\]';
        const start = i;
        const rest = trimmed.slice(2);
        const sameLine = rest.indexOf(close);
        if (sameLine !== -1) {
          blocks.push({ type: 'math', tex: rest.slice(0, sameLine).trim(), closed: true, raw: line });
          i++;
          continue;
        }
        const body = [rest];
        let closed = false;
        i++;
        while (i < lines.length) {
          const l = lines[i]!;
          const at = l.indexOf(close);
          i++;
          if (at !== -1) {
            body.push(l.slice(0, at));
            closed = true;
            break;
          }
          body.push(l);
        }
        blocks.push({ type: 'math', tex: body.join('\n').trim(), closed, raw: lines.slice(start, i).join('\n') });
        continue;
      }
    }

    // An image on its own line: ![alt](url)
    const image = line.match(IMAGE_LINE);
    if (image) {
      blocks.push({ type: 'image', alt: image[1]!, src: image[2]!, raw: line });
      i++;
      continue;
    }

    // Fenced code (possibly still open while streaming)
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] ?? '';
      const body: string[] = [];
      let closed = false;
      const start = i;
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.trim().startsWith(marker[0]!.repeat(marker.length)) && l.trim().replace(/[`~]/g, '') === '') {
          closed = true;
          i++;
          break;
        }
        body.push(l);
        i++;
      }
      blocks.push({ type: 'code', lang, code: body.join('\n'), closed, raw: lines.slice(start, i).join('\n') });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]!, raw: line });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr', raw: line });
      i++;
      continue;
    }

    // Table: header row followed by a separator row
    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-')) {
      const header = splitRow(line);
      const align: TableAlign[] = splitRow(next).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left',
      );
      const start = i;
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      blocks.push({ type: 'table', header, align, rows, raw: lines.slice(start, i).join('\n') });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      const start = i;
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        body.push(lines[i]!.match(QUOTE)![1]!);
        i++;
      }
      blocks.push({ type: 'blockquote', text: body.join('\n'), raw: lines.slice(start, i).join('\n') });
      continue;
    }

    const first = line.match(LIST_ITEM);
    if (first) {
      const ordered = /\d/.test(first[2]!);
      const start = i;
      const items: ListItem[] = [];
      const baseIndent = first[1]!.length;
      while (i < lines.length) {
        const l = lines[i]!;
        const m = l.match(LIST_ITEM);
        if (m && /\d/.test(m[2]!) === ordered) {
          const indent = m[1]!.length;
          let text = m[3]!;
          let checked: boolean | undefined;
          const task = text.match(/^\[([ xX])\]\s+(.*)$/);
          if (task) {
            checked = task[1] !== ' ';
            text = task[2]!;
          }
          items.push({ text, depth: Math.max(0, Math.floor((indent - baseIndent) / 2)), checked });
          i++;
        } else if (m && items.length > 0 && m[1]!.length > baseIndent) {
          // nested list of the other kind: keep as an indented item
          items.push({ text: m[3]!, depth: Math.max(1, Math.floor((m[1]!.length - baseIndent) / 2)) });
          i++;
        } else if (l.trim() && /^\s{2,}/.test(l) && items.length > 0) {
          // continuation of the previous item
          const last = items[items.length - 1]!;
          last.text += '\n' + l.trim();
          i++;
        } else if (!l.trim() && lines[i + 1] !== undefined && LIST_ITEM.test(lines[i + 1]!)) {
          i++; // loose list: blank line between items
        } else {
          break;
        }
      }
      blocks.push({
        type: 'list',
        ordered,
        start: ordered ? parseInt(first[2]!, 10) : 1,
        items,
        raw: lines.slice(start, i).join('\n'),
      });
      continue;
    }

    // Paragraph: consume until a blank line or another block starts
    const start = i;
    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() && (body.length === 0 || !isBlockStart(lines[i]!, lines[i + 1]))) {
      body.push(lines[i]!.trim());
      i++;
    }
    blocks.push({ type: 'paragraph', text: body.join('\n'), raw: lines.slice(start, i).join('\n') });
  }

  return blocks;
}

// Avoids Unicode property escapes for compatibility with older Hermes builds.
const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9À-￿]/.test(c);

/** Parse inline markdown. With `partial`, unclosed markers style the remainder. */
export function parseInline(src: string, partial = false, options: MarkdownOptions = {}): InlineNode[] {
  const out: InlineNode[] = [];
  let text = '';
  const pushText = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;

    // Inline math: \( … \), $$ … $$ inside a sentence, or $ … $ (not money like "$5 and $10")
    if (options.math && src.startsWith('$$', i)) {
      const end = src.indexOf('$$', i + 2);
      if (end !== -1) {
        pushText();
        out.push({ type: 'math', tex: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
      if (partial) break; // still streaming
    }
    if (options.math && (src.startsWith('\\(', i) || (c === '$' && src[i + 1] !== '$' && !isWordChar(src[i - 1])))) {
      const paren = c === '\\';
      const end = paren ? src.indexOf('\\)', i + 2) : src.indexOf('$', i + 1);
      const body = end === -1 ? '' : src.slice(i + (paren ? 2 : 1), end);
      if (end !== -1 && (paren || (isInlineMath(body) && !/\d/.test(src[end + 1] ?? '')))) {
        pushText();
        out.push({ type: 'math', tex: body });
        i = end + (paren ? 2 : 1);
        continue;
      }
      if (end === -1 && partial && paren) break; // still streaming: hide until it closes
    }

    if (c === '\\' && i + 1 < src.length && /[\\`*_~\[\]()#|>-]/.test(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end !== -1) {
        pushText();
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      if (partial) {
        pushText();
        out.push({ type: 'code', text: src.slice(i + 1) });
        break;
      }
    }

    const two = src.slice(i, i + 2);
    if (two === '**' || two === '__' || two === '~~') {
      const leftOk = two !== '__' || !isWordChar(src[i - 1]);
      const end = src.indexOf(two, i + 2);
      if (leftOk && end !== -1 && end > i + 2) {
        pushText();
        out.push({ type: two === '~~' ? 'del' : 'strong', children: parseInline(src.slice(i + 2, end), partial, options) });
        i = end + 2;
        continue;
      }
      if (leftOk && end === -1 && partial && i + 2 < src.length) {
        pushText();
        out.push({ type: two === '~~' ? 'del' : 'strong', children: parseInline(src.slice(i + 2), partial, options) });
        break;
      }
      if (leftOk && end === -1 && partial && i + 2 >= src.length) {
        break; // a lone "**" just arrived; hide it until more text comes
      }
    }

    if ((c === '*' || c === '_') && src[i + 1] !== c && src[i + 1] !== ' ' && src[i + 1] !== undefined) {
      const leftOk = c === '*' || !isWordChar(src[i - 1]);
      if (leftOk) {
        let end = -1;
        for (let j = i + 1; j < src.length; j++) {
          if (src[j] === c && src[j + 1] !== c && src[j - 1] !== ' ' && (c === '*' || !isWordChar(src[j + 1]))) {
            end = j;
            break;
          }
        }
        if (end !== -1) {
          pushText();
          out.push({ type: 'em', children: parseInline(src.slice(i + 1, end), partial, options) });
          i = end + 1;
          continue;
        }
      }
    }

    if (c === '[') {
      const close = src.indexOf('](', i + 1);
      if (close !== -1) {
        const end = src.indexOf(')', close + 2);
        const label = src.slice(i + 1, close);
        if (end !== -1) {
          pushText();
          out.push({ type: 'link', href: src.slice(close + 2, end).trim(), children: parseInline(label, partial, options) });
          i = end + 1;
          continue;
        }
        if (partial) {
          // URL still streaming: show the label as plain text for now
          pushText();
          out.push(...parseInline(label, partial, options));
          break;
        }
      }
    }

    text += c;
    i++;
  }
  pushText();
  return out;
}
