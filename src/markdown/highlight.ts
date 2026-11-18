/**
 * Small regex-based highlighter covering the languages LLMs emit most:
 * JS/TS/JSX, Python, Swift, Kotlin, Java, Go, Rust, C-like, shell, JSON, YAML,
 * SQL, CSS, HTML/XML and diffs. No dependencies and fast enough to re-run on
 * every streamed token. Swap in your own via `codeBlocks.renderCodeBlock` if needed.
 */
export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'fn'
  | 'type'
  | 'property'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attr'
  | 'inserted'
  | 'deleted'
  | 'meta';
export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue def default defer del do elif else enum export extends ' +
    'false final finally fn for from func function go guard if impl implements import in interface is lambda let match mut ' +
    'new nil none null object override package pass private protected pub public raise return self static struct super ' +
    'switch this throw throws true try type typeof undefined use val var void when where while with yield True False None ' +
    'readonly keyof satisfies declare namespace module trait loop crate mod unsafe where of instanceof delete'
  ).split(' '),
);

const SQL_KEYWORDS = new Set(
  (
    'select from where insert into values update set delete create table alter drop join left right inner outer full cross on ' +
    'group by order having limit offset as and or not null is in like ilike between distinct union all case when then else end ' +
    'primary key foreign references index view begin commit rollback returning with exists asc desc default constraint unique ' +
    'count sum avg min max coalesce true false'
  ).split(' '),
);

const HASH_COMMENT_LANGS = new Set(['py', 'python', 'sh', 'bash', 'shell', 'zsh', 'console', 'rb', 'ruby', 'yaml', 'yml', 'toml', 'dockerfile', 'r', 'makefile', '']);
const MARKUP_LANGS = new Set(['html', 'xml', 'svg', 'vue', 'svelte', 'xhtml', 'plist']);
const JSX_LANGS = new Set(['jsx', 'tsx', 'js', 'javascript', 'ts', 'typescript']);
const KEY_COLON_LANGS = new Set(['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'css', 'scss', 'less']);
const SQL_LANGS = new Set(['sql', 'postgres', 'postgresql', 'mysql', 'sqlite', 'plsql']);

const tokenRe = (hyphens: boolean) =>
  new RegExp(
  [
    /(\/\/[^\n]*|#(?![{[])[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|<!--[\s\S]*?(?:-->|$)|--[^\n]*)/.source, // 1 comment
    /("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)/.source, // 2 string
    /(\b0[xX][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/.source, // 3 number
    /(@[A-Za-z_][\w.]*)/.source, // 4 decorator / annotation
    /(<\/?[A-Za-z][\w.:-]*)/.source, // 5 tag open (only where a tag can start)
    /([A-Za-z_$][\w$]*)(?=\s*\()/.source, // 6 function call
    hyphens ? /([A-Za-z_$][\w$-]*)/.source : /([A-Za-z_$][\w$]*)/.source, // 7 identifier (CSS/HTML names may contain '-')
    /([=+\-*/%!<>&|^~?:]+)/.source, // 8 operator
    /([{}()[\];,.])/.source, // 9 punctuation
  ].join('|'),
  'g',
  );
const CODE_RE = tokenRe(false);
const HYPHEN_RE = tokenRe(true);
const HYPHEN_LANGS = new Set([...MARKUP_LANGS, 'css', 'scss', 'less', 'sass']);

/** Lines starting with + / - / @@ in a unified diff. */
function highlightDiff(code: string): Token[] {
  const tokens: Token[] = [];
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    const text = i < lines.length - 1 ? `${line}\n` : line;
    const kind: TokenKind = line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')
      ? 'meta'
      : line.startsWith('+')
        ? 'inserted'
        : line.startsWith('-')
          ? 'deleted'
          : 'plain';
    if (text) tokens.push({ kind, text });
  });
  return tokens;
}

export function highlight(code: string, lang = ''): Token[] {
  const l = lang.toLowerCase().trim();
  if (l === 'diff' || l === 'patch') return highlightDiff(code);

  const markup = MARKUP_LANGS.has(l);
  const tags = markup || JSX_LANGS.has(l) || l === '';
  const sql = SQL_LANGS.has(l);
  const hashComments = HASH_COMMENT_LANGS.has(l);
  const keyColon = KEY_COLON_LANGS.has(l);

  const TOKEN_RE = HYPHEN_LANGS.has(l) ? HYPHEN_RE : CODE_RE;
  const tokens: Token[] = [];
  let last = 0;
  let inTag = false;
  let prevSignificant = ''; // text of the last non-whitespace token
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    if (text.trim()) prevSignificant = text;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.kind === kind) prev.text += text;
    else tokens.push({ kind, text });
  };
  const followedBy = (index: number, re: RegExp) => re.test(code.slice(index, index + 40));

  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code))) {
    if (m[0] === '') {
      TOKEN_RE.lastIndex++;
      continue;
    }
    push('plain', code.slice(last, m.index));
    last = m.index + m[0].length;
    const end = last;

    if (m[1]) {
      const c = m[1];
      const isHash = c.startsWith('#');
      const isDashes = c.startsWith('--');
      const isHtml = c.startsWith('<!--');
      if ((isHash && !hashComments) || (isDashes && !sql) || (isHtml && !markup)) {
        // Not a comment in this language: emit the first character and rescan the rest.
        push(isDashes ? 'operator' : 'plain', c[0]!);
        last = m.index + 1;
        TOKEN_RE.lastIndex = last;
      } else push('comment', c);
    } else if (m[2]) {
      push(keyColon && followedBy(end, /^\s*:/) ? 'property' : 'string', m[2]);
    } else if (m[3]) {
      push(markup && !inTag ? 'plain' : 'number', m[3]);
    } else if (m[4]) {
      push(markup ? 'plain' : 'meta', m[4]);
    } else if (m[5]) {
      // A tag can start after whitespace, an opening bracket, '=', '>' or at the beginning: not in `Array<string>`.
      const before = m.index > 0 ? code[m.index - 1]! : '\n';
      if (tags && (markup || m[5].startsWith('</') || /[\s({[=>,?:&|]/.test(before))) {
        push('tag', m[5]);
        inTag = true;
      } else {
        // Treat it as an operator followed by an identifier.
        push('operator', '<');
        last = m.index + 1;
        TOKEN_RE.lastIndex = last;
      }
    } else if (m[6]) {
      const word = m[6];
      if (markup && !inTag) push('plain', word);
      else if (sql ? SQL_KEYWORDS.has(word.toLowerCase()) : KEYWORDS.has(word)) push('keyword', word);
      else push('fn', word);
    } else if (m[7]) {
      const word = m[7];
      if (inTag) push(followedBy(end, /^\s*=/) ? 'attr' : 'plain', word);
      else if (markup) push('plain', word);
      else if (sql ? SQL_KEYWORDS.has(word.toLowerCase()) : KEYWORDS.has(word)) push('keyword', word);
      else if (prevSignificant === '.' || prevSignificant === '?.') push('property', word);
      else if (keyColon && followedBy(end, /^\s*:/)) push('property', word);
      else if (/^[A-Z][A-Za-z0-9_]*[a-z][A-Za-z0-9_]*$/.test(word)) push('type', word);
      else push('plain', word);
    } else if (m[8]) {
      const op = m[8];
      if (inTag && op.includes('>')) {
        push('tag', op);
        inTag = false;
      } else push(inTag ? 'punctuation' : 'operator', op);
    } else if (m[9]) {
      push('punctuation', m[9]);
    }
  }
  push('plain', code.slice(last));
  return tokens;
}
