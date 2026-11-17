import { cnode, compoundLayout, direction, shiftLayout, type CEdge, type CNode } from '../../layout/compound.js';
import type { Out } from '../../draw/out.js';
import { titleLabel } from '../../svg/title.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, num, type IconResolver } from '../../svg/builder.js';
import { markCrossings, type Crossings } from '../../svg/cluster.js';
import { CASINGS_ATTRS, casingAttrs, edgeInk, fillUnder, drawMarker, markerTrim, routePath, type EdgePath, type Fill } from '../../svg/edges.js';
import { inkFill, paints } from '../../svg/ink.js';
import { classNames, resolveStyle, rounded, setsFill, type ResolvedStyle } from '../../svg/theme.js';
import { labelLine, layoutLabel, lineMiddle, type Label } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { runsAcross, turnToFit } from '../common/fit-width.js';
import { buildUsecaseGraph, type UsecaseGraphEdge, type UsecaseGraphNode } from './graph.js';
import type { UsecaseModel } from './types.js';

const NODE_SEP = 32;
const EDGE_SEP = 16;
const RANK_SEP = 72;
const GROUP_PAD = 20;
const LOOP = 26;
const FIGURE_W = 40;
const FIGURE_H = 60;
const FIGURE_GAP = 6;
const TAB_PAD = 6;
const CELL_PAD = 10;
const ROW_PAD = 8;
const FOLD = 9;
const EXTENSION = 12;
const PORT_GAP = 14;
const MARKED = new Set(['extension', 'arrow_point', 'arrow_circle', 'arrow_cross']);
const SHAPE_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"';

const enum Kind {
  Actor,
  Ellipse,
  Box,
  Json,
  Boundary,
}

interface View {
  node: UsecaseGraphNode;
  kind: Kind;
  style: ResolvedStyle;
  label: Label;
  stereotype: Label;
  // The size of what is drawn; the layout box is larger when the node carries a self-relationship.
  w: number;
  h: number;
  rows: [key: Label, value: Label][];
  keyW: number;
  headH: number;
  loops: number;
}

function numberOption(config: Config, key: string, fallback: number): number {
  const value = (config.usecase as Config | undefined)?.[key];
  return typeof value === 'number' && value > 0 ? Math.min(value, 2000) : fallback;
}

// A plain label is shown as written: no tags, no markdown, no `\n` breaks. Its markup characters
// are handed to the label parser as character references, which it turns back into characters.
function literal(text: string): string {
  return text.replace(/[&<>\\]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function text(
  raw: string | undefined,
  markdown: boolean,
  measurer: TextMeasurer,
  size: number,
  wrap: number,
  base = 0
): Label {
  return layoutLabel(raw && !markdown ? literal(raw) : raw, markdown, measurer, size, wrap, base);
}

// The point of a node's outline on one of its four sides (0 top, 1 right, 2 bottom, 3 left),
// `along` away from the middle of that side. Lines meet an actor at its figure, not at its label.
function anchor(view: View, c: CNode, side: number, along: number): [number, number] {
  const sign = side === 1 || side === 2 ? 1 : -1;
  const upright = side === 1 || side === 3;
  let reach = (upright ? view.w : view.h) / 2;
  let middle = 0;
  if (view.kind === Kind.Actor) {
    if (upright) {
      reach = FIGURE_W / 2 + 3;
      middle = (FIGURE_H - view.h) / 2;
    } else reach += 2;
  } else if (view.kind === Kind.Ellipse) {
    const span = (upright ? view.h : view.w) / 2;
    reach *= Math.sqrt(Math.max(1 - (along / span) ** 2, 0));
  }
  return upright ? [c.x + sign * reach, c.y + middle + along] : [c.x + along, c.y + sign * reach];
}

// How much of a side edges may spread over.
function sideLength(view: View, side: number): number {
  const upright = side === 1 || side === 3;
  if (view.kind === Kind.Actor) return upright ? FIGURE_H * 0.5 : FIGURE_W * 0.6;
  const length = upright ? view.h : view.w;
  return view.kind === Kind.Ellipse ? length * 0.6 : length - 16;
}

interface End {
  route: number[];
  at: number;
  toward: number;
}

// The layout brings every edge that ends on one side of a node to the middle of that side. This
// spaces them along the side in the order they fan out, and puts each on the node's outline.
function attachEnds(cedges: CEdge[], cnodes: CNode[], views: View[]): void {
  const sides = new Map<number, End[]>();
  const add = (index: number, route: number[], at: number, next: number): void => {
    const c = cnodes[index];
    if (c.isGroup) return;
    const dx = route[at] - c.x;
    const dy = route[at + 1] - c.y;
    let side: number;
    if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) side = dy < 0 ? 0 : 2;
    else if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) side = dx < 0 ? 3 : 1;
    else return;
    const key = index * 4 + side;
    const end = { route, at, toward: route[next + (side & 1 ? 1 : 0)] };
    const list = sides.get(key);
    if (list) list.push(end);
    else sides.set(key, [end]);
  };
  for (const e of cedges) {
    const last = e.route.length - 3;
    if (e.src === e.dst || last < 3) continue;
    add(e.src, e.route, 0, 3);
    add(e.dst, e.route, last, last - 3);
  }
  for (const [key, ends] of sides) {
    const index = key >> 2;
    const side = key & 3;
    const view = views[index];
    const step = ends.length > 1 ? Math.min(PORT_GAP, sideLength(view, side) / (ends.length - 1)) : 0;
    ends.sort((a, b) => a.toward - b.toward);
    for (let i = 0; i < ends.length; i++) {
      const [x, y] = anchor(view, cnodes[index], side, (i - (ends.length - 1) / 2) * step);
      ends[i].route[ends[i].at] = x;
      ends[i].route[ends[i].at + 1] = y;
    }
  }
}

// The hollow triangle of a generalization, with its tip at (x, y).
function drawExtension(out: Out, x: number, y: number, dx: number, dy: number, fill: string, color: string, cls: boolean): void {
  const bx = x - dx * EXTENSION;
  const by = y - dy * EXTENSION;
  const half = EXTENSION * 0.5;
  out.path(
    out.pen().M(x, y).L(bx - dy * half, by + dx * half).L(bx + dy * half, by - dx * half).Z(),
    ` fill="${fill}" stroke="${color}" stroke-linejoin="round"`,
    undefined,
    cls ? { cls: 'pele-marker' } : undefined
  );
}

function trim(type: string): number {
  return type === 'extension' ? EXTENSION : markerTrim(type);
}

function drawFigure(out: Out, view: View, icons: IconResolver | undefined): void {
  const node = view.node;
  const shape = view.style.shape;
  const line = ` fill="none" stroke="var(--_b)"${view.style.line}`;
  let head = -21;
  let radius = 9;
  if (node.actorType === 'hollow') {
    radius = 8;
    out.circle(null, -21, 8, ` fill="var(--_bg)" stroke="var(--_b)"${shape}`);
    out.path(
      out.pen().M(-20, -9).H(20).V(0).H(5.5).L(20, 15.5).L(12, 25.5).L(0, 12).L(-12, 25.5).L(-20, 15.5).L(-5.5, 0).H(-20).Z(),
      ` fill="var(--_bg)" stroke="var(--_b)" stroke-linejoin="round"${shape}`
    );
  } else if (node.actorType === 'awesome') {
    out.path(
      out.pen().M(0, -30).A(11, 11, 0, 1, 1, 0, -8).A(11, 11, 0, 1, 1, 0, -30).Z().M(-20, 25).C(-20, 9, -12, -3, 0, -3).C(12, -3, 20, 9, 20, 25).C(20, 28, 18, 30, 15, 30).H(-15).C(-18, 30, -20, 28, -20, 25).Z(),
      ` fill="var(--_b)"${shape}`
    );
  } else if (node.actorType === 'icon') {
    head = -14;
    radius = 12;
    out.rect(-22, -26, 44, 44, rounded(SHAPE_ATTRS + shape));
    out.opaque(
      `<svg class="pele-icon" data-icon="${escText(node.icon ?? '')}" x="-14" y="-18" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
        icons?.(node.icon ?? '') ?? ''
      }</svg>`,
      'icon'
    );
  } else {
    out.circle(null, -21, 9, `${SHAPE_ATTRS}${shape}`);
    out.path(out.pen().M(0, -12).V(10).M(-14, -3).H(14).M(0, 10).L(-12, 30).M(0, 10).L(12, 30), line);
  }
  if (node.business) {
    // The slash of a business actor: a chord across the lower right of the head.
    out.path(out.pen().M(0.12 * radius, head + 0.99 * radius).L(0.92 * radius, head - 0.39 * radius), line, undefined, { cls: 'pele-business' });
  }
}

export function renderUsecase(model: UsecaseModel, config: Config, options: RenderOptions, out: Out): Rendered {
  if (!runsAcross(model.direction)) return draw(out, model, config, options, false);
  return turnToFit(options, (down, o) => draw(o, model, config, options, down), out);
}

// `turned` draws a diagram that runs across as one that runs down.
function draw(out: Out, model: UsecaseModel, config: Config, options: RenderOptions, turned: boolean): Rendered {
  const graph = buildUsecaseGraph(model);
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.8125);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const icons = options.icons;
  const rootDir = turned ? 'TB' : direction(model.direction);
  const sideways = rootDir === 'LR' || rootDir === 'RL';

  const index = new Map<string, number>();
  const views: View[] = [];
  const cnodes: CNode[] = [];
  graph.nodes.forEach((node, i) => index.set(node.id, i));

  for (const node of graph.nodes) {
    const style = resolveStyle(node.cssStyles.length > 0 ? node.cssCompiledStyles.concat(node.cssStyles) : node.cssCompiledStyles);
    const base = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    const fontSize = style.fontSize ?? size;
    const markdown = node.labelType === 'markdown';
    const stereotype = text(node.stereotype && `«${node.stereotype}»`, false, measurer, tiny, 200, base);
    const view: View = { node, kind: Kind.Box, style, label: stereotype, stereotype, w: 0, h: 0, rows: [], keyW: 0, headH: 0, loops: 0 };
    let c: CNode;
    if (node.isGroup) {
      view.kind = Kind.Boundary;
      view.label = text(node.label, markdown, measurer, fontSize, 4000, base);
      const titleH = view.label.height;
      c = cnode(0, 0);
      c.isGroup = true;
      c.padX = GROUP_PAD;
      c.padBottom = GROUP_PAD;
      c.padTop = node.boundaryType === 'package' ? titleH + 2 * TAB_PAD + 16 : titleH > 0 ? titleH + 16 : GROUP_PAD;
      c.minW = view.label.width + 2 * GROUP_PAD;
    } else {
      if (node.jsonRows) {
        view.kind = Kind.Json;
        view.label = text(node.label, false, measurer, fontSize, 4000, base | Style.Bold);
        let valueW = 0;
        for (const row of node.jsonRows) {
          const key = text(row.key, false, measurer, small, 4000, base);
          const value = text(row.value, false, measurer, small, 260, base);
          view.rows.push([key, value]);
          view.keyW = Math.max(view.keyW, key.width);
          valueW = Math.max(valueW, value.width);
          view.h += Math.max(key.height, value.height, Math.round(small * 1.5)) + ROW_PAD;
        }
        // The root of an empty object has a value and no key, and then there is no key column.
        if (view.keyW > 0) view.keyW += 2 * CELL_PAD;
        view.headH = Math.max(view.label.height, Math.round(fontSize * 1.5)) + ROW_PAD;
        view.w = Math.max(view.label.width + 2 * CELL_PAD, view.rows.length > 0 ? view.keyW + valueW + 2 * CELL_PAD : 0, 72);
        view.h += view.headH;
      } else if (node.actorType) {
        view.kind = Kind.Actor;
        view.label = text(node.label, markdown, measurer, fontSize, 140, base);
        view.w = Math.max(FIGURE_W, view.label.width, stereotype.width);
        view.h = FIGURE_H + FIGURE_GAP + stereotype.height + view.label.height;
      } else {
        view.label = text(node.label, markdown, measurer, node.shape === 'note' ? small : fontSize, 180, base);
        const tw = Math.max(view.label.width, stereotype.width);
        const th = view.label.height + stereotype.height;
        if (node.shape === 'usecaseEllipse' || node.shape === 'usecaseBusiness') {
          view.kind = Kind.Ellipse;
          // An oval needs more room around its text than a box, and a business oval room for its slash.
          view.w = Math.max(tw + 2 * node.padding + (node.business ? 16 : 4), 88);
          view.h = Math.max(th + 28, 48);
        } else if (node.shape === 'note') {
          view.w = tw + 2 * node.padding + 6;
          view.h = th + 18;
        } else {
          view.w = Math.max(tw + 2 * node.padding + 12, 80);
          view.h = Math.max(th + 24, 44);
        }
      }
      c = cnode(view.w, view.h);
    }
    c.seq = views.length;
    views.push(view);
    cnodes.push(c);
  }
  graph.nodes.forEach((node, i) => {
    cnodes[i].parent = node.parentId !== undefined ? (index.get(node.parentId) ?? -1) : -1;
  });

  const cedges: CEdge[] = [];
  const edgeLabels: Label[] = [];
  const drawn: UsecaseGraphEdge[] = [];
  for (const edge of graph.edges) {
    const src = index.get(edge.start);
    const dst = index.get(edge.end);
    if (src === undefined || dst === undefined) continue;
    const semantic = edge.relationshipType === 'include' || edge.relationshipType === 'extend';
    const label = text(semantic ? `«${edge.label}»` : edge.label, edge.labelType === 'markdown', measurer, small, 200);
    if (src === dst) {
      // A self-relationship loops out across the flow, and the node's box grows to hold it.
      views[src].loops++;
      if (sideways) cnodes[src].h += 2 * (LOOP + (label.height > 0 ? label.height + 8 : 0));
      else cnodes[src].w += 2 * (LOOP + (label.width > 0 ? label.width + 12 : 0));
    }
    drawn.push(edge);
    edgeLabels.push(label);
    cedges.push({
      src,
      dst,
      minlen: edge.minlen,
      labelW: label.width > 0 ? label.width + 12 : 0,
      labelH: label.height > 0 ? label.height + 4 : 0,
      route: [],
      labelX: 0,
      labelY: 0,
    });
  }

  const layout = compoundLayout(cnodes, cedges, rootDir, {
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    edgeSep: EDGE_SEP,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    portSep: 20,
  });

  const title = titleLabel(model.title, measurer, size, 4000);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(layout.width, title.width);
  const ox = pad + (inner - layout.width) / 2;
  const oy = pad + titleHeight;
  shiftLayout(cnodes, cedges, ox, oy);
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(layout.height + titleHeight + 2 * pad);

  // Where edges cross each boundary's top border, so that a title can keep out of their way.
  const crossings: Crossings = new Map();
  for (const e of cedges) markCrossings(crossings, e.route);
  attachEnds(cedges, cnodes, views);

  out.label(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  out.section('clusters', ' class="pele-clusters"');
  out.section('casings', CASINGS_ATTRS);
  out.section('edges', ' class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round"');
  out.section('labels', ` class="pele-edge-labels" font-size="${small}"`);
  out.section('nodes', ' class="pele-nodes"', true);
  const fills: Fill[] = [];
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const c = cnodes[i];
    const node = view.node;
    const classes = classNames(node.cssClasses.replace(/^default\s?/, ''));
    const textAttrs = view.style.text;
    const shape = view.style.shape;
    const color = inkFill(view.style);
    const muted = color || ' fill="var(--_m)"';
    const w = view.w;
    const h = view.h;

    if (view.kind === Kind.Boundary) {
      const x = c.x - c.w / 2;
      const y = c.y - c.h / 2;
      if (paints(shape)) fills.push({ box: [x, y, x + c.w, y + c.h], shape });
      const box = ` fill="var(--_a)"${setsFill(shape) ? '' : ' fill-opacity="0.5"'} stroke="var(--_b)"${shape}`;
      const titleAttrs = ` class="pele-cluster-label"${muted}${textAttrs}`;
      out.section('clusters');
      out.group({ cls: `pele-cluster pele-boundary${classes}`, id: node.id, source: node.written });
      if (node.boundaryType === 'package') {
        const tabW = Math.min(view.label.width + 2 * TAB_PAD + 8, c.w);
        const tabH = view.label.height + 2 * TAB_PAD;
        out.rect(x, y, tabW, tabH, box, { cls: 'pele-boundary-tab' });
        out.rect(x, y + tabH, c.w, c.h - tabH, box);
        out.label(view.label, x + tabW / 2, y + tabH / 2, titleAttrs, icons);
      } else {
        out.rect(x, y, c.w, c.h, rounded(box));
        out.label(view.label, titleX(c, view.label.width, crossings), y + 8 + view.label.height / 2, titleAttrs, icons);
      }
      out.end();
      continue;
    }

    out.section('nodes');
    const classed = (kind: string): void => out.group({ cls: `pele-node ${kind}${classes}`, id: node.id, source: node.written, x: c.x, y: c.y });
    if (view.kind === Kind.Actor) {
      classed('pele-actor');
      const top = -h / 2;
      const stereotypeY = top + FIGURE_H + FIGURE_GAP + view.stereotype.height / 2;
      out.group({ cls: 'pele-actor-figure', x: 0, y: top + FIGURE_H / 2 });
      drawFigure(out, view, icons);
      out.end();
      out.label(view.stereotype, 0, stereotypeY, ` class="pele-stereotype" font-size="${tiny}" fill="var(--_m)"`, icons);
      out.label(view.label, 0, h / 2 - view.label.height / 2, ` class="pele-label"${textAttrs}`, icons);
    } else if (view.kind === Kind.Json) {
      classed('pele-json');
      const x0 = -w / 2;
      let y = -h / 2 + view.headH;
      const lines = out.pen().M(x0, y).H(x0 + w);
      if (view.keyW > 0) lines.M(x0 + view.keyW, y).V(h / 2);
      out.rect(x0, -h / 2, w, h, rounded(SHAPE_ATTRS + shape));
      out.path(lines, ` fill="none" stroke="var(--_b)"${view.style.line}`, undefined, { cls: 'pele-json-lines' });
      out.label(view.label, 0, -h / 2 + view.headH / 2, ` class="pele-label" font-weight="var(--_hw)"${color}${textAttrs}`, icons);
      out.group({ attrs: ` font-size="${small}"` });
      for (const [key, value] of view.rows) {
        const rowH = Math.max(key.height, value.height, Math.round(small * 1.5)) + ROW_PAD;
        out.label(key, x0 + CELL_PAD + key.width / 2, y + rowH / 2, ` class="pele-json-key"${muted}`, icons);
        leftLabel(out, value, x0 + view.keyW + CELL_PAD, y + rowH / 2, ` class="pele-json-value"${color}${textAttrs}`, icons);
        y += rowH;
      }
      out.end();
    } else {
      const labelY = view.stereotype.height / 2;
      if (view.kind === Kind.Ellipse) {
        classed('pele-usecase');
        out.ellipse(null, null, w / 2, h / 2, `${SHAPE_ATTRS}${shape}`);
        if (node.business) {
          // The slash of a business use case, cutting off the right end of the oval beside the text.
          const from = w / 2 - 15;
          const to = w / 2 - 5;
          const arc = (at: number): number => (h / 2) * Math.sqrt(1 - (at / (w / 2)) ** 2);
          out.path(out.pen().M(from, arc(from)).L(to, -arc(to)), ` fill="none" stroke="var(--_b)"${view.style.line}`, undefined, { cls: 'pele-business' });
        }
      } else if (node.shape === 'note') {
        classed('pele-note');
        const r = w / 2;
        const b = h / 2;
        out.path(out.pen().M(-r, -b).H(r - FOLD).L(r, FOLD - b).V(b).H(-r).Z(), ` fill="var(--_a)" stroke="var(--_b)" stroke-linejoin="round"${shape}`);
        out.path(out.pen().M(r - FOLD, -b).V(FOLD - b).H(r), ` fill="none" stroke="var(--_b)" stroke-linejoin="round"${view.style.line}`);
      } else {
        classed('pele-usecase');
        out.rect(-w / 2, -h / 2, w, h, rounded(SHAPE_ATTRS + shape));
      }
      out.label(view.stereotype, 0, -view.label.height / 2, ` class="pele-stereotype" font-size="${tiny}"${muted}`, icons);
      out.label(view.label, 0, labelY, ` class="pele-label"${node.shape === 'note' ? ` font-size="${small}"` : ''}${color}${textAttrs}`, icons);
    }
    out.end();
  }

  const loopSeen = new Map<number, number>();
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const label = edgeLabels[i];
    const style = edge.style.length > 0 || edge.cssCompiledStyles.length > 0 ? resolveStyle(edge.cssCompiledStyles.concat(edge.style)) : undefined;
    const startType = edge.arrowTypeStart;
    const endType = edge.arrowTypeEnd;
    let path: EdgePath;
    if (ce.src === ce.dst) {
      const c = cnodes[ce.src];
      const view = views[ce.src];
      const k = loopSeen.get(ce.src) ?? 0;
      loopSeen.set(ce.src, k + 1);
      const side = sideways ? 2 : 1;
      const spread = Math.min(sideLength(view, side) / 2, 8 + k * 6);
      const reach = LOOP + k * 8;
      const [ax, ay] = anchor(view, c, side, -spread);
      const [bx, by] = anchor(view, c, side, spread);
      const len = Math.hypot(reach, spread) || 1;
      const ux = sideways ? spread / len : reach / len;
      const uy = sideways ? reach / len : spread / len;
      const st = trim(startType);
      const et = trim(endType);
      // Both ends leave the node leaning away from each other, and the curve joins them outside it.
      const bend = (x: number, y: number, sign: number, far: number): string =>
        sideways ? `${num(x + sign * spread * (far ? 1 : 0))},${num(y + far)}` : `${num(x + far)},${num(y + sign * spread * (far ? 1 : 0))}`;
      const sx = sideways ? ax - ux * st : ax + ux * st;
      const sy = sideways ? ay + uy * st : ay - uy * st;
      const ex = bx + ux * et;
      const ey = by + uy * et;
      path = {
        d: `M${num(sx)},${num(sy)}C${bend(ax, ay, -1, reach)} ${bend(bx, by, 1, reach)} ${num(ex)},${num(ey)}`,
        sx: ax,
        sy: ay,
        sdx: sideways ? ux : -ux,
        sdy: sideways ? -uy : uy,
        ex: bx,
        ey: by,
        edx: -ux,
        edy: -uy,
      };
      if (sideways) {
        ce.labelX = c.x;
        ce.labelY = Math.max(ay, by) + reach * 0.75 + 6 + label.height / 2;
      } else {
        ce.labelX = Math.max(ax, bx) + reach * 0.75 + 8 + label.width / 2;
        ce.labelY = c.y;
      }
    } else {
      if (ce.route.length < 6) continue;
      path = routePath(ce.route, undefined, trim(startType), trim(endType), undefined, undefined, false);
    }
    const under = fillUnder(path.d, [path.sx, path.sy, path.ex, path.ey], fills, path.tokens);
    const over = under ? edgeInk(under, style?.line) : under;
    const color = over || (style?.stroke ? esc(style.stroke) : 'var(--_l)');
    // Markers with the page color inside take the fill's color where the edge lies on one.
    const hollow = under && over ? /[";]fill:([^;"]*)/.exec(under.shape)?.[1].trim() : undefined;
    const marks = (fill: string, stroke: string | undefined, plain: boolean): void => {
      for (const [type, x, y, dx, dy] of [
        [startType, path.sx, path.sy, path.sdx, path.sdy],
        [endType, path.ex, path.ey, path.edx, path.edy],
      ] as const) {
        if (!MARKED.has(type)) continue;
        if (type !== 'extension') drawMarker(out, type, x, y, dx, dy, !plain && hollow && fill === 'var(--_bg)' ? hollow : fill, stroke, !plain);
        else drawExtension(out, x, y, dx, dy, !plain && hollow ? hollow : 'var(--_bg)', fill, !plain);
      }
    };
    if (over === '') {
      // A wider page-colored stroke under the edge; its markers drop their class so marker styles skip it.
      const caseAttrs = casingAttrs(style?.line);
      if (caseAttrs !== undefined) {
        out.into('casings', '', () => {
          if (caseAttrs) out.group({ attrs: caseAttrs });
          out.path(path.d, '', path.tokens);
          marks('var(--_bg)', 'var(--_bg)', true);
          if (caseAttrs) out.end();
        });
      }
    }
    // Mermaid animates these dashes. A still picture keeps the dashes.
    const dashes = edge.internal ? '2 3' : edge.pattern === 'dotted' ? '5 4' : edge.animate ? '9 5' : '';
    out.section('edges');
    out.group({
      cls: `pele-edge pele-${edge.relationshipType}${classNames(edge.classes.replace(/^default relationship relationship-\S+\s?/, ''))}`,
      id: edge.id,
      source: edge.written,
      attrs: (over ? ` stroke="${over}"` : '') + (style?.line ?? ''),
    });
    out.path(path.d, dashes ? ` stroke-dasharray="${dashes}"` : '', path.tokens);
    marks(color, undefined, false);
    out.end();
    if (label.width > 0) {
      const x = ce.labelX;
      const y = ce.labelY;
      const semantic = edge.relationshipType === 'include' || edge.relationshipType === 'extend';
      out.section('labels');
      out.group({ cls: 'pele-edge-label', id: edge.id });
      out.rect(x - (label.width + 8) / 2, y - label.height / 2, label.width + 8, label.height, ' rx="3" fill="var(--_bg)"');
      out.label(label, x, y, (semantic ? ' fill="var(--_m)"' : '') + (style?.text ?? ''), icons);
      out.end();
    }
  }

  out.done(width, height);
  return { width, height, links: [] };
}

// A boundary's title sits in the middle of its top edge. Where edges enter through that edge it
// moves into the stretch between them that is nearest the middle, or the widest if none has room.
function titleX(c: CNode, width: number, crossings: Map<number, number[]>): number {
  const xs = crossings.get(Math.round(c.y - c.h / 2));
  if (width === 0 || xs === undefined) return c.x;
  const left = c.x - c.w / 2 + 6;
  const right = c.x + c.w / 2 - 6;
  const cuts = xs.filter((x) => x > left && x < right).sort((a, b) => a - b);
  cuts.push(right);
  const need = width / 2 + 6;
  let best = c.x;
  let bestOff = Infinity;
  let widest = 0;
  let from = left;
  for (const cut of cuts) {
    if (cut - from >= 2 * need) {
      const x = Math.min(Math.max(c.x, from + need), cut - need);
      if (Math.abs(x - c.x) < bestOff) {
        bestOff = Math.abs(x - c.x);
        best = x;
      }
    } else if (bestOff === Infinity && cut - from > widest) {
      widest = cut - from;
      best = (from + cut) / 2;
    }
    from = cut;
  }
  return best;
}

function leftLabel(out: Out, label: Label, x: number, cy: number, attrs: string, icons: IconResolver | undefined): void {
  if (label.lines.length < 2) return out.label(label, x + label.width / 2, cy, attrs, icons);
  for (let i = 0; i < label.lines.length; i++) {
    out.label(labelLine(label, i), x + label.widths[i] / 2, cy - label.height / 2 + lineMiddle(label, i), attrs, icons);
  }
}
