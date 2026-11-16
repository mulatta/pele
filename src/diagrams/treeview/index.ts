import type { Diagram } from '../../types.js';
import { buildTreeView, readTreeView, type TreeViewModel } from './model.js';
import { renderTreeView } from './render.js';

export const treeView: Diagram<TreeViewModel> = {
  type: 'treeView',
  scene: true,
  parse: (source, _config, title) => buildTreeView(readTreeView(source, true), title),
  render: renderTreeView,
};
