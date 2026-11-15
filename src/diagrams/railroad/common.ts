import { sourceLine } from '../../errors.js';
import type { SourceInfo } from '../../types.js';
import {
  DIRECTIVE,
  Reader,
  SINGLE_LINE_COMMENT,
  YAML,
  accDescrValue,
  accTitleValue,
  keyword,
  titleValue,
  tokenize,
  type Scanner,
  type TokenType,
} from '../common/tokens.js';
import type { RailroadNode, RailroadRule } from './types.js';

// What the four railroad grammars share: the title and accessibility tokens (which, unlike
// the ones in Mermaid's common grammar, do not take leading blanks), the hidden tokens, the
// statements before the first rule, string values, and the walk from a syntax tree to the rule model.

export function isSpace(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13) || (c > 127 && /\s/.test(String.fromCharCode(c)));
}

// The braced form scans to the next closing brace. Once none is found, none exists further on
// either, so later braced descriptions fail without scanning again.
function accDescrScanner(): Scanner {
  let unclosed = Infinity;
  return (src, at) => {
    if (!src.startsWith('accDescr', at)) return -1;
    const n = src.length;
    let i = at + 8;
    while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
    if (src.charCodeAt(i) === 58) {
      for (i++; i < n; i++) {
        const c = src.charCodeAt(i);
        if (c === 10 || c === 13 || (c === 37 && src.charCodeAt(i + 1) === 37)) break;
      }
      return i;
    }
    while (i < n && isSpace(src.charCodeAt(i))) i++;
    if (src.charCodeAt(i) !== 123 || i >= unclosed) return -1;
    const close = src.indexOf('}', i + 1);
    if (close === -1) unclosed = i;
    return close + 1 || -1;
  };
}

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// `rest` matches a name suffix so `title` does not split longer names.
export function title(rest: string): TokenType {
  return { name: 'TITLE', pattern: new RegExp(String.raw`title(?:[\t ][^\n\r]*?(?=%%)|[\t ][^\n\r]*|(?!${rest}))`, 'y'), first: 't' };
}
export const ACC_TITLE: TokenType = { name: 'ACC_TITLE', pattern: /accTitle[\t ]*:(?:[^\n\r]*?(?=%%)|[^\n\r]*)/y, first: 'a' };
export const ACC_DESCR: TokenType = {
  name: 'ACC_DESCR',
  pattern: /accDescr(?:[\t ]*:([^\n\r]*?(?=%%)|[^\n\r]*)|\s*{([^}]*)})/y,
  first: 'a',
  scanner: accDescrScanner,
};

export function literal(name: string, longer?: TokenType[]): TokenType {
  return { name, pattern: name, longer };
}

// The diagram's keyword. A name that starts with it and goes on is a name.
export function opening(word: string, name: TokenType): TokenType {
  return { ...keyword(word), longer: [name] };
}

export function identifier(name: string): TokenType {
  return { name, pattern: /[A-Z_a-z][\w-]*/y, first: LETTERS + '_' };
}

export function quoted(name: string): TokenType {
  return { name, pattern: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/y, first: '"\'' };
}

// Whitespace, front matter, directive, and `%%` comment, in the order every railroad grammar lists them.
export function hiddenTokens(prefix: string): TokenType[] {
  return [
    { name: prefix + '_WHITESPACE', pattern: /[\t \r\n]+/y, hidden: true, first: '\t \r\n' },
    { ...YAML, name: prefix + '_YAML', first: '-' },
    { ...DIRECTIVE, name: prefix + '_DIRECTIVE', first: '\t %' },
    { ...SINGLE_LINE_COMMENT, name: prefix + '_SINGLE_LINE_COMMENT', first: '\t %' },
  ];
}

// Mermaid's railroad value converters know three escapes; any other escaped character stands for itself.
export function unescape(text: string): string {
  if (!text.includes('\\')) return text.slice(1, -1);
  const end = text.length - 1;
  let out = '';
  for (let i = 1; i < end; i++) {
    let c = text[i];
    if (c === '\\' && i + 1 < end) {
      c = text[++i];
      out += c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c;
    } else {
      out += c;
    }
  }
  return out;
}

// Where the tokens from `first` to the last one read are written, under `symbol`, when the host
// asks for sources. They may run over several lines.
export function stated(r: Reader, first: number, symbol: string | undefined): SourceInfo | undefined {
  const { src, starts, ends } = r.tokens;
  const line = sourceLine(src, starts[first]);
  const end = sourceLine(src, ends[r.i - 1] - 1);
  if (line === undefined || end === undefined) return undefined;
  const source: SourceInfo = end > line ? { line, end } : { line };
  if (symbol !== undefined) source.symbol = symbol;
  return source;
}

// A position kept in a syntax tree under `$`, apart from what the grammar reads, as Langium
// keeps its `$cstNode`.
export interface Stated {
  $source?: SourceInfo;
}

export interface Grammar<Type extends string, Rule> {
  $type: Type;
  title?: string;
  accTitle?: string;
  accDescr?: string;
  rules: Rule[];
}

// Parses the keyword, then any titles and accessibility statements, then rules to the end of the text.
// Every table starts with its keyword and has TITLE, ACC_TITLE, and ACC_DESCR in a row from `meta`.
export function parseGrammar<Type extends string, Rule extends { name: string } & Stated>(
  src: string,
  types: readonly TokenType[],
  $type: Type,
  meta: number,
  unquote: (text: string) => string,
  rule: (r: Reader) => Rule
): Grammar<Type, Rule> {
  const r = new Reader(tokenize(src, types, 'railroad'), types, 'railroad');
  const ast: Grammar<Type, Rule> = { $type, rules: [] };
  r.expect(0);
  for (;;) {
    const kind = r.kind;
    if (kind === meta) {
      const title = titleValue(r.take());
      const quote = title[0];
      ast.title = (quote === '"' || quote === "'") && title.endsWith(quote) ? unquote(title) : title;
    } else if (kind === meta + 1) {
      ast.accTitle = accTitleValue(r.take());
    } else if (kind === meta + 2) {
      ast.accDescr = accDescrValue(r.take());
    } else {
      break;
    }
  }
  while (r.kind !== -1) {
    const first = r.i;
    const parsed = rule(r);
    // A rule runs from its name to its semicolon.
    const source = stated(r, first, parsed.name);
    if (source !== undefined) parsed.$source = source;
    ast.rules.push(parsed);
  }
  return ast;
}

export const NONE: readonly never[] = [];

// The fields that hold a node's parts, in any of the four syntax trees and in the rule model.
interface Parent {
  alternatives?: Parent[];
  elements?: Parent[];
  element?: Parent;
  primary?: Parent;
  suffix?: Parent;
  base?: Parent;
  postfixes?: { except?: Parent }[];
}

export function parts<T>(node: T): readonly T[] {
  const p = node as Parent;
  const one = p.element ?? p.primary ?? p.suffix;
  let list = p.alternatives ?? p.elements ?? (one ? [one] : NONE);
  if (p.base) {
    list = [p.base];
    for (const postfix of p.postfixes!) if (postfix.except) list.push(postfix.except);
  }
  return list as readonly T[];
}

export const terminal = (value: string): RailroadNode => ({ type: 'terminal', value });
export const nonterminal = (name: string, source: SourceInfo | undefined): RailroadNode =>
  source === undefined ? { type: 'nonterminal', name } : { type: 'nonterminal', name, source };
export const special = (text: string): RailroadNode => ({ type: 'special', text });
export const optional = (element: RailroadNode): RailroadNode => ({ type: 'optional', element });
export const repetition = (element: RailroadNode, min: number, max = Infinity): RailroadNode => ({ type: 'repetition', element, min, max });

// A sequence or a choice of one is that one, in every notation.
export function sequence(elements: RailroadNode[]): RailroadNode {
  return elements.length === 1 ? elements[0] : { type: 'sequence', elements };
}

export function choice(alternatives: RailroadNode[]): RailroadNode {
  return alternatives.length === 1 ? alternatives[0] : { type: 'choice', alternatives };
}

// Turns each rule's syntax tree into the common model, given how one node is built from its parts.
export function toRules<Part>(
  ast: { rules: ({ name: string; definition: Part } & Stated)[] },
  build: (part: Part, kids: RailroadNode[]) => RailroadNode
): RailroadRule[] {
  return ast.rules.map((rule) => {
    const out: RailroadRule = { name: rule.name, definition: fold(rule.definition, parts, build) };
    if (rule.$source !== undefined) out.source = rule.$source;
    return out;
  });
}

// Rebuilds a tree bottom-up without recursion, so that nesting depth is bounded by memory, not by the stack.
export function fold<T, R>(root: T, children: (node: T) => readonly T[], build: (node: T, results: R[]) => R): R {
  const nodes: T[] = [root];
  const lists: (readonly T[])[] = [children(root)];
  const done: R[][] = [[]];
  for (;;) {
    const top = nodes.length - 1;
    const results = done[top];
    if (results.length < lists[top].length) {
      const child = lists[top][results.length];
      nodes.push(child);
      lists.push(children(child));
      done.push([]);
    } else {
      const value = build(nodes[top], results);
      if (top === 0) return value;
      nodes.pop();
      lists.pop();
      done.pop();
      done[top - 1].push(value);
    }
  }
}
