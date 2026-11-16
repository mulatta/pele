import type { Diagram } from '../../types.js';
import { buildPie, type PieModel } from './model.js';
import { parsePie } from './parser.js';
import { renderPie } from './render.js';

export const pie: Diagram<PieModel> = {
  type: 'pie',
  scene: true,
  parse: (source, _config, title) => buildPie(parsePie(source, true), title),
  render: renderPie,
};
