import type { CNode, Dir } from '../../layout/compound.js';
import { laneLayout } from '../../layout/lanes.js';
import type { Out } from '../../draw/out.js';
import { num } from '../../svg/builder.js';
import { inkFill } from '../../svg/ink.js';
import type { ResolvedStyle } from '../../svg/theme.js';
import type { Label } from '../../text/label.js';
import type { Diagram, IconResolver } from '../../types.js';
import type { FlowDb } from '../flowchart/db.js';
import type { FlowGraph, GraphNode } from '../flowchart/graph.js';
import { flowchart } from '../flowchart/index.js';
import { renderFlowchart, type FlowVariant } from '../flowchart/render.js';
import type { FlowchartModel } from '../flowchart/types.js';

export type SwimlaneModel = FlowchartModel;

const DEFAULT_LANE = '__swimlane_default__';

// Nodes outside every lane share one unnamed lane, as in Mermaid. Lanes all run the same way,
// so a `direction` inside a subgraph has no effect.
function prepare(graph: FlowGraph): void {
  let loose = false;
  for (const node of graph.nodes) {
    if (node.isGroup) node.dir = undefined;
    else if (node.parentId === undefined) loose = true;
  }
  if (!loose) return;
  for (const node of graph.nodes) if (!node.isGroup && node.parentId === undefined) node.parentId = DEFAULT_LANE;
  graph.nodes.push({
    id: DEFAULT_LANE,
    label: undefined,
    labelType: 'text',
    shape: 'rect',
    isGroup: true,
    parentId: undefined,
    cssStyles: [],
    cssCompiledStyles: [],
    cssClasses: '',
    dir: undefined,
  });
}

// A lane: an outline the length of the diagram, with its title in a band at the start.
function drawLane(out: Out, c: CNode, node: GraphNode, label: Label, style: ResolvedStyle, classes: string, dir: Dir, icons: IconResolver | undefined): void {
  const left = c.x - c.w / 2;
  const top = c.y - c.h / 2;
  const sideways = dir === 'LR' || dir === 'RL';
  const cx = sideways ? left + c.padTop / 2 : c.x;
  const cy = sideways ? c.y : top + c.padTop / 2;
  out.group({ cls: `pele-cluster pele-lane${classes}`, id: node.id, source: node.source });
  out.rect(left, top, c.w, c.h, ' fill="none" stroke="var(--_b)"');
  out.rect(left, top, sideways ? c.padTop : c.w, sideways ? c.h : c.padTop, ` fill="var(--_a)" stroke="var(--_b)"${style.shape}`);
  const turned = sideways && label.lines.length > 0;
  if (turned) out.group({ attrs: ` transform="rotate(-90 ${num(cx)} ${num(cy)})"` });
  out.label(label, cx, cy, ` class="pele-cluster-label"${inkFill(style, 'var(--_m)')}${style.text}`, icons);
  if (turned) out.end();
  out.end();
}

function laneBand(c: CNode, dir: Dir): number[] {
  const left = c.x - c.w / 2;
  const top = c.y - c.h / 2;
  return dir === 'LR' || dir === 'RL' ? [left, top, left + c.padTop, top + c.h] : [left, top, left + c.w, top + c.padTop];
}

const variant: FlowVariant = {
  type: 'swimlane', prepare,
  layout: (nodes, edges, dir, options, tight) => laneLayout(nodes, edges, dir, options, tight ? 12 : undefined),
  drawGroup: drawLane,
  filledBox: laneBand,
};

// A swimlane diagram is a flowchart whose top-level subgraphs are lanes: same syntax, same model.
export const swimlane: Diagram<FlowDb> = {
  type: 'swimlane',
  math: true,
  parse: flowchart.parse,
  render: (db, config, options, out) => renderFlowchart(db, config, options, out, variant),
};
