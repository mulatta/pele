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
  packetBeta,
  packet,
  dash,
  plus,
  colon,
  accDescr,
  accTitle,
  title,
  int,
  string,
  newline,
}

export const PACKET_TOKENS: readonly TokenType[] = [
  { name: 'packet-beta', pattern: 'packet-beta' },
  keyword('packet'),
  // A front matter block also starts with dashes, so Langium lets it win over a dash.
  { name: '-', pattern: '-', longer: [YAML] },
  { name: '+', pattern: '+' },
  { name: ':', pattern: ':' },
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  { name: 'INT', pattern: /0|[1-9][0-9]*(?!\.)/y },
  STRING,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
];

export interface PacketBlockAst {
  $type: 'PacketBlock';
  start?: number;
  end?: number;
  bits?: number;
  label: string;
  source?: SourceInfo;
}

export interface PacketAst {
  $type: 'Packet';
  title?: string;
  accTitle?: string;
  accDescr?: string;
  blocks: PacketBlockAst[];
}

// With `lines`, each field records where it is written (see sourceLine). The tests that compare
// the tree with Langium's parse without.
export function parsePacket(src: string, lines = false): PacketAst {
  const r = new Reader(tokenize(src, PACKET_TOKENS, 'packet'), PACKET_TOKENS, 'packet');
  const ast: PacketAst = { $type: 'Packet', blocks: [] };
  const { starts, ends } = r.tokens;

  const endOfLine = (): void => {
    if (r.kind === -1) return;
    if (r.kind !== T.newline) r.fail('a line break or the end of input');
    while (r.kind === T.newline) r.i++;
  };

  while (r.kind === T.newline) r.i++;
  if (!r.accept(T.packetBeta)) r.expect(T.packet);
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
      case T.int:
      case T.plus: {
        const first = r.i;
        const block: PacketBlockAst = { $type: 'PacketBlock', label: '' };
        if (r.accept(T.plus)) {
          block.bits = Number(r.expect(T.int));
        } else {
          block.start = Number(r.take());
          if (r.accept(T.dash)) block.end = Number(r.expect(T.int));
        }
        r.expect(T.colon);
        block.label = stringValue(r.expect(T.string));
        const line = lines ? sourceLine(src, starts[first]) : undefined;
        if (line !== undefined) {
          // The label may run over several lines. It is free text, which need not tell fields apart.
          const end = sourceLine(src, ends[r.i - 1] - 1) ?? line;
          block.source = end > line ? { line, end } : { line };
        }
        ast.blocks.push(block);
        endOfLine();
        break;
      }
      default:
        r.fail('a field, a title, or a line break');
    }
  }
  return ast;
}
