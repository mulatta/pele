import { tighten, titleRoom } from '../common/fit-width.js';
import type { Out } from '../../draw/out.js';
import { PeleError } from '../../errors.js';
import type { Config } from '../../preprocess.js';
import { esc } from '../../svg/builder.js';
import { ARROW, CASINGS_ATTRS, drawMarker, edgeCasing, markerTrim, overFills, type Fill } from '../../svg/edges.js';
import { inkFill, paints } from '../../svg/ink.js';
import { drawShape } from '../../svg/shapes.js';
import { resolveStyle, rounded, type ResolvedStyle } from '../../svg/theme.js';
import { layoutLabel } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { linkUrl, relAttr, sanitizeUrl } from '../../util/url.js';
import { leftLabelSvg } from '../common/literal-label.js';
import type { C4Db } from './db.js';
import { HEAD_LEFT, HEAD_TOP, layoutC4 } from './layout.js';
import { HEAD, LABEL_PAD, LANE, Lanes, crosses, cylRy, queueRx, route, type Box } from './route.js';

const PAIR_SHIFT = 7;
const NARROW_GAP = 36;
const WIDEN = 24;
const MAX_OFFSET = 2000;
// A label may cover this much of a shape's edge, where there is no text.
const EDGE = 8;
// Places along a relation to try for its label, nearest the middle first.
const SLIDE = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
// Above this many box comparisons, labels stay at the middle and lines are not steered around shapes.
const CARE_BUDGET = 2000000;

function userStyle(fill: string | undefined, stroke: string | undefined, color: string | undefined): ResolvedStyle {
  const declarations: string[] = [];
  if (fill) declarations.push('fill:' + fill);
  if (stroke) declarations.push('stroke:' + stroke);
  if (color) declarations.push('color:' + color);
  return resolveStyle(declarations);
}

// Opens a link around what is drawn next, unless the address is refused; the caller ends it.
function openLink(out: Out, url: string | undefined, id: string, links: LinkInfo[], options: RenderOptions): boolean {
  if (!url) return false;
  // Entity encoding has hidden any `#name;` in the address. Put it back, so that the check sees what a browser would.
  const href = linkUrl(sanitizeUrl(url.includes('\u00b6\u00df') ? url.replace(/\ufb02\u00b0\u00b0?/g, '#').replace(/\u00b6\u00df/g, ';') : url), options);
  if (href === undefined) return false;
  links.push({ id, href, internal: false });
  out.link(` href="${esc(href)}"${relAttr(options)}`);
  return true;
}

export function renderC4(db: C4Db, _config: Config, options: RenderOptions, out: Out): Rendered {
  return tighten(
    options,
    (tight, o) => {
      if (!tight) return draw(o, db, _config, options, false)[0];
      // Each gap is an attempt of its own; the one that squeezes least is kept.
      let kept = o.fork();
      let [best, squeezed] = draw(kept, db, _config, options, true, NARROW_GAP);
      for (let gap = NARROW_GAP + WIDEN; squeezed > 0 && gap <= NARROW_GAP + 3 * WIDEN; gap += WIDEN) {
        const attempt = o.fork();
        const [wider, left] = draw(attempt, db, _config, options, true, gap);
        if (left < squeezed) [best, squeezed, kept] = [wider, left, attempt];
      }
      o.adopt(kept);
      return best;
    },
    out
  );
}

function draw(out: Out, db: C4Db, _config: Config, options: RenderOptions, tight: boolean, gap = NARROW_GAP): [Rendered, number] {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.8125);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const links: LinkInfo[] = [];
  // Everything but the title is drawn from the origin and moved into place once the extent is known.
  out.frame(0, 0);
  out.section('clusters', ' class="pele-clusters"');
  out.section('casings', CASINGS_ATTRS);
  out.section('edges', ' class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round"');
  out.section('nodes', ' class="pele-nodes"');
  out.section('edge-labels', ` class="pele-edge-labels" font-size="${small}"`);
  const { order, boxes } = layoutC4(db, measurer, size, small, tight ? Math.max(80, (options.maxWidth ?? 320) - 2 * pad) : undefined, gap);
  const root = order[0];

  let minX = 0;
  let minY = 0;
  let maxX = root.w;
  let maxY = root.h;
  const grow = (x0: number, y0: number, x1: number, y1: number): void => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };

  const ends: Box[] = [];
  const pairs = new Map<Box, Set<Box>>();
  for (const rel of db.rels) {
    const from = rel.fromAttr ? undefined : db.getC4Shape(rel.from);
    const to = rel.toAttr ? undefined : db.getC4Shape(rel.to);
    const a = from && boxes.get(from);
    const b = to && boxes.get(to);
    if (!a || !b) {
      throw new PeleError(`C4 rel "${rel.from}" -> "${rel.to}" references an unknown shape or boundary`, 'semantic', {
        type: 'c4',
      });
    }
    ends.push(a, b);
    let targets = pairs.get(a);
    if (!targets) pairs.set(a, (targets = new Set()));
    targets.add(b);
  }

  // What a relation's label should not cover: shapes, arrowheads, boundary headings, and the labels placed before it.
  const nodes: Box[] = [];
  const taken: number[] = [];
  for (const group of order) {
    for (const node of group.nodes) {
      nodes.push(node);
      taken.push(node.x + EDGE, node.y + EDGE, node.x + node.w - EDGE, node.y + node.h - EDGE);
    }
  }
  const careful = db.rels.length * (nodes.length + order.length + 3 * db.rels.length) <= CARE_BUDGET;
  const covered = (x0: number, y0: number, x1: number, y1: number): number => {
    let area = 0;
    for (let i = 0; i < taken.length; i += 4) {
      const w = Math.min(x1, taken[i + 2]) - Math.max(x0, taken[i]);
      if (w <= 0) continue;
      const h = Math.min(y1, taken[i + 3]) - Math.max(y0, taken[i + 1]);
      if (h > 0) area += w * h;
    }
    return area;
  };
  const offset = (value: number | undefined): number => (value ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, value)) : 0);

  // Every line is drawn before any label is placed, so that labels can keep off the arrowheads.
  const trim = markerTrim('arrow_point');
  const fills: Fill[] = [];
  for (const group of order) {
    if (group === root) continue;
    const shape = userStyle(group.boundary.bgColor, undefined, undefined).shape;
    if (paints(shape)) fills.push({ box: [group.x, group.y, group.x + group.w, group.y + group.h], shape });
  }
  const lanes = new Lanes();
  for (const group of order) if (group !== root) lanes.frame(group);
  const routes = db.rels.map((rel, index) => {
    const a = ends[index * 2];
    const b = ends[index * 2 + 1];
    const style = userStyle(undefined, rel.lineColor, undefined);
    const startArrow = rel.type === 'birel' || rel.type === 'rel_b';
    const endArrow = rel.type !== 'rel_b';
    const reverse = a !== b && pairs.get(b)?.has(a) === true;
    const r = route(a, b, reverse ? PAIR_SHIFT : 0, careful ? nodes : undefined, lanes, startArrow ? trim : 0, endArrow ? trim : 0);
    grow(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.max(r.x0, r.x1), Math.max(r.y0, r.y1));
    if (startArrow && careful) taken.push(r.sx - ARROW, r.sy - ARROW, r.sx + ARROW, r.sy + ARROW);
    if (endArrow && careful) taken.push(r.ex - ARROW, r.ey - ARROW, r.ex + ARROW, r.ey + ARROW);
    const over = overFills(r.d, [r.sx, r.sy, r.ex, r.ey], fills, style.line);
    const color = over || (style.stroke ? esc(style.stroke) : 'var(--_l)');
    if (over === '') {
      const casing = edgeCasing(r, startArrow ? 'arrow_point' : 'none', endArrow ? 'arrow_point' : 'none', style.line);
      if (casing) out.into('casings', '', () => out.fragment(casing));
    }
    out.section('edges');
    out.group({ cls: 'pele-edge', id: rel.from + '-' + rel.to, source: rel.source, attrs: (over ? ` stroke="${over}"` : '') + style.line });
    out.path(r.d, '');
    if (startArrow) drawMarker(out, 'arrow_point', r.sx, r.sy, r.sdx, r.sdy, color);
    if (endArrow) drawMarker(out, 'arrow_point', r.ex, r.ey, r.edx, r.edy, color);
    out.end();
    return r;
  });

  // A boundary's heading goes at the left, the middle or the right of its top edge: the first of them no line crosses.
  for (const group of order) {
    if (!careful || group.headW === 0) continue;
    const top = group.y + HEAD_TOP;
    const bottom = group.y + group.head - LANE;
    let fewest = Infinity;
    for (const x of [HEAD_LEFT, (group.w - group.headW) / 2, group.w - HEAD_LEFT - group.headW]) {
      let count = 0;
      for (const r of routes) if (crosses(r.points, group.x + x - 4, top, group.x + x + group.headW + 4, bottom)) count++;
      if (count < fewest) {
        fewest = count;
        group.headX = x;
      }
      if (count === 0) break;
    }
    taken.push(group.x + group.headX - 4, top, group.x + group.headX + group.headW + 4, bottom);
  }

  db.rels.forEach((rel, index) => {
    const r = routes[index];
    const id = rel.from + '-' + rel.to;
    const style = userStyle(undefined, undefined, rel.textColor);
    const text = (db.c4Type === 'C4Dynamic' ? index + 1 + ': ' : '') + rel.label;
    const label = layoutLabel(text, false, measurer, small, r.room);
    const techn = layoutLabel(rel.techn ? `[${rel.techn}]` : undefined, false, measurer, small, r.room, Style.Italic);
    const lw = Math.max(label.width, techn.width) + LABEL_PAD;
    const lh = label.height + techn.height;
    if (lh === 0) return;

    // The label sits on the line, or just beside it when another relation runs the opposite way.
    const beside = Math.abs(r.nx) * (lw / 2) + Math.abs(r.ny) * (lh / 2) + 2;
    const aside = r.lean ? Math.max(0, Math.min(r.lean, beside - 14)) : beside;
    // Manual offsets are tuned to the original spacing. Reposition compact labels beside
    // their routed arrows so an offset cannot leave them floating outside a boundary.
    let dx = r.nx * aside + (tight ? 0 : offset(rel.offsetX));
    let dy = r.ny * aside + (tight ? 0 : offset(rel.offsetY));
    let at = 0.5;
    if (careful) {
      // Slide along the line to the spot that covers least. Offsets from the diagram are kept unless a spot
      // on the line itself covers less than any they lead to: they are often tuned for Mermaid's spacing.
      let least = Infinity;
      const moved = dx !== r.nx * aside || dy !== r.ny * aside;
      for (let pass = 0; pass < (moved ? 2 : 1) && least > 0; pass++) {
        const px = pass ? r.nx * aside : dx;
        const py = pass ? r.ny * aside : dy;
        for (const t of SLIDE) {
          const cx = r.x0 + (r.x1 - r.x0) * t + px;
          const cy = r.y0 + (r.y1 - r.y0) * t + py;
          const area = covered(cx - lw / 2, cy - lh / 2, cx + lw / 2, cy + lh / 2);
          if (area < least) {
            least = area;
            at = t;
            dx = px;
            dy = py;
          }
          if (area === 0) break;
        }
      }
    }
    const cx = r.x0 + (r.x1 - r.x0) * at + dx;
    const top = r.y0 + (r.y1 - r.y0) * at + dy - lh / 2;
    if (careful) taken.push(cx - lw / 2, top, cx + lw / 2, top + lh);
    grow(cx - lw / 2, top, cx + lw / 2, top + lh);
    out.section('edge-labels');
    out.group({ cls: 'pele-edge-label', id, source: rel.source });
    if (rel.descr) out.tooltip(rel.descr);
    out.rect(cx - lw / 2, top, lw, lh, ' rx="3" fill="var(--_bg)"');
    const linked = openLink(out, rel.link, id, links, options);
    out.label(label, cx, top + label.height / 2, style.text);
    out.label(techn, cx, top + label.height + techn.height / 2, ` class="pele-c4-techn" fill="var(--_m)"${style.text}`);
    if (linked) out.end();
    out.end();
  });

  for (const group of order) {
    if (group !== root) {
      const boundary = group.boundary;
      const style = userStyle(boundary.bgColor, boundary.borderColor, boundary.fontColor);
      const x = group.x + group.headX;
      let y = group.y + HEAD_TOP;
      const color = inkFill(style) + style.text;
      const muted = inkFill(style, 'var(--_m)') + style.text;
      let text = leftLabelSvg(group.labels[0], x, y, ` class="pele-cluster-label" font-weight="var(--_hw)"${color}`);
      y += group.labels[0].height;
      text += leftLabelSvg(group.labels[1], x, y, ` class="pele-c4-type" font-size="${small}"${muted}`);
      y += group.labels[1].height;
      text += leftLabelSvg(group.labels[2], x, y, ` class="pele-c4-descr" font-size="${small}"${muted}`);
      out.section('clusters');
      out.group({ cls: `pele-cluster pele-c4-${boundary.nodeType ? 'node' : 'boundary'}`, id: boundary.alias, source: boundary.source });
      out.rect(group.x, group.y, group.w, group.h, ` fill="none" stroke="var(--_b)"${boundary.nodeType ? '' : ' stroke-dasharray="6 4"'}${rounded(style.shape)}`);
      const linked = openLink(out, boundary.link, boundary.alias, links, options);
      // Left-aligned lines are tspans of mixed styles, which no typed call covers.
      out.fragment(text);
      if (linked) out.end();
      out.end();
    }
    for (const node of group.nodes) {
      const shape = node.shape;
      const external = shape.kind.startsWith('external');
      const style = userStyle(shape.bgColor, shape.borderColor, shape.fontColor);
      const stroke = ' stroke="var(--_b)"' + (external ? ' stroke-dasharray="4 3"' : '');
      const { w, h, form, labels } = node;
      const dx = form === 'h-cyl' ? -queueRx(h) / 2 : 0;
      const dy = form === 'person' ? HEAD / 2 : form === 'cyl' ? cylRy(w) / 2 : 0;
      const color = inkFill(style) + style.text;
      const muted = inkFill(style, 'var(--_m)') + style.text;
      let y = dy - node.textH / 2;
      out.section('nodes');
      out.group({
        cls: `pele-node pele-shape-${form} pele-c4-${shape.kind}${external ? ' pele-c4-external' : ''}`,
        id: shape.alias,
        source: shape.source,
        x: node.x + w / 2,
        y: node.y + h / 2,
      });
      const linked = openLink(out, shape.link, shape.alias, links, options);
      drawShape(out, form, w, h, ` fill="var(${external ? '--_bg' : '--_s'})"${stroke}${style.shape}`, stroke + style.line);
      out.label(labels[0], dx, y + labels[0].height / 2, ` class="pele-c4-type" font-size="${small - 1}"${muted}`);
      y += labels[0].height;
      out.label(labels[1], dx, y + labels[1].height / 2, ` class="pele-label" font-weight="var(--_hw)"${color}`);
      y += labels[1].height;
      out.label(labels[2], dx, y + labels[2].height / 2, ` class="pele-c4-techn" font-size="${small}"${muted}`);
      y += labels[2].height + 4;
      out.label(labels[3], dx, y + labels[3].height / 2, ` class="pele-c4-descr" font-size="${small}"${color}`);
      if (linked) out.end();
      out.end();
    }
  }

  const title = layoutLabel(db.title, false, measurer, size, tight ? titleRoom(options) : 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(maxX - minX, title.width);
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);
  const ox = pad - minX + (inner - (maxX - minX)) / 2;
  const oy = pad + titleHeight - minY;

  out.section('main');
  out.label(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  out.frame(ox, oy);
  return [{ svg: out.done('c4', width, height, size, options, db), width, height, links }, lanes.squeezed];
}
