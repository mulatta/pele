import { sourceLine } from '../../errors.js';
import type { SourceInfo } from '../../types.js';
import {
  ACC_DESCR,
  ACC_TITLE,
  DIRECTIVE,
  NEWLINE,
  Reader,
  SINGLE_LINE_COMMENT,
  STRING,
  WHITESPACE,
  YAML,
  accDescrValue,
  accTitleValue,
  keyword,
  stringValue,
  titleBefore,
  titleValue,
  tokenize,
  type TokenType,
} from '../common/tokens.js';

const enum T {
  cherryPick,
  gitGraphColon,
  highlight,
  gitGraph,
  checkout,
  reverse,
  parent,
  commit,
  normal,
  branch,
  order,
  switch,
  type,
  merge,
  msg,
  tag,
  id,
  lr,
  tb,
  bt,
  colon,
  accDescr,
  accTitle,
  title,
  int,
  string,
  newline,
  reference = 31,
}

const REFERENCE: TokenType = { name: 'REFERENCE', pattern: /\w([-\./\w]*[-\w])?/y };
const NAME = [REFERENCE];

// A keyword that is the start of a longer name is part of that name: `commits` is a branch.
function word(name: string): TokenType {
  return { name, pattern: name, longer: NAME };
}

export const GIT_TOKENS: readonly TokenType[] = [
  word('cherry-pick'),
  { name: 'gitGraph:', pattern: 'gitGraph:' },
  word('HIGHLIGHT'),
  { ...keyword('gitGraph'), longer: NAME },
  word('checkout'),
  word('REVERSE'),
  { name: 'parent:', pattern: 'parent:' },
  word('commit'),
  word('NORMAL'),
  word('branch'),
  { name: 'order:', pattern: 'order:' },
  word('switch'),
  { name: 'type:', pattern: 'type:' },
  word('merge'),
  { name: 'msg:', pattern: 'msg:' },
  { name: 'tag:', pattern: 'tag:' },
  { name: 'id:', pattern: 'id:' },
  word('LR'),
  word('TB'),
  word('BT'),
  { name: ':', pattern: ':' },
  // Without a closing brace the block form scans to the end of the text, and a brace is not a
  // token on its own, so the first failure is final.
  { ...ACC_DESCR, opener: /[\t ]*accDescr\s*{/y },
  ACC_TITLE,
  titleBefore(String.raw`[-./\w]*[-\w]`),
  { name: 'INT', pattern: /0|[1-9][0-9]*(?!\.)/y },
  STRING,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
  REFERENCE,
];

export type CommitTypeName = 'NORMAL' | 'REVERSE' | 'HIGHLIGHT';

// Where a statement that makes a commit or a branch is written (see SourceInfo), when sources are
// recorded. It is not part of the tree the grammar describes, so like Langium's own bookkeeping
// its name starts with `$`.
export interface Written {
  $source?: SourceInfo;
}

export interface CommitAst extends Written {
  $type: 'Commit';
  id?: string;
  message?: string;
  tags: string[];
  type?: CommitTypeName;
}

export interface BranchAst extends Written {
  $type: 'Branch';
  name: string;
  order?: number;
}

export interface MergeAst extends Written {
  $type: 'Merge';
  branch: string;
  id?: string;
  tags: string[];
  type?: CommitTypeName;
}

export interface CheckoutAst {
  $type: 'Checkout';
  branch: string;
}

export interface CherryPickingAst extends Written {
  $type: 'CherryPicking';
  id?: string;
  tags: string[];
  parent?: string;
}

export type StatementAst = CommitAst | BranchAst | MergeAst | CheckoutAst | CherryPickingAst;

// Langium names the root after the `Direction` rule when the header gives a direction.
export interface GitGraphAst {
  $type: 'GitGraph' | 'Direction';
  dir?: 'LR' | 'TB' | 'BT';
  title?: string;
  accTitle?: string;
  accDescr?: string;
  statements: StatementAst[];
}

export function parseGit(src: string): GitGraphAst {
  const r = new Reader(tokenize(src, GIT_TOKENS, 'gitGraph'), GIT_TOKENS, 'gitGraph');
  const ast: GitGraphAst = { $type: 'GitGraph', statements: [] };

  const endOfLine = (): void => {
    if (r.kind === -1) return;
    if (r.kind !== T.newline) r.fail('a line break or the end of input');
    while (r.kind === T.newline) r.i++;
  };
  const name = (): string => {
    if (r.kind === T.reference) return r.take();
    if (r.kind === T.string) return stringValue(r.take());
    return r.fail('a branch name');
  };
  const string = (): string => stringValue(r.expect(T.string));
  const commitType = (): CommitTypeName => {
    if (r.kind !== T.normal && r.kind !== T.reverse && r.kind !== T.highlight) r.fail('NORMAL, REVERSE, or HIGHLIGHT');
    return r.take() as CommitTypeName;
  };
  // A statement runs from token `first` to the last one read, over several lines when a string in
  // it does. Its symbol is the name it gives what it makes, unless an escape changed how that reads.
  const { starts, ends } = r.tokens;
  const written = (node: Written, first: number, symbol?: string): void => {
    const line = sourceLine(src, starts[first]);
    if (line === undefined) return;
    const last = ends[r.i - 1];
    const end = sourceLine(src, last - 1) ?? line;
    node.$source = end > line ? { line, end } : { line };
    if (symbol && src.slice(starts[first], last).includes(symbol)) node.$source.symbol = symbol;
  };

  while (r.kind === T.newline) r.i++;
  if (!r.accept(T.gitGraphColon)) {
    r.expect(T.gitGraph);
    const next = r.kinds[r.i + 1];
    if ((r.kind === T.lr || r.kind === T.tb || r.kind === T.bt) && next === T.colon) {
      ast.$type = 'Direction';
      ast.dir = r.take() as 'LR' | 'TB' | 'BT';
      r.i++;
    } else {
      r.accept(T.colon);
    }
  }

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
      case T.commit: {
        const first = r.i++;
        const node: CommitAst = { $type: 'Commit', tags: [] };
        for (;;) {
          if (r.accept(T.id)) node.id = string();
          else if (r.accept(T.tag)) node.tags.push(string());
          else if (r.accept(T.type)) node.type = commitType();
          else if (r.accept(T.msg) || r.kinds[r.i] === T.string) node.message = string();
          else break;
        }
        written(node, first, node.id);
        endOfLine();
        ast.statements.push(node);
        break;
      }
      case T.branch: {
        const first = r.i++;
        const node: BranchAst = { $type: 'Branch', name: name() };
        if (r.accept(T.order)) node.order = parseInt(r.expect(T.int));
        written(node, first, node.name);
        endOfLine();
        ast.statements.push(node);
        break;
      }
      case T.merge: {
        const first = r.i++;
        const node: MergeAst = { $type: 'Merge', branch: name(), tags: [] };
        for (;;) {
          if (r.accept(T.id)) node.id = string();
          else if (r.accept(T.tag)) node.tags.push(string());
          else if (r.accept(T.type)) node.type = commitType();
          else break;
        }
        written(node, first, node.id);
        endOfLine();
        ast.statements.push(node);
        break;
      }
      case T.checkout:
      case T.switch: {
        r.i++;
        const node: CheckoutAst = { $type: 'Checkout', branch: name() };
        endOfLine();
        ast.statements.push(node);
        break;
      }
      case T.cherryPick: {
        const first = r.i++;
        const node: CherryPickingAst = { $type: 'CherryPicking', tags: [] };
        for (;;) {
          if (r.accept(T.id)) node.id = string();
          else if (r.accept(T.tag)) node.tags.push(string());
          else if (r.accept(T.parent)) node.parent = string();
          else break;
        }
        // The id written is the commit it copies; the copy gets an id of its own.
        written(node, first);
        endOfLine();
        ast.statements.push(node);
        break;
      }
      default:
        r.fail('a statement, a title, or a line break');
    }
  }
  return ast;
}
