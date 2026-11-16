import type { Diagram } from '../../types.js';
import { BlockDb } from './db.js';
import { parseBlock } from './parser.js';
import { renderBlock } from './render.js';

export const block: Diagram<BlockDb> = {
  type: 'block',
  scene: true,
  math: true,
  parse(source, _config, title) {
    const db = new BlockDb();
    db.title = title;
    parseBlock(source, db, db.written);
    return db;
  },
  render: renderBlock,
};
