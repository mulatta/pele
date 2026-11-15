import { tokenize as tokenizeOutline, type Tokens } from '../common/outline.js';
// Kanban boards are written in the mindmap outline grammar, so their nodes are found the same way.
import { parseSourcedOutline, type SourcedOutlineDb } from '../mindmap/parser.js';

export function tokenize(src: string): Tokens {
  return tokenizeOutline(src, true);
}

export function parseKanban(src: string, db: SourcedOutlineDb): void {
  parseSourcedOutline(src, db, true);
}
