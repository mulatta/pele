import { sourceLine } from '../../errors.js';
import type { SourceInfo } from '../../types.js';
import { accDescr } from '../common/accDescr.js';
import {
  ACC_TITLE,
  DIRECTIVE,
  NEWLINE,
  Reader,
  SINGLE_LINE_COMMENT,
  STRING,
  TITLE,
  WHITESPACE,
  YAML,
  accDescrValue,
  accTitleValue,
  stringValue,
  titleValue,
  tokenize,
  type Scanner,
  type TokenType,
} from '../common/tokens.js';

const enum T {
  lbracket,
  comma,
  rbracket,
  at,
  slash,
  lparen,
  rparen,
  minus,
  lbrace,
  rbrace,
  number,
  arrow,
  linkPort,
  linkArrow,
  linkLabel,
  strategy,
  wardley,
  size,
  evolution,
  anchor,
  component,
  label,
  inertia,
  evolve,
  pipeline,
  note,
  annotations,
  annotation,
  accelerator,
  deaccelerator,
  name,
  ws,
  accDescr,
  accTitle,
  title,
  int,
  string,
  id,
  newline,
}

function digits(src: string, from: number): number {
  let i = from;
  for (let c = src.charCodeAt(i); c >= 48 && c <= 57; c = src.charCodeAt(i)) i++;
  return i;
}

// Answers as WARDLEY_NUMBER's pattern does. The pattern reads a whole run of digits before it
// finds there is no fraction, and would do so again from every digit of a long run.
function numberScanner(): Scanner {
  let from = 0;
  let end = 0;
  return (src, p) => {
    if (p < from || p >= end) {
      from = p;
      end = digits(src, p);
    }
    if (end === p || src.charCodeAt(end) !== 46) return -1;
    const stop = digits(src, end + 1);
    return stop > end + 1 ? stop : -1;
  };
}

const ARROW: TokenType = { name: 'ARROW', pattern: /->/y, first: '-' };
const LINK_ARROW: TokenType = { name: 'LINK_ARROW', pattern: /-->|-\.->|>|\+'[^']*'<>|\+'[^']*'<|\+'[^']*'>/y, first: '->+' };
const word = (name: string, text: string): TokenType => ({ name, pattern: new RegExp(text, 'y'), first: text[0] });

export const WARDLEY_TOKENS: readonly TokenType[] = [
  { name: '[', pattern: '[' },
  { name: ',', pattern: ',' },
  { name: ']', pattern: ']' },
  { name: '@', pattern: '@' },
  { name: '/', pattern: '/' },
  { name: '(', pattern: '(' },
  { name: ')', pattern: ')' },
  { name: '-', pattern: '-', longer: [ARROW, LINK_ARROW, YAML] },
  { name: '{', pattern: '{' },
  { name: '}', pattern: '}' },
  { name: 'WARDLEY_NUMBER', pattern: /[0-9]+\.[0-9]+/y, first: '0123456789', scanner: numberScanner },
  ARROW,
  { name: 'LINK_PORT', pattern: /\+<>|\+>|\+</y, first: '+' },
  LINK_ARROW,
  { name: 'LINK_LABEL', pattern: /;[^\n\r]+/y, first: ';' },
  { name: 'STRATEGY', pattern: /build|buy|outsource|market/y, first: 'bom' },
  word('KW_WARDLEY', 'wardley-beta'),
  word('KW_SIZE', 'size'),
  word('KW_EVOLUTION', 'evolution'),
  word('KW_ANCHOR', 'anchor'),
  word('KW_COMPONENT', 'component'),
  word('KW_LABEL', 'label'),
  word('KW_INERTIA', 'inertia'),
  word('KW_EVOLVE', 'evolve'),
  word('KW_PIPELINE', 'pipeline'),
  word('KW_NOTE', 'note'),
  word('KW_ANNOTATIONS', 'annotations'),
  word('KW_ANNOTATION', 'annotation'),
  word('KW_ACCELERATOR', 'accelerator'),
  word('KW_DEACCELERATOR', 'deaccelerator'),
  {
    name: 'NAME_WITH_SPACES',
    pattern: /(?!title\s|accTitle|accDescr)[A-Za-z](?:[A-Za-z0-9_()&]|-(?!>))*(?:[ \t]+[A-Za-z(](?:[A-Za-z0-9_()&]|-(?!>))*)*/y,
    first: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  },
  { name: 'WS', pattern: /[ \t]+/y, hidden: true, first: '\t ' },
  accDescr(),
  ACC_TITLE,
  TITLE,
  { name: 'INT', pattern: /0|[1-9][0-9]*(?!\.)/y, first: '0123456789' },
  STRING,
  { name: 'ID', pattern: /[\w]([-\w]*\w)?/y, first: '_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
];

// Where a statement is written, when the host asks for sources. It is kept under `$`, apart from
// what the grammar reads, as Langium keeps its `$cstNode`.
interface Stated {
  $source?: SourceInfo;
}

export interface LabelAst {
  $type: 'Label';
  negX: boolean;
  offsetX: number;
  negY: boolean;
  offsetY: number;
}

export interface StageAst {
  $type: 'EvolutionStage';
  name: string;
  boundary?: number;
  secondName?: string;
}

export interface ComponentAst extends Stated {
  $type: 'Component';
  name: string;
  visibility: number;
  evolution: number;
  label?: LabelAst;
  decorator?: { $type: 'Decorator'; strategy: string };
  inertia: boolean;
}

export interface PipelineComponentAst extends Stated {
  $type: 'PipelineComponent';
  name: string;
  evolution: number;
  label?: LabelAst;
}

export interface LinkAst extends Stated {
  $type: 'Link';
  from: string;
  fromPort?: string;
  arrow?: string;
  to: string;
  toPort?: string;
  linkLabel?: string;
}

interface Placed {
  name: string;
  x: number;
  y: number;
}

export interface WardleyAst {
  $type: 'Wardley';
  title?: string;
  accTitle?: string;
  accDescr?: string;
  size?: { $type: 'Size'; width: number; height: number };
  evolution?: { $type: 'Evolution'; stages: StageAst[] };
  anchors: ({ $type: 'Anchor'; name: string; visibility: number; evolution: number } & Stated)[];
  components: ComponentAst[];
  links: LinkAst[];
  evolves: ({ $type: 'Evolve'; component: string; target: number } & Stated)[];
  pipelines: ({ $type: 'Pipeline'; parent: string; components: PipelineComponentAst[] } & Stated)[];
  notes: { $type: 'Note'; text: string; visibility: number; evolution: number }[];
  annotations: { $type: 'Annotations'; x: number; y: number }[];
  annotation: ({ $type: 'Annotation'; number: number; x: number; y: number; text: string } & Stated)[];
  accelerators: ({ $type: 'Accelerator' } & Placed & Stated)[];
  deaccelerators: ({ $type: 'Deaccelerator' } & Placed & Stated)[];
}

export function parseWardley(src: string): WardleyAst {
  const r = new Reader(tokenize(src, WARDLEY_TOKENS, 'wardley'), WARDLEY_TOKENS, 'wardley');
  const ast: WardleyAst = {
    $type: 'Wardley',
    anchors: [],
    components: [],
    links: [],
    evolves: [],
    pipelines: [],
    notes: [],
    annotations: [],
    annotation: [],
    accelerators: [],
    deaccelerators: [],
  };

  const { starts, ends } = r.tokens;
  // Where the statement from token `first` to the last one read is written. A string may hold
  // line breaks, so a statement can run over several lines.
  const stated = (first: number): SourceInfo | undefined => {
    const line = sourceLine(src, starts[first]);
    const end = sourceLine(src, ends[r.i - 1] - 1);
    if (line === undefined || end === undefined) return undefined;
    return end > line ? { line, end } : { line };
  };
  // The name at token `k` as written. A quoted name with an escape in it does not read as written.
  const written = (k: number): string | undefined => {
    const raw = r.text(k);
    return raw.includes('\\') ? undefined : r.kinds[k] === T.string ? raw.slice(1, -1) : raw;
  };
  // A statement whose part goes by the name at token `k`.
  const named = (first: number, k: number): SourceInfo | undefined => {
    const source = stated(first);
    const symbol = source && written(k);
    return symbol === undefined ? source : { ...source, symbol };
  };
  // A link, which goes by the names of its two ends.
  const joining = (first: number, a: number, b: number): SourceInfo | undefined => {
    const source = stated(first);
    const from = source && written(a);
    const to = from === undefined ? undefined : written(b);
    return to === undefined ? source : { ...source, from, to };
  };

  const at = (kind: number): boolean => r.kinds[r.i] === kind;
  const isName = (): boolean => at(T.string) || at(T.id) || at(T.name);
  const name = (): string => {
    if (at(T.string)) return stringValue(r.take());
    if (at(T.id) || at(T.name)) return r.take();
    return r.fail('a name');
  };
  const number = (): number => Number(r.expect(T.number));
  const int = (): number => parseInt(r.expect(T.int));
  const coordinate = (): number => (at(T.number) ? Number(r.take()) : parseInt(r.expect(T.int)));
  const endOfLine = (): void => {
    if (at(-1)) return;
    if (!at(T.newline)) r.fail('a line break or the end of input');
    while (at(T.newline)) r.i++;
  };
  const pair = (read: () => number): [number, number] => {
    r.expect(T.lbracket);
    const first = read();
    r.expect(T.comma);
    const second = read();
    r.expect(T.rbracket);
    return [first, second];
  };
  const label = (): LabelAst => {
    r.expect(T.label);
    r.expect(T.lbracket);
    const negX = r.accept(T.minus);
    const offsetX = int();
    r.expect(T.comma);
    const negY = r.accept(T.minus);
    const offsetY = int();
    r.expect(T.rbracket);
    return { $type: 'Label', negX, offsetX, negY, offsetY };
  };
  const stage = (): StageAst => {
    const out: StageAst = { $type: 'EvolutionStage', name: name() };
    if (r.accept(T.at)) out.boundary = number();
    if (r.accept(T.slash)) out.secondName = name();
    return out;
  };

  while (at(T.newline)) r.i++;
  r.expect(T.wardley);
  while (!at(-1)) {
    switch (r.kind) {
      case T.newline:
        r.i++;
        break;
      case T.accDescr:
        ast.accDescr = accDescrValue(r.take());
        endOfLine();
        break;
      case T.accTitle:
        ast.accTitle = accTitleValue(r.take());
        endOfLine();
        break;
      case T.title:
        ast.title = titleValue(r.take());
        endOfLine();
        break;
      case T.size: {
        r.i++;
        const [width, height] = pair(int);
        endOfLine();
        ast.size = { $type: 'Size', width, height };
        break;
      }
      case T.evolution: {
        r.i++;
        const stages = [stage()];
        r.expect(T.arrow);
        stages.push(stage());
        while (r.accept(T.arrow)) stages.push(stage());
        endOfLine();
        ast.evolution = { $type: 'Evolution', stages };
        break;
      }
      case T.anchor: {
        const first = r.i++;
        const anchor = name();
        const [visibility, evolution] = pair(number);
        const $source = named(first, first + 1);
        endOfLine();
        ast.anchors.push({ $type: 'Anchor', name: anchor, visibility, evolution, $source });
        break;
      }
      case T.component: {
        const first = r.i++;
        const component: ComponentAst = { $type: 'Component', name: name(), visibility: 0, evolution: 0, inertia: false };
        [component.visibility, component.evolution] = pair(number);
        if (at(T.label)) component.label = label();
        if (at(T.lparen) && r.kinds[r.i + 1] === T.strategy) {
          r.i++;
          component.decorator = { $type: 'Decorator', strategy: r.take() };
          r.expect(T.rparen);
        }
        if (r.accept(T.inertia)) {
          component.inertia = true;
        } else if (r.accept(T.lparen)) {
          r.expect(T.inertia);
          r.expect(T.rparen);
          component.inertia = true;
        }
        component.$source = named(first, first + 1);
        endOfLine();
        ast.components.push(component);
        break;
      }
      case T.evolve: {
        const first = r.i++;
        const component = name();
        const target = number();
        const $source = named(first, first + 1);
        endOfLine();
        ast.evolves.push({ $type: 'Evolve', component, target, $source });
        break;
      }
      case T.pipeline: {
        const first = r.i++;
        const parent = name();
        r.expect(T.lbrace);
        r.expect(T.newline);
        while (at(T.newline)) r.i++;
        const components: PipelineComponentAst[] = [];
        do {
          const start = r.i;
          r.expect(T.component);
          const component: PipelineComponentAst = { $type: 'PipelineComponent', name: name(), evolution: 0 };
          r.expect(T.lbracket);
          component.evolution = number();
          r.expect(T.rbracket);
          if (at(T.label)) component.label = label();
          component.$source = named(start, start + 1);
          endOfLine();
          components.push(component);
        } while (at(T.component));
        r.expect(T.rbrace);
        // A pipeline spans its lines, to its closing brace.
        const $source = named(first, first + 1);
        endOfLine();
        ast.pipelines.push({ $type: 'Pipeline', parent, components, $source });
        break;
      }
      case T.note: {
        r.i++;
        const text = stringValue(r.expect(T.string));
        const [visibility, evolution] = pair(number);
        endOfLine();
        ast.notes.push({ $type: 'Note', text, visibility, evolution });
        break;
      }
      case T.annotations: {
        r.i++;
        const [x, y] = pair(coordinate);
        endOfLine();
        ast.annotations.push({ $type: 'Annotations', x, y });
        break;
      }
      case T.annotation: {
        const first = r.i++;
        const n = int();
        r.expect(T.comma);
        const [x, y] = pair(coordinate);
        const text = stringValue(r.expect(T.string));
        // An annotation is told apart by its number.
        const $source = named(first, first + 1);
        endOfLine();
        ast.annotation.push({ $type: 'Annotation', number: n, x, y, text, $source });
        break;
      }
      case T.accelerator:
      case T.deaccelerator: {
        const slow = r.kind === T.deaccelerator;
        const first = r.i++;
        const force = name();
        const [x, y] = pair(number);
        const $source = named(first, first + 1);
        endOfLine();
        if (slow) ast.deaccelerators.push({ $type: 'Deaccelerator', name: force, x, y, $source });
        else ast.accelerators.push({ $type: 'Accelerator', name: force, x, y, $source });
        break;
      }
      default: {
        if (!isName()) r.fail('a statement');
        const first = r.i;
        const link: LinkAst = { $type: 'Link', from: name(), to: '' };
        if (at(T.linkPort)) link.fromPort = r.take();
        if (at(T.linkArrow) || at(T.arrow)) link.arrow = r.take();
        const second = r.i;
        link.to = name();
        if (at(T.linkPort)) link.toPort = r.take();
        if (at(T.linkLabel)) link.linkLabel = r.take().substring(1).trim();
        link.$source = joining(first, first, second);
        endOfLine();
        ast.links.push(link);
      }
    }
  }
  return ast;
}
