import { sourceLine } from '../../errors.js';
import type { SourceInfo } from '../../types.js';
import { T, parseOutline, tokenize as tokenizeOutline, type OutlineDb, type Tokens } from '../common/outline.js';

export function tokenize(src: string): Tokens {
  return tokenizeOutline(src, false);
}

// A model that is told, before each node it adds, where that node is written.
export interface SourcedOutlineDb extends OutlineDb {
  written?: SourceInfo;
}

// The tokens a node statement runs on with after its id or opening delimiter.
const PART = new Uint8Array(T.SHAPE_DATA + 1);
for (const t of [T.NODE_DSTART, T.NODE_DESCR, T.NODE_DEND, T.SHAPE_DATA]) PART[t] = 1;

// Where each node is written, in the order the parser adds them. A node starts at its id, or at
// its opening delimiter when it has none, and ends where the line break or blank line after it
// starts, so a label or metadata written over several lines spans them. Its symbol is an id
// written apart from its label (`id[label]`); a bare line is a label that may repeat.
function nodeSources(src: string, kanban: boolean): (SourceInfo | undefined)[] {
  const { types, texts, starts } = tokenizeOutline(src, kanban);
  const out: (SourceInfo | undefined)[] = [];
  for (let k = 0; k < types.length; k++) {
    const t = types[k];
    if (t !== T.NODE_ID && (t !== T.NODE_DSTART || types[k - 1] === T.NODE_ID)) continue;
    let next = k + 1;
    while (PART[types[next]] === 1) next++;
    const line = sourceLine(src, starts[k]);
    const end = sourceLine(src, starts[next] - 1);
    if (line === undefined || end === undefined) {
      out.push(undefined);
    } else {
      const info: SourceInfo = end > line ? { line, end } : { line };
      const id = texts[k].trim();
      if (t === T.NODE_ID && types[k + 1] === T.NODE_DSTART && id) info.symbol = id;
      out.push(info);
    }
    k = next - 1;
  }
  return out;
}

// Parses the outline grammar mindmaps share with kanban boards, telling `db` where each node is
// written when the host asked for sources (sourceLine says so); the nodes are then found twice.
export function parseSourcedOutline(src: string, db: SourcedOutlineDb, kanban: boolean): void {
  if (sourceLine(src, 0) === undefined) return parseOutline(src, db, kanban);
  const sources = nodeSources(src, kanban);
  let k = 0;
  parseOutline(
    src,
    {
      getType: (start, end) => db.getType(start, end),
      addNode(...args) {
        db.written = sources[k++];
        db.addNode(...args);
      },
      decorateNode: (decoration) => db.decorateNode(decoration),
    },
    kanban
  );
}

export function parseMindmap(src: string, db: SourcedOutlineDb): void {
  parseSourcedOutline(src, db, false);
}
