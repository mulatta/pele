import type { Config } from '../../preprocess.js';
import type { Out } from '../../draw/out.js';
import { titleLabel } from '../../svg/title.js';
import { num } from '../../svg/builder.js';
import { drawShape, shapeInset, shapeSize } from '../../svg/shapes.js';
import { classNames, seriesColor } from '../../svg/theme.js';
import { labelLine, layoutLabel, lineMiddle, type Label } from '../../text/label.js';
import { defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { titleRoom, turnToFit } from '../common/fit-width.js';
import { iconMarkup } from '../../text/icons.js';
import { iconSvg } from '../common/icon.js';
import type { MindmapModel, MindmapNode } from './db.js';

// Indexed by Mermaid's node type. A node without delimiters is text on a line, except the root.
const SHAPES = ['', 'rounded', 'rect', 'circle', 'cloud', 'bang', 'hex'];
const ROOT_SHAPE = 'stadium';

const GAP_X = 36;
const GAP_Y = 8;
// Between two subtrees, of which at least one has children of its own.
const GROUP_GAP = 18;
const BRANCH_GAP_X = 52;
const BRANCH_GAP_Y = 28;
const TEXT_PAD = 6;
const PILL_PAD = 12;
const TINT = 0.22;
const ICON_GAP = 6;
// Running down, each level is set in by this much, and links leave a node this far from its left edge.
const INDENT = 28;
const STEM = 12;
const BEND = 8;
const ROW_GAP = 10;
const EDGE = { cls: 'pele-edge' };

const LABEL = ' class="pele-label"';
const TITLE = ' class="pele-title" font-weight="var(--_tw)"';

// A label with each line starting at `left`, for an outline, where centered lines would look ragged.
function leftLabel(out: Out, label: Label, left: number, cy: number, icons: RenderOptions['icons']): void {
  if (label.lines.length < 2) return out.label(label, left + label.width / 2, cy, LABEL, icons);
  const top = cy - label.height / 2;
  for (let k = 0; k < label.lines.length; k++) {
    out.label(labelLine(label, k), left + label.widths[k] / 2, top + lineMiddle(label, k), LABEL, icons);
  }
}

export function renderMindmap(model: MindmapModel, config: Config, options: RenderOptions, out: Out): Rendered {
  return turnToFit(options, (down, o) => draw(o, model, config, options, down), out);
}

// `down` draws the map as an outline: the root at the top, and each level set in under its parent.
// It is far narrower than branches spreading to both sides, and as tall as it needs to be.
function draw(out: Out, model: MindmapModel, config: Config, options: RenderOptions, down: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const icons = options.icons;
  const maxNodeWidth = (config.mindmap as Config | undefined)?.maxNodeWidth;
  const wrap = typeof maxNodeWidth === 'number' && maxNodeWidth > 0 ? Math.min(maxNodeWidth, 2000) : 200;
  const glyph = size * 1.25;

  const nodes = model.nodes;
  const n = nodes.length;
  const parent = new Int32Array(n);
  const depth = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (const child of nodes[i].children) {
      parent[child.id] = i;
      depth[child.id] = depth[i] + 1;
    }
  }
  // An outline has the width the host gives it, less what its level is set in.
  const room = down && options.maxWidth !== undefined && options.maxWidth > 0 ? options.maxWidth - 2 * pad : Infinity;
  const labels = new Array<Label>(n);
  const shapes = new Array<string>(n);
  const w = new Float64Array(n);
  const h = new Float64Array(n);
  const dy = new Float64Array(n);
  // Where links meet the node, measured down from its top: its middle.
  const anchor = new Float64Array(n);
  // Whether the host has the node's icon. One it does not have takes no room.
  const drawn = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    drawn[i] = node.icon !== undefined && iconMarkup(node.icon) !== '' ? 1 : 0;
    const fit = Math.min(wrap, Math.max(72, room - depth[i] * INDENT - 2 * TEXT_PAD - (drawn[i] ? glyph + ICON_GAP : 0)));
    const label = (labels[i] = layoutLabel(node.descr, true, measurer, size, fit));
    const tw = label.width + (drawn[i] ? glyph + (label.width > 0 ? ICON_GAP : 0) : 0);
    const th = Math.max(label.height, Math.round(size * 1.5));
    let shape = SHAPES[node.type] || (i === 0 ? ROOT_SHAPE : '');
    // In an outline the root heads a column, and the trunk drops from under its left end. A circle
    // or a cloud would stand wide of that, so the root is a pill there unless it is a box already.
    if (down && i === 0 && shape !== 'rect' && shape !== 'rounded') shape = ROOT_SHAPE;
    shapes[i] = shape;
    if (shape === '') {
      // A node with no shape of its own is plain text when it ends a branch, and text in a
      // tinted pill when the branch goes on from it, which sets the levels apart.
      const pill = node.children.length > 0;
      w[i] = tw + 2 * (pill ? PILL_PAD : TEXT_PAD);
      h[i] = th + (pill ? 6 : 0);
      anchor[i] = h[i] / 2;
    } else {
      const s = shapeSize(shape, tw, th);
      w[i] = s.w;
      h[i] = s.h;
      dy[i] = s.dy;
      anchor[i] = s.h / 2;
    }
  }

  // Each subtree takes a band of height `extent`. `rel` is a subtree's offset among its siblings,
  // `own` the node's offset inside its band, and `kids` the offset of its children's bands.
  const extent = new Float64Array(n);
  const rel = new Float64Array(n);
  const own = new Float64Array(n);
  const kids = new Float64Array(n);
  let stacked = 0;

  // Stacks subtrees top to bottom and returns the height at which their parent's anchor belongs.
  const stack = (list: MindmapNode[], from: number, to: number, gap: number): number => {
    let y = 0;
    let last = 0;
    for (let k = from; k < to; k++) {
      const c = list[k].id;
      rel[c] = y;
      const grouped = list[k].children.length > 0 || (k + 1 < to && list[k + 1].children.length > 0);
      last = grouped ? Math.max(gap, GROUP_GAP) : gap;
      y += extent[c] + last;
    }
    stacked = y - last;
    const a = list[from].id;
    const b = list[to - 1].id;
    return (rel[a] + own[a] + anchor[a] + rel[b] + own[b] + anchor[b]) / 2;
  };

  // Nodes are in depth-first order, so going backwards visits children before their parent.
  for (let i = n - 1; i > 0; i--) {
    const children = nodes[i].children;
    if (children.length === 0) {
      extent[i] = h[i];
      continue;
    }
    const top = stack(children, 0, children.length, GAP_Y) - anchor[i];
    const low = Math.min(0, top);
    extent[i] = Math.max(stacked, top + h[i]) - low;
    own[i] = top - low;
    kids[i] = -low;
  }

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const band = new Float64Array(n);
  const side = new Int8Array(n);
  // Running down: how far the trunk under each node has been drawn.
  const trunk = new Float64Array(n);

  if (down) {
    // Nodes are in depth-first order, which is the order of an outline's rows.
    let row = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0 && parent[i] === 0) row += ROW_GAP;
      x[i] = depth[i] * INDENT + w[i] / 2;
      y[i] = row;
      row += h[i] + ROW_GAP;
    }
  } else if (n > 0) {
    // The first branches go right and the rest left, split where the two sides are closest in height.
    const branches = nodes[0].children;
    const count = branches.length;
    let total = 0;
    for (const branch of branches) total += extent[branch.id];
    let split = count;
    let best = Infinity;
    let right = 0;
    for (let k = 1; k < count; k++) {
      right += extent[branches[k - 1].id];
      const diff = Math.abs(2 * right - total + (2 * k - count) * BRANCH_GAP_Y);
      if (diff < best) {
        best = diff;
        split = k;
      }
    }
    for (let from = 0, to = split, dir = 1; from < count; from = to, to = count, dir = -1) {
      const middle = stack(branches, from, to, BRANCH_GAP_Y);
      for (let k = from; k < to; k++) {
        const c = branches[k].id;
        band[c] = rel[c] - middle;
        side[c] = dir;
      }
    }
    y[0] = -h[0] / 2;
    for (let i = 0; i < n; i++) {
      if (i > 0) y[i] = band[i] + own[i];
      for (const child of nodes[i].children) {
        const c = child.id;
        if (i > 0) {
          side[c] = side[i];
          band[c] = band[i] + kids[i] + rel[c];
        }
        x[c] = x[i] + side[c] * (w[i] / 2 + (i > 0 ? GAP_X : BRANCH_GAP_X) + w[c] / 2);
      }
    }
  }

  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i] - w[i] / 2);
    maxX = Math.max(maxX, x[i] + w[i] / 2);
    minY = Math.min(minY, y[i]);
    maxY = Math.max(maxY, y[i] + h[i]);
  }
  const title = titleLabel(model.title, measurer, size, titleRoom(options));
  const titleHeight = title.height > 0 ? title.height + 16 : 0;
  const width = Math.max(maxX - minX, title.width);
  const totalWidth = Math.ceil(width + 2 * pad);
  const totalHeight = Math.ceil(maxY - minY + titleHeight + 2 * pad);
  out.label(title, totalWidth / 2, pad + title.height / 2, TITLE);
  out.frame(pad - minX + (width - maxX + minX) / 2, pad + titleHeight - minY);
  out.section('tree');

  // A branch is written with its links first, but they are known as its nodes are placed.
  let edges: (() => void)[] = [];
  let body: (() => void)[] = [];
  let color = '';
  const flush = (section: number | undefined): void => {
    if (body.length === 0) return;
    out.group({ cls: `pele-branch pele-section-${section ?? 0}` });
    out.group({ cls: 'pele-edges', attrs: ` fill="none" stroke="${color}" stroke-width="1.5"` });
    for (const draw of edges) draw();
    out.end();
    for (const draw of body) draw();
    out.end();
    edges = [];
    body = [];
  };

  // The root is drawn last, on top of the links that leave it.
  for (let k = 1; k <= n; k++) {
    const i = k % n;
    const node = nodes[i];
    const shape = shapes[i];
    const label = labels[i];
    const cx = x[i];
    const top = y[i];

    if (i > 0 && parent[i] === 0) flush(nodes[k - 1].section);
    if (i > 0 && down) {
      if (parent[i] === 0) color = seriesColor(node.section ?? 0);
      const p = parent[i];
      // The link drops from under its parent and turns in to the node's left. It starts where
      // the link to the sibling above turned in, so each stretch of a shared trunk has one color.
      // Under the root's rounded end, the trunk starts where that end has come down to the bottom.
      const stem = p === 0 ? Math.min(Math.max(STEM, h[0] / 2), INDENT - BEND) : STEM;
      const x1 = x[p] - w[p] / 2 + Math.min(stem, w[p] / 2);
      const y1 = trunk[p] || y[p] + h[p];
      const left = cx - w[i] / 2;
      const x2 = left + (shape ? shapeInset(shape, w[i], h[i], 3) : 0);
      const y2 = top + anchor[i];
      const bend = Math.max(0, Math.min(BEND, x2 - x1, y2 - y1));
      // The next link carries on from where this one leaves the trunk, so the trunk has no gap.
      trunk[p] = y2 - bend;
      const d = out.pen().M(x1, y1).V(y2 - bend).Q(x1, y2, x1 + bend, y2).H(x2);
      edges.push(() => out.path(d, '', undefined, EDGE));
    } else if (i > 0) {
      if (parent[i] === 0) color = seriesColor(node.section ?? 0);
      const p = parent[i];
      const dir = side[i];
      const from = dir > 0 ? 1 : 3;
      const x1 = x[p] + dir * (w[p] / 2 - (shapes[p] ? shapeInset(shapes[p], w[p], h[p], from) : 0));
      const y1 = y[p] + anchor[p];
      const near = cx - (dir * w[i]) / 2;
      const x2 = near + (shape ? dir * shapeInset(shape, w[i], h[i], 4 - from) : 0);
      const y2 = top + anchor[i];
      const mid = (x1 + x2) / 2;
      const d = out.pen().M(x1, y1).C(mid, y1, mid, y2, x2, y2);
      edges.push(() => out.path(d, '', undefined, EDGE));
    }

    const pill = !shape && node.children.length > 0;
    // Every node off the root is filled with a tint of its branch's color and outlined in it,
    // whether its shape was given in the source or is the pill of a node that branches.
    // The root is neutral.
    const tint = ` fill="${color}" fill-opacity="${TINT}" stroke="${color}"`;
    const stroke = color;
    let shift = 0;
    const withIcon = node.icon && drawn[i];
    if (withIcon) shift = (glyph + (label.width > 0 ? ICON_GAP : 0)) / 2;
    const place = (): void => {
      out.group({
        cls: `pele-node pele-shape-${shape || (pill ? 'branch' : 'text')}${i > 0 ? '' : ' pele-root'}${classNames(node.class ?? '')}`,
        id: node.nodeId,
        source: node.source,
        x: cx,
        y: top + h[i] / 2,
      });
      if (shape) {
        if (i > 0) drawShape(out, shape, w[i], h[i], tint, ` stroke="${stroke}"`);
        else drawShape(out, shape, w[i], h[i], ' fill="var(--_s)" stroke="var(--_b)"', ' stroke="var(--_b)"');
      }
      else if (pill) out.rect(-w[i] / 2, -h[i] / 2, w[i], h[i], ` rx="${num(h[i] / 2)}"${tint}`);
      if (withIcon) out.fragment(iconSvg(node.icon!, -shift - label.width / 2, dy[i] - glyph / 2, glyph, icons));
      if (down && !shape) leftLabel(out, label, shift - label.width / 2, dy[i], icons);
      else out.label(label, shift, dy[i], LABEL, icons);
      out.end();
    };
    if (i > 0) body.push(place);
    else {
      flush(nodes[k - 1].section);
      place();
    }
  }

  return {
    svg: out.done('mindmap', totalWidth, totalHeight, size, options, {}),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
