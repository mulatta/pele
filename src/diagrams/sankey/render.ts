import type { Config } from '../../preprocess.js';
import type { Out } from '../../draw/out.js';
import { esc, escText, num, sourceAttrsFor } from '../../svg/builder.js';
import { resolveStyle, seriesColor } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { layoutLabel } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { fitWidth, titleRoom } from '../common/fit-width.js';
import type { SankeyModel } from './db.js';
import { layoutSankey, type Alignment } from './layout.js';

const LABEL_GAP = 6;
const VALUE_GAP = 15;
const LABEL_ROOM = 1.8;
const CAREFUL = 300;

// Two 32-bit hashes, so different gradients practically never share an id.
function contentId(text: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = (Math.imul(b, 33) + c) | 0;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function isRecord(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOption(conf: Config, key: string, fallback: number, min: number, max: number): number {
  const value = conf[key];
  return typeof value === 'number' && value >= min ? Math.min(value, max) : fallback;
}

function textOption(conf: Config, key: string): string {
  const value = conf[key];
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : '';
}

// Two decimals, as Mermaid shows values; numbers too large for that are left as they are.
function rounded(value: number): number {
  return Math.abs(value) < 1e15 ? Math.round(value * 100) / 100 : value;
}

// A colour from the configuration, as an inline style that overrides the series colour.
function fillStyle(color: unknown): string {
  return typeof color === 'string' ? resolveStyle([`fill:${color}`]).shape : '';
}

export function renderSankey(model: SankeyModel, config: Config, options: RenderOptions, out: Out): Rendered {
  const conf = isRecord(config.sankey) ? config.sankey : {};
  const natural = numberOption(conf, 'width', 600, 1, 10000);
  return fitWidth(options, natural, 160, (chartWidth, _narrow, o) => draw(o, model, conf, options, chartWidth, natural), out);
}

function draw(out: Out, model: SankeyModel, conf: Config, options: RenderOptions, chartWidth: number, natural: number): Rendered {
  const srcAttrs = sourceAttrsFor({ sourceInfo: out.sources });
  const size = options.fontSize ?? 16;
  const least = Math.round(size * 0.625);
  // Labels shrink with a chart narrowed to fit, as they would if the whole picture were scaled down.
  let small = Math.max(least, Math.round(size * 0.875 * Math.min(1, chartWidth / natural)));
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  const chartHeight = numberOption(conf, 'height', 400, 1, 10000);
  const nodeWidth = Math.min(numberOption(conf, 'nodeWidth', 10, 1, 200), chartWidth);
  const showValues = conf.showValues !== false;
  const prefix = decodeEntities(textOption(conf, 'prefix'));
  const suffix = decodeEntities(textOption(conf, 'suffix'));
  const outlined = conf.labelStyle === 'outlined';
  const alignment: Alignment =
    conf.nodeAlignment === 'left' || conf.nodeAlignment === 'right' || conf.nodeAlignment === 'center'
      ? conf.nodeAlignment
      : 'justify';
  const linkColor = typeof conf.linkColor === 'string' ? conf.linkColor : 'gradient';

  const lay = (labelSize: number): ReturnType<typeof layoutSankey> =>
    layoutSankey(model, {
      width: chartWidth,
      height: chartHeight,
      nodeWidth,
      nodePadding: numberOption(conf, 'nodePadding', 12, 0, 200) + (showValues ? VALUE_GAP : 0),
      labelHeight: labelSize * 1.15,
      alignment,
    });
  let layout = lay(small);
  // Labels also shrink with the most crowded column, so each keeps about LABEL_ROOM lines.
  const rows = new Map<number, number>();
  let fullest = 1;
  for (const node of layout.nodes) {
    const count = (rows.get(node.layer) ?? 0) + 1;
    rows.set(node.layer, count);
    if (count > fullest) fullest = count;
  }
  const crowded = Math.max(least, Math.round(chartHeight / fullest / LABEL_ROOM));
  if (crowded < small) {
    small = crowded;
    layout = lay(small);
  }
  const { nodes, links } = layout;
  const lineHeight = small * 1.5;

  const custom = new Map<string, string>();
  if (isRecord(conf.nodeColors)) {
    for (const [id, color] of Object.entries(conf.nodeColors)) {
      const style = fillStyle(color);
      if (style) custom.set(id, style);
    }
  }
  const nodeStyle = (i: number): string => custom.get(model.nodes[i].id) ?? '';
  // Match the whole fill to preserve semicolons in escaped entities.
  const nodeColor = (i: number): string => /^ style="fill:(.*);"$/.exec(nodeStyle(i))?.[1] ?? seriesColor(i);

  // Labels sit beside the bars, on the side that faces the middle of the chart unless that
  // side is crowded.
  let central = 0;
  let most = 0;
  nodes.forEach((node) => {
    if (node.value > most) {
      most = node.value;
      central = node.layer;
    }
  });
  let minX = 0;
  let maxX = chartWidth;
  let minY = 0;
  let maxY = chartHeight;
  const labels = nodes.map((node, i) => {
    const name = decodeEntities(model.nodes[i].id);
    const value = showValues ? `${prefix}${rounded(node.value)}${suffix}` : '';
    const width = measurer.width(value ? `${name} ${value}` : name, small, 0);
    const after = outlined ? node.layer >= central : node.x < chartWidth / 2;
    const x = after ? node.x + nodeWidth + LABEL_GAP : node.x - LABEL_GAP;
    const y = node.y + node.height / 2;
    minX = Math.min(minX, after ? x : x - width);
    maxX = Math.max(maxX, after ? x + width : x);
    minY = Math.min(minY, y - small * 0.75);
    maxY = Math.max(maxY, y + small * 0.75);
    return { value, width, after, left: after ? x : x - width, y };
  });
  // A label moves at most one line; retain two bands on each side.
  const bands = new Map<number, typeof labels>();
  if (nodes.length <= CAREFUL) for (const label of labels) {
    const band = Math.floor(label.y / lineHeight);
    for (const key of [band - 2, band - 1, band, band + 1, band + 2]) {
      const nearby = bands.get(key);
      if (nearby) nearby.push(label);
      else bands.set(key, [label]);
    }
  }
  const title = layoutLabel(model.title, false, measurer, size, titleRoom(options), Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(maxX - minX, title.width);
  const ox = pad - minX + (inner - (maxX - minX)) / 2;
  const oy = pad + titleHeight - minY;
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);

  out.label(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  out.frame(ox, oy);
  // Layers are painted in the order they are made, and the gradients are known only after the links.
  out.section('defs');
  out.section('links', ' class="pele-sankey-links" fill-opacity="0.4"', true);
  out.section('nodes', ' class="pele-sankey-nodes"', true);
  out.section('labels', ` class="pele-labels" font-size="${small}"`, true);
  nodes.forEach((node, i) => {
    const id = model.nodes[i].id;
    const name = decodeEntities(id);
    const height = Math.max(node.height, 1);
    out.section('nodes');
    out.rect(node.x, node.y, nodeWidth, height, ` rx="${num(Math.min(2, height / 2))}" fill="${seriesColor(i)}"${nodeStyle(i)}`, { cls: 'pele-sankey-node', id, source: model.nodes[i].written });

    const label = labels[i];
    const overlapsLabel = (left: number, y: number): boolean => (bands.get(Math.floor(y / lineHeight)) ?? []).some((other) =>
      other !== label && Math.abs(other.y - y) < lineHeight && left < other.left + other.width + LABEL_GAP && left + label.width > other.left - LABEL_GAP
    );
    // Try the other side, then an adjacent line when both sides are crowded.
    if (nodes.length <= CAREFUL && overlapsLabel(label.left, label.y)) {
      place: for (const dy of [0, -lineHeight, lineHeight]) {
        for (const after of [label.after, !label.after]) {
          const left = after ? node.x + nodeWidth + LABEL_GAP : node.x - LABEL_GAP - label.width;
          const y = label.y + dy;
          if (overlapsLabel(left, y) || left < minX || left + label.width > maxX || y - small * 0.75 < minY || y + small * 0.75 > maxY) continue;
          if (nodes.some((bar, j) => j !== i && left < bar.x + nodeWidth + LABEL_GAP && left + label.width > bar.x - LABEL_GAP && y - small * 0.75 < bar.y + bar.height && y + small * 0.75 > bar.y)) continue;
          // A label stays nearer its own bar than any other in the column, so it can't name that one.
          const own = Math.max(0, node.y - y, y - node.y - node.height);
          if (nodes.some((bar, j) => j !== i && bar.x === node.x && Math.max(0, bar.y - y, y - bar.y - bar.height) <= own)) continue;
          label.left = left;
          label.y = y;
          label.after = after;
          break place;
        }
      }
    }
    const { value, after, y } = label;
    const x = after ? node.x + nodeWidth + LABEL_GAP : node.x - LABEL_GAP;
    const anchor = ` text-anchor="${after ? 'start' : 'end'}"`;
    out.section('labels');
    out.group({ cls: 'pele-label', id, source: model.nodes[i].written });
    if (outlined) {
      out.text(x, y + small * 0.35, value ? `${name} ${value}` : name, '', `${anchor} fill="none" stroke="var(--_bg)" stroke-width="3" stroke-linejoin="round"`);
    }
    // The value is a tspan with a style of its own.
    if (value) {
      out.spans(x, y + small * 0.35, [{ text: `${name} ` }, { text: value, attrs: ' class="pele-sankey-value" fill="var(--_m)"' }], '', anchor);
    } else out.text(x, y + small * 0.35, name, '', anchor);
    out.end();
  });

  const fixed = linkColor === 'gradient' || linkColor === 'source' || linkColor === 'target' ? '' : fillStyle(linkColor);
  // Without an idPrefix diagrams share gradient ids, and Chrome then uses a hidden or differently
  // themed copy's gradient. Other characters would end the url() and void the whole fill.
  const idPrefix = options.idPrefix ?? '';
  const gradient = linkColor === 'gradient' && /^[\w-]+$/.test(idPrefix);
  const gradients = new Map<string, string>();
  out.section('links');
  links.forEach((link, k) => {
    const end = linkColor === 'target' ? link.target : link.source;
    const half = Math.max(link.thickness, 1) / 2;
    const x0 = nodes[link.source].x + nodeWidth;
    const x1 = nodes[link.target].x;
    let paint = `fill="${seriesColor(end)}"${fixed || nodeStyle(end)}`;
    if (gradient) {
      // Ids come from the gradient itself, so diagrams sharing a prefix agree on them. The colour
      // after the url() is the fallback.
      const stops =
        `x1="${num(x0)}" x2="${num(x1)}"><stop offset="0" stop-color="${nodeColor(link.source)}"/>` +
        `<stop offset="1" stop-color="${nodeColor(link.target)}"/>`;
      const id = `${idPrefix}-sankey-${contentId(stops)}`;
      gradients.set(id, `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ${stops}</linearGradient>`);
      paint = `fill="url(#${id}) ${nodeColor(link.source)}"`;
    }
    const mid = (x0 + x1) / 2;
    const from = model.nodes[link.source].id;
    const to = model.nodes[link.target].id;
    const top = link.sourceY - half;
    const bottom = link.targetY - half;
    // The SVG has a tooltip inside the path, which a typed path does not write.
    out.both(
      () =>
        `<path class="pele-sankey-link" data-id="${escText(from)}-&gt;${escText(to)}"${srcAttrs(model.links[k].written)} d="M${num(x0)},${num(top)}C${num(mid)},${num(top)} ${num(mid)},${num(bottom)} ${num(x1)},${num(bottom)}L${num(x1)},${num(
          link.targetY + half
        )}C${num(mid)},${num(link.targetY + half)} ${num(mid)},${num(link.sourceY + half)} ${num(x0)},${num(
          link.sourceY + half
        )}Z" ${paint}>` + `<title>${escText(from)} → ${escText(to)}: ${esc(prefix)}${rounded(link.value)}${esc(suffix)}</title></path>`,
      () => {
        const pen = out.pen().M(x0, top).C(mid, top, mid, bottom, x1, bottom).L(x1, link.targetY + half);
        pen.C(mid, link.targetY + half, mid, link.sourceY + half, x0, link.sourceY + half).Z();
        out.path(pen, ' ' + paint, undefined, { cls: 'pele-sankey-link', id: `${from}->${to}`, source: model.links[k].written });
      }
    );
  });
  if (gradients.size > 0) {
    out.section('defs');
    // A scene has no use for gradient definitions.
    out.both(() => `<defs>${[...gradients.values()].join('')}</defs>`, () => {});
  }

  return { svg: out.done('sankey', width, height, size, options, model), width, height, links: [] };
}
