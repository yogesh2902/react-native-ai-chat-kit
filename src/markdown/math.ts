/**
 * Turns LaTeX math into readable Unicode text (x², ½, √x, ∑, α…), with no
 * dependencies. It covers what chat models write most: fractions, powers,
 * roots, Greek letters, operators, arrows and sets. For full typesetting
 * (matrices, big operators with limits), pass your own renderer via `math.render`.
 */

const SYMBOLS: Record<string, string> = {
  // Greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Operators and relations
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', mid: '∣', parallel: '∥', perp: '⊥',
  // Calculus and big operators
  infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  lim: 'lim', log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan', max: 'max', min: 'min', det: 'det',
  // Arrows and logic
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  implies: '⇒', iff: '⇔', mapsto: '↦', uparrow: '↑', downarrow: '↓', land: '∧', wedge: '∧', lor: '∨', vee: '∨', neg: '¬', lnot: '¬',
  forall: '∀', exists: '∃', nexists: '∄', therefore: '∴', because: '∵',
  // Sets
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
  emptyset: '∅', varnothing: '∅',
  // Misc
  angle: '∠', degree: '°', prime: '′', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', hbar: 'ℏ', ell: 'ℓ',
  aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ', triangle: '△', square: '□', checkmark: '✓', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋',
  lceil: '⌈', rceil: '⌉', '|': '‖', '{': '{', '}': '}', '%': '%', '$': '$', '&': '&', '#': '#', _: '_',
};

const BLACKBOARD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼' };
const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', k: 'ᵏ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ',
  d: 'ᵈ', e: 'ᵉ', m: 'ᵐ', t: 'ᵗ', T: 'ᵀ', '*': '*', '°': '°', '′': '′',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', m: 'ₘ',
  o: 'ₒ', r: 'ᵣ', t: 'ₜ', x: 'ₓ', p: 'ₚ', s: 'ₛ', u: 'ᵤ', v: 'ᵥ',
};
const FRACTIONS: Record<string, string> = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '1/8': '⅛' };

/** Read a `{…}` group (or a single character / command) starting at `i`. */
function readArg(src: string, i: number): { value: string; end: number } {
  while (src[i] === ' ') i++;
  if (src[i] === '{') {
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return { value: src.slice(i + 1, j), end: j + 1 };
    }
    return { value: src.slice(i + 1), end: src.length };
  }
  if (src[i] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
    if (m) return { value: m[0], end: i + m[0].length };
  }
  return { value: src[i] ?? '', end: i + 1 };
}

// No Unicode property escapes: older Hermes builds don't support them.
const simple = (s: string) => /^[A-Za-z0-9.′°α-ωΑ-Ω∞]+$/.test(s) || [...s].length <= 1;
const group = (s: string) => (simple(s) ? s : `(${s})`);

function script(text: string, table: Record<string, string>, marker: string): string {
  const chars = [...text.replace(/\s+/g, '')];
  if (chars.length && chars.every((c) => table[c] !== undefined)) return chars.map((c) => table[c]).join('');
  return `${marker}${group(text)}`;
}

// Relations and binary operators get a space on each side, like typeset math.
const SPACED = new Set(['=', '+', '−', '<', '>', '×', '÷', '±', '∓', '·', '≤', '≥', '≠', '≈', '≡', '∼', '≃', '≅', '∝', '≪', '≫',
  '→', '←', '↔', '⇒', '⇐', '⇔', '↦', '∈', '∉', '∋', '⊂', '⊆', '⊃', '⊇', '∪', '∩', '∖', '∧', '∨']);
const spaced = (s: string) => (SPACED.has(s) ? ` ${s} ` : s);

/** LaTeX (without the $ delimiters) → Unicode text. */
export function texToUnicode(tex: string): string {
  let out = '';
  let i = 0;
  const src = tex.trim();
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      const name = m?.[1] ?? '';
      i += (m?.[0].length ?? 1);
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const a = readArg(src, i);
        const b = readArg(src, a.end);
        i = b.end;
        const top = texToUnicode(a.value);
        const bottom = texToUnicode(b.value);
        out += FRACTIONS[`${top}/${bottom}`] ?? `${group(top)}⁄${group(bottom)}`;
      } else if (name === 'sqrt') {
        let degree = '';
        if (src[i] === '[') {
          const close = src.indexOf(']', i);
          degree = texToUnicode(src.slice(i + 1, close === -1 ? src.length : close));
          i = close === -1 ? src.length : close + 1;
        }
        const a = readArg(src, i);
        i = a.end;
        const inner = texToUnicode(a.value);
        out += `${degree ? script(degree, SUP, '') : ''}√${group(inner)}`;
      } else if (['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'operatorname', 'textbf', 'textit', 'mbox', 'boldsymbol'].includes(name)) {
        const a = readArg(src, i);
        i = a.end;
        out += name.startsWith('text') || name === 'mbox' ? a.value : texToUnicode(a.value);
      } else if (name === 'mathbb') {
        const a = readArg(src, i);
        i = a.end;
        out += [...a.value].map((ch) => BLACKBOARD[ch] ?? ch).join('');
      } else if (name === 'overline' || name === 'bar') {
        const a = readArg(src, i);
        i = a.end;
        out += [...texToUnicode(a.value)].map((ch) => `${ch}̅`).join('');
      } else if (name === 'vec') {
        const a = readArg(src, i);
        i = a.end;
        out += `${texToUnicode(a.value)}⃗`;
      } else if (name === 'hat') {
        const a = readArg(src, i);
        i = a.end;
        out += `${texToUnicode(a.value)}̂`;
      } else if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'bigg' || name === 'Bigg' || name === 'displaystyle') {
        // Sizing only.
      } else if (name === 'begin' || name === 'end') {
        i = readArg(src, i).end; // environment name; rows and cells are handled below
      } else if (name === '\\') {
        out += '\n';
      } else if (name === ',' || name === ';' || name === ':' || name === ' ' || name === 'quad' || name === 'qquad') {
        out += name === 'qquad' ? '    ' : name === 'quad' ? '  ' : ' ';
      } else if (name === '!') {
        // negative space
      } else if (SYMBOLS[name] !== undefined) {
        const symbol = SYMBOLS[name]!;
        out += /^[a-z]{2,}$/.test(symbol) ? ` ${symbol} ` : spaced(symbol);
      } else {
        out += name; // unknown command: show its name
      }
    } else if (c === '^' || c === '_') {
      const a = readArg(src, i + 1);
      i = a.end;
      const inner = a.value === '\\circ' ? '°' : texToUnicode(a.value);
      out += c === '^' ? (inner === '°' ? '°' : script(inner, SUP, '^')) : script(inner, SUB, '_');
    } else if (c === '{' || c === '}') {
      i++;
    } else if (c === '&') {
      out += '  ';
      i++;
    } else if (c === ' ' || c === '\t' || c === '\n') {
      i++; // spacing in math source doesn't show; operators get their own
    } else if (c === '-') {
      out += spaced('−');
      i++;
    } else if (c === '=' || c === '+' || c === '<' || c === '>') {
      out += spaced(c);
      i++;
    } else if (c === '*') {
      out += '∗';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/([(\[{]) /g, '$1')
    .replace(/ ([)\]},.;!?])/g, '$1')
    .replace(/^ ([−+]) /, '$1')
    .trim();
}

/** `$…$` that looks like math, not money ("$5 and $10"). */
export function isInlineMath(body: string): boolean {
  if (!body || /^\s|\s$/.test(body)) return false;
  if (/^\d+([.,]\d+)?$/.test(body)) return false;
  return true;
}
