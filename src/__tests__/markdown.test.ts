import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from '../markdown/parse';
import { highlight } from '../markdown/highlight';

describe('parseBlocks', () => {
  it('parses common blocks', () => {
    const md = [
      '# Title',
      '',
      'Some **bold** text',
      'next line',
      '',
      '- one',
      '- two',
      '  - nested',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '---',
      '',
      '| A | B |',
      '| --- | ---: |',
      '| 1 | 2 |',
    ].join('\n');
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'blockquote', 'hr', 'table']);
    expect(blocks[1]).toMatchObject({ text: 'Some **bold** text\nnext line' });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [{ text: 'one', depth: 0 }, { text: 'two', depth: 0 }, { text: 'nested', depth: 1 }] });
    expect(blocks[3]).toMatchObject({ ordered: true, start: 1 });
    expect(blocks[6]).toMatchObject({ header: ['A', 'B'], align: ['left', 'right'], rows: [['1', '2']] });
  });

  it('keeps an unclosed code fence open while streaming', () => {
    const blocks = parseBlocks('Here:\n\n```ts\nconst a = 1;\nconst b');
    expect(blocks[1]).toMatchObject({ type: 'code', lang: 'ts', code: 'const a = 1;\nconst b', closed: false });
  });

  it('closes a fence and continues parsing', () => {
    const blocks = parseBlocks('```\nx\n```\nafter');
    expect(blocks).toMatchObject([{ type: 'code', closed: true, code: 'x' }, { type: 'paragraph', text: 'after' }]);
  });

  it('treats a header row without a separator as a paragraph (table still arriving)', () => {
    expect(parseBlocks('| A | B |')[0]?.type).toBe('paragraph');
    expect(parseBlocks('| A | B |\n| --- | --- |')[0]?.type).toBe('table');
  });

  it('does not split a paragraph on a bare pipe without a separator row', () => {
    expect(parseBlocks('a | b\nc')).toHaveLength(1);
  });

  it('parses task list items', () => {
    const [list] = parseBlocks('- [x] done\n- [ ] todo');
    expect(list).toMatchObject({ items: [{ text: 'done', checked: true }, { text: 'todo', checked: false }] });
  });

  it('gives completed blocks stable raw text as more tokens arrive', () => {
    const a = parseBlocks('Para one\n\nPara tw');
    const b = parseBlocks('Para one\n\nPara two is longer');
    expect(a[0]?.raw).toBe(b[0]?.raw);
    expect(a[1]?.raw).not.toBe(b[1]?.raw);
  });

  it('never throws on random partial input', () => {
    const sample = '# H\n**bo `co ```js\nfn(\n| a |\n|-\n> q\n- [ ] x\n1) y\n***\n[l](ht';
    for (let i = 0; i <= sample.length; i++) {
      expect(() => parseBlocks(sample.slice(0, i))).not.toThrow();
      expect(() => parseInline(sample.slice(0, i), true)).not.toThrow();
    }
  });
});

describe('parseInline', () => {
  it('parses emphasis, code and links', () => {
    expect(parseInline('a **b** *c* `d` ~~e~~ [f](https://x.y)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'del', children: [{ type: 'text', text: 'e' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.y', children: [{ type: 'text', text: 'f' }] },
    ]);
  });

  it('styles unclosed markers through the end when partial', () => {
    expect(parseInline('hello **wor', true)).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'strong', children: [{ type: 'text', text: 'wor' }] },
    ]);
    expect(parseInline('run `npm i', true)).toEqual([
      { type: 'text', text: 'run ' },
      { type: 'code', text: 'npm i' },
    ]);
  });

  it('hides a dangling marker while partial, keeps it literal when complete', () => {
    expect(parseInline('hello **', true)).toEqual([{ type: 'text', text: 'hello ' }]);
    expect(parseInline('2 ** 3')).toEqual([{ type: 'text', text: '2 ** 3' }]);
  });

  it('shows link label while the URL is still streaming', () => {
    expect(parseInline('see [docs](https://reac', true)).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'docs' },
    ]);
  });

  it('does not italicize snake_case words', () => {
    expect(parseInline('use my_var_name here')).toEqual([{ type: 'text', text: 'use my_var_name here' }]);
  });

  it('handles escapes', () => {
    expect(parseInline('\\*not em\\*')).toEqual([{ type: 'text', text: '*not em*' }]);
  });
});

describe('highlight', () => {
  it('tokenizes keywords, strings, comments, numbers and calls', () => {
    const tokens = highlight('const x = "hi"; // note\nfoo(42)', 'ts');
    const kinds = Object.fromEntries(tokens.filter((t) => t.kind !== 'plain').map((t) => [t.text, t.kind]));
    expect(kinds).toMatchObject({ const: 'keyword', '"hi"': 'string', '// note': 'comment', foo: 'fn', '42': 'number' });
  });

  it('round-trips the source text', () => {
    const src = 'def f(a):\n    # c\n    return a + 1  # done\n#include <x>';
    expect(highlight(src, 'py').map((t) => t.text).join('')).toBe(src);
    expect(highlight(src, 'c').map((t) => t.text).join('')).toBe(src);
  });
});
