import type { Diagram } from '../../types.js';
import { QuadrantDb } from './db.js';
import { parseQuadrant } from './parser.js';
import { renderQuadrant } from './render.js';

export const quadrantChart: Diagram<QuadrantDb> = {
  type: 'quadrantChart',
  parse(source, _config, title) {
    const db = new QuadrantDb();
    db.title = title;
    parseQuadrant(source, db, true);
    return db;
  },
  render: renderQuadrant,
};
