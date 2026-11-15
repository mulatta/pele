import { sourceLine } from '../../errors.js';
import {
  ACC_DESCR,
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
  keyword,
  stringValue,
  titleValue,
  tokenize,
  type TokenType,
} from '../common/tokens.js';

const enum T {
  keywordColon,
  keyword,
  arrow,
  colon,
  domain,
  accDescr,
  accTitle,
  title,
  string,
  newline,
}

export const CYNEFIN_TOKENS: readonly TokenType[] = [
  { name: 'cynefin-beta:', pattern: 'cynefin-beta:' },
  keyword('cynefin-beta'),
  { name: '-->', pattern: '-->' },
  { name: ':', pattern: ':' },
  { name: 'DOMAIN_NAME', pattern: /complex|complicated|clear|chaotic|confusion/y },
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  STRING,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
];

export type DomainName = 'complex' | 'complicated' | 'clear' | 'chaotic' | 'confusion';

// Where a statement is written, when sources are recorded: its first line, and its last when it
// spans several. The keys start with `$`, as Langium's own bookkeeping does, which keeps them out
// of the tree Mermaid builds.
export interface Written {
  $line?: number;
  $end?: number;
}

export interface DomainItemAst extends Written {
  $type: 'DomainItem';
  label: string;
}

export interface DomainBlockAst extends Written {
  $type: 'DomainBlock';
  domain: DomainName;
  items: DomainItemAst[];
}

export interface TransitionAst extends Written {
  $type: 'Transition';
  from: DomainName;
  to: DomainName;
  label?: string;
}

export interface CynefinAst {
  $type: 'Cynefin';
  title?: string;
  accTitle?: string;
  accDescr?: string;
  domains: DomainBlockAst[];
  transitions: TransitionAst[];
}

export function parseCynefin(src: string): CynefinAst {
  const r = new Reader(tokenize(src, CYNEFIN_TOKENS, 'cynefin'), CYNEFIN_TOKENS, 'cynefin');
  const { starts, ends } = r.tokens;
  const ast: CynefinAst = { $type: 'Cynefin', domains: [], transitions: [] };

  // Records the lines from token `first` to token `last` as where `node` is written.
  const written = (node: Written, first: number, last: number): void => {
    const line = sourceLine(src, starts[first]);
    if (line === undefined) return;
    node.$line = line;
    const end = sourceLine(src, ends[last] - 1);
    if (end !== undefined && end > line) node.$end = end;
  };

  const skipLines = (): void => {
    while (r.kinds[r.i] === T.newline) r.i++;
  };
  const endOfLine = (): void => {
    if (r.kind === -1) return;
    if (r.kind !== T.newline) r.fail('a line break or the end of input');
    skipLines();
  };

  skipLines();
  if (r.kind !== T.keyword && r.kind !== T.keywordColon) r.fail("'cynefin-beta'");
  r.i++;
  while (r.kind !== -1) {
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
      case T.domain: {
        const at = r.i;
        const name = r.take() as DomainName;
        if (r.accept(T.arrow)) {
          const transition: TransitionAst = { $type: 'Transition', from: name, to: r.expect(T.domain) as DomainName };
          if (r.accept(T.colon)) transition.label = stringValue(r.expect(T.string));
          written(transition, at, r.i - 1);
          endOfLine();
          ast.transitions.push(transition);
          break;
        }
        const block: DomainBlockAst = { $type: 'DomainBlock', domain: name, items: [] };
        // A block runs from its domain to its last item.
        let last = at;
        skipLines();
        while (r.kinds[r.i] === T.string) {
          const item: DomainItemAst = { $type: 'DomainItem', label: stringValue(r.take()) };
          last = r.i - 1;
          written(item, last, last);
          block.items.push(item);
          skipLines();
        }
        written(block, at, last);
        ast.domains.push(block);
        break;
      }
      default:
        r.fail('a domain, a transition, a title, or a line break');
    }
  }
  return ast;
}
