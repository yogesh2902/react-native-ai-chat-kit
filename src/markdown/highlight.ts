/**
 * Tiny regex-based highlighter covering the languages LLMs emit most
 * (JS/TS/JSX, Python, Swift, Kotlin, Java, Go, Rust, shell, JSON).
 * Good enough for chat; swap in your own via `renderCodeBlock` if needed.
 */
export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'fn';
export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue def default defer del do elif else enum export extends ' +
    'false final finally fn for from func function go guard if impl implements import in interface is lambda let match mut ' +
    'new nil none null object override package pass private protected pub public raise return self static struct super ' +
    'switch this throw throws true try type typeof undefined use val var void when where while with yield True False None'
  ).split(' '),
);

const TOKEN_RE =
  /(\/\/[^\n]*|#(?![{\[])[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;

const HASH_COMMENT_LANGS = new Set(['py', 'python', 'sh', 'bash', 'shell', 'zsh', 'rb', 'ruby', 'yaml', 'yml', 'toml', '']);

export function highlight(code: string, lang = ''): Token[] {
  const tokens: Token[] = [];
  const hashComments = HASH_COMMENT_LANGS.has(lang.toLowerCase());
  let last = 0;
  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.kind === kind) prev.text += text;
    else tokens.push({ kind, text });
  };

  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code))) {
    if (m[0] === '') {
      TOKEN_RE.lastIndex++;
      continue;
    }
    push('plain', code.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      if (m[1].startsWith('#') && !hashComments) {
        // '#' is not a comment in this language: emit '#' plainly and rescan the rest
        push('plain', '#');
        last = m.index + 1;
        TOKEN_RE.lastIndex = last;
      } else push('comment', m[1]);
    } else if (m[2]) push('string', m[2]);
    else if (m[3]) push('number', m[3]);
    else if (m[4]) push(KEYWORDS.has(m[4]) ? 'keyword' : 'fn', m[4]);
    else if (m[5]) push(KEYWORDS.has(m[5]) ? 'keyword' : 'plain', m[5]);
  }
  push('plain', code.slice(last));
  return tokens;
}
