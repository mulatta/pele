import type { Config } from '../../preprocess.js';
import { Paint, type Out, type Pen } from '../../draw/out.js';
import { esc, num } from '../../svg/builder.js';
import { drawMarker, markerTrim } from '../../svg/edges.js';
import { FONT_MONO, ROUNDED, seriesColor } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { breakLabel, leftLabel, literalLabel } from '../common/literal-label.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered, SourceInfo } from '../../types.js';
import { turnToFit } from '../common/fit-width.js';
import type { EmBox, EmLane, EntityKind, EventModelingModel } from './model.js';

// Series slot for each kind of entity. A UI has none and is drawn plain.
const SERIES = new Map<EntityKind, number>([
  ['command', 0],
  ['event', 1],
  ['readmodel', 2],
  ['processor', 6],
]);

const BOX_PAD_X = 12;
const BOX_PAD_Y = 10;
const BOX_MIN_WIDTH = 96;
const BOX_GAP = 16;
const STAGGER = 80;
const LANE_PAD = 12;
const LANE_GAP = 8;
const DATA_COLUMNS = 48;
const NOTE_COLUMNS = 80;
const CARD_GAP = 8;
const OUTLINE = new Paint(` fill="var(--_bg)" stroke="var(--_b)"${ROUNDED}`);
const BACKING = new Paint(` fill="var(--_bg)"${ROUNDED}`);
const LANE_FILL = new Paint(` fill="var(--_s)"${ROUNDED}`);
const EDGE_LINE = new Paint(' fill="none" stroke="var(--_l)"');
const TITLE = ' class="pele-title" font-weight="var(--_tw)"';
const tint = (color: string): string => ` fill="${color}" fill-opacity="0.22" stroke="${color}"${ROUNDED}`;

// The sections of a drawing, made in the order they are painted.
function layers(out: Out, names: string[]): void {
  for (const name of names) out.section(name);
}

interface Placed {
  box: EmBox;
  name: Label;
  data: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Band {
  lane: EmLane;
  label: Label;
  right: number;
  y: number;
  h: number;
}

// Splits text into lines of at most `columns` characters, keeping its own line breaks.
function hardWrap(text: string, columns: number): string[] {
  const out: string[] = [];
  for (const line of decodeEntities(text).split('\n')) {
    const chars = line.length <= columns ? undefined : Array.from(line);
    if (chars === undefined || chars.length <= columns) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < chars.length; i += columns) out.push(chars.slice(i, i + columns).join(''));
  }
  return out;
}

// Each row is a tspan with its own position, which only the SVG writes; a scene gets one text per row.
function drawLines(out: Out, rows: string[], x: number, y: number, step: number, attrs: string): void {
  out.both(
    () => {
      let body = '';
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] !== '') body += `<tspan x="${num(x)}" y="${num(y + i * step)}">${esc(rows[i])}</tspan>`;
      }
      return body === '' ? '' : `<text${attrs} xml:space="preserve">${body}</text>`;
    },
    () => {
      for (let i = 0; i < rows.length; i++) if (rows[i] !== '') out.text(x, y + i * step, rows[i], attrs, ' xml:space="preserve"');
    }
  );
}

export function renderEventModel(model: EventModelingModel, _config: Config, options: RenderOptions, out: Out): Rendered {
  return turnToFit(options, (down, o) => draw(o, model, _config, options, down), out);
}

function draw(out: Out, model: EventModelingModel, _config: Config, options: RenderOptions, down: boolean): Rendered {
  if (down) return verticalEventModel(out, model, options);
  const size = options.fontSize ?? 16;
  const nameSize = Math.round(size * 0.875);
  const small = Math.round(size * 0.8125);
  const mono = Math.round(size * 0.75);
  const monoStep = Math.round(mono * 1.4);
  const smallStep = Math.round(small * 1.5);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const widest = (rows: string[], fontSize: number, style: number): number => {
    let width = 0;
    for (const row of rows) width = Math.max(width, measurer.width(row, fontSize, style));
    return width;
  };

  const bands = new Map<EmLane, Band>();
  let labelColumn = 0;
  for (const lane of model.lanes) {
    const label = layoutLabel(lane.label, false, measurer, small, 4000, Style.Bold);
    labelColumn = Math.max(labelColumn, label.width);
    bands.set(lane, { lane, label, right: -Infinity, y: 0, h: 0 });
  }
  labelColumn += 2 * LANE_PAD;

  // Time runs left to right. A frame in a new lane starts under the end of the one before it,
  // so the arrow between them can drop straight down; a frame in the same lane follows on.
  const placed: Placed[] = [];
  const byBox = new Map<EmBox, Placed>();
  let previous: Placed | undefined;
  for (const box of model.boxes) {
    const band = bands.get(box.lane)!;
    const name = layoutLabel(box.name, false, measurer, nameSize, 4000, Style.Bold);
    const data = box.data ? hardWrap(box.data, DATA_COLUMNS) : [];
    const w = Math.max(BOX_MIN_WIDTH, Math.max(name.width, widest(data, mono, Style.Mono)) + 2 * BOX_PAD_X);
    const h = 2 * BOX_PAD_Y + name.height + (data.length > 0 ? 6 + data.length * monoStep : 0);
    let x = 0;
    if (previous) {
      const stagger = previous.x + Math.max(previous.w / 2, previous.w - STAGGER);
      x = previous.box.lane === box.lane ? band.right + BOX_GAP : Math.max(stagger, band.right + BOX_GAP);
    }
    const item: Placed = { box, name, data, x, y: 0, w, h };
    band.right = x + w;
    band.h = Math.max(band.h, h);
    placed.push(item);
    byBox.set(box, item);
    previous = item;
  }

  let contentRight = 0;
  for (const item of placed) contentRight = Math.max(contentRight, item.x + item.w);
  const laneWidth = labelColumn + contentRight + LANE_PAD;

  const title = layoutLabel(model.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const left = pad;
  const top = pad + titleHeight;

  layers(out, ['lanes', 'edges', 'nodes', 'cards']);
  out.section('lanes');
  let y = top;
  // A lane follows from the kinds and namespaces of its frames and is written nowhere, so it has no lines.
  for (const band of bands.values()) {
    band.y = y;
    band.h += 2 * LANE_PAD;
    out.group({ cls: 'pele-cluster pele-em-lane', id: band.lane.label });
    out.rect(left, y, laneWidth, band.h, LANE_FILL);
    out.label(band.label, left + LANE_PAD + band.label.width / 2, y + band.h / 2, ` class="pele-cluster-label" font-size="${small}" font-weight="var(--_hw)" fill="var(--_m)"`);
    out.end();
    y += band.h + LANE_GAP;
  }
  let bottom = bands.size > 0 ? y - LANE_GAP : top;

  out.section('nodes');
  for (const item of placed) {
    const band = bands.get(item.box.lane)!;
    item.x += left + labelColumn;
    item.y = band.y + (band.h - item.h) / 2;
    const series = SERIES.get(item.box.kind);
    out.group({ cls: `pele-node pele-em-${item.box.kind}${item.box.reset ? ' pele-em-reset' : ''}`, id: item.box.id, source: item.box.written });
    if (series === undefined) out.rect(item.x, item.y, item.w, item.h, OUTLINE);
    else {
      out.rect(item.x, item.y, item.w, item.h, BACKING);
      out.rect(item.x, item.y, item.w, item.h, tint(seriesColor(series)));
    }
    const nameY = item.y + BOX_PAD_Y + item.name.height / 2;
    out.label(item.name, item.x + item.w / 2, nameY, ` class="pele-label" font-size="${nameSize}" font-weight="var(--_hw)"`);
    drawLines(
      out,
      item.data,
      item.x + BOX_PAD_X,
      item.y + BOX_PAD_Y + item.name.height + 6 + monoStep / 2 + mono * 0.35,
      monoStep,
      ` class="pele-em-data" font-family="${FONT_MONO}" font-size="${mono}"`
    );
    out.end();
  }

  out.section('edges');
  const trim = markerTrim('arrow_point');
  for (const relation of model.relations) {
    const s = byBox.get(relation.source);
    const t = byBox.get(relation.target);
    if (!s || !t || s === t) continue;
    let d: Pen;
    let head: () => void;
    if (s.box.lane === t.box.lane) {
      // Along the lane, from the side of one box to the side of the other.
      const forward = t.x >= s.x;
      const sx = forward ? s.x + s.w : s.x;
      const tx = forward ? t.x : t.x + t.w;
      const sy = s.y + s.h / 2;
      const ty = t.y + t.h / 2;
      const dir = tx >= sx ? 1 : -1;
      d = out.pen().M(sx, sy).L(tx - dir * trim, ty);
      head = () => drawMarker(out, 'arrow_point', tx, ty, dir, 0, 'var(--_l)');
    } else {
      // Between lanes, straight down or up where the boxes overlap, else in an S.
      const down = t.y > s.y;
      const from = Math.max(s.x, t.x);
      const to = Math.min(s.x + s.w, t.x + t.w);
      const inset = (w: number): number => Math.min(24, w / 4);
      const sx = to - from >= 16 ? (from + to) / 2 : t.x > s.x ? s.x + s.w - inset(s.w) : s.x + inset(s.w);
      const tx = to - from >= 16 ? sx : t.x > s.x ? t.x + inset(t.w) : t.x + t.w - inset(t.w);
      const sy = down ? s.y + s.h : s.y;
      const ty = down ? t.y : t.y + t.h;
      const dir = down ? 1 : -1;
      const end = ty - dir * trim;
      const mid = (sy + end) / 2;
      d = sx === tx ? out.pen().M(sx, sy).V(end) : out.pen().M(sx, sy).C(sx, mid, tx, mid, tx, end);
      head = () => drawMarker(out, 'arrow_point', tx, ty, 0, dir, 'var(--_l)');
    }
    out.group({ cls: 'pele-edge', id: `${relation.source.id}-${relation.target.id}`, source: relation.written });
    out.path(d, EDGE_LINE);
    head();
    out.end();
  }

  // Notes and given/when/then specifications, listed under the lanes with the frame they belong to.
  const names = new Map<string, string>();
  for (const box of model.boxes) names.set(box.id, box.name);
  out.section('cards');
  let cards = 0;
  let cardsRight = 0;
  const card = (kind: string, heading: string, frame: string, rows: string[], written: SourceInfo | undefined): void => {
    const head = layoutLabel(`${heading} · ${frame}${names.has(frame) ? ' ' + names.get(frame)! : ''}`, false, measurer, small, 4000, Style.Bold);
    const w = Math.max(head.width, widest(rows, small, 0)) + 2 * BOX_PAD_X;
    const h = 2 * BOX_PAD_Y + head.height + rows.length * smallStep;
    const cy = bottom + (cards++ === 0 && bands.size === 0 ? 0 : CARD_GAP);
    out.group({ cls: `pele-em-${kind}`, id: frame, source: written });
    out.rect(left, cy, w, h, OUTLINE);
    out.label(head, left + BOX_PAD_X + head.width / 2, cy + BOX_PAD_Y + head.height / 2, ` font-size="${small}" font-weight="var(--_hw)"`);
    drawLines(out, rows, left + BOX_PAD_X, cy + BOX_PAD_Y + head.height + smallStep / 2 + small * 0.35, smallStep, ` font-size="${small}"`);
    out.end();
    bottom = cy + h;
    cardsRight = Math.max(cardsRight, w);
  };
  for (const note of model.notes) card('note', 'Note', note.frame, hardWrap(note.text, NOTE_COLUMNS), note.written);
  for (const spec of model.specifications) {
    const rows = [`Given  ${spec.given.join(', ')}`];
    if (spec.when.length > 0) rows.push(`When  ${spec.when.join(', ')}`);
    rows.push(`Then  ${spec.then.join(', ')}`);
    card('specification', 'Given / When / Then', spec.frame, rows.flatMap((row) => hardWrap(row, NOTE_COLUMNS)), spec.written);
  }

  const width = Math.max(bands.size > 0 ? laneWidth : 0, cardsRight, title.width);
  const totalWidth = Math.ceil(width + 2 * pad);
  const totalHeight = Math.ceil(bottom + pad);
  out.section('main');
  out.label(title, totalWidth / 2, pad + title.height / 2, TITLE);

  return {
    svg: out.done('eventmodeling', totalWidth, totalHeight, size, options, model),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}

const RAIL_GAP = 8;
const CARD_MIN = 120;
const ARROW_ROOM = 20;

function verticalEventModel(out: Out, model: EventModelingModel, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const mono = Math.round(size * 0.75);
  const pad = options.padding ?? 8;
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const room = Math.max(160, (options.maxWidth ?? 320) - 2 * pad);
  // A relation that skips a card runs down a rail beside the cards. Relations into one card
  // share a rail; others whose runs overlap take the next rail out, so that no two follow the
  // same line.
  const order = new Map(model.boxes.map((box, index) => [box, index]));
  const runs = new Map<EmBox, [number, number]>();
  // A relation between neighbouring cards passes the lower card's lane heading.
  const passed = new Set<EmBox>();
  for (const relation of model.relations) {
    const s = order.get(relation.source), t = order.get(relation.target);
    if (s === undefined || t === undefined || s === t) continue;
    if (Math.abs(s - t) < 2) {
      passed.add(model.boxes[Math.max(s, t)]);
      continue;
    }
    const run = runs.get(relation.target);
    if (run) { run[0] = Math.min(run[0], s); run[1] = Math.max(run[1], s); }
    else runs.set(relation.target, [Math.min(s, t), Math.max(s, t)]);
  }
  const railOf = new Map<EmBox, number>();
  const railEnds: number[] = [];
  for (const [target, [from, to]] of [...runs].sort((a, b) => a[1][0] - b[1][0])) {
    let rail = railEnds.findIndex(end => end < from);
    if (rail < 0) rail = railEnds.length;
    railEnds[rail] = to;
    railOf.set(target, rail);
  }
  const gutter = 24 + RAIL_GAP * Math.max(0, railEnds.length - 1);
  // Rails are never shared to save room: past what the width allows, the drawing is wider.
  const cardWidth = Math.max(CARD_MIN, room - gutter);
  const textRoom = cardWidth - 2 * BOX_PAD_X;
  const title = layoutLabel(model.title, false, measurer, size, room, Style.Bold);
  let y = pad + (title.height ? title.height + 12 : 0);
  let bottom = pad + title.height;
  let width = Math.max(title.width, cardWidth + gutter);
  layers(out, ['edges', 'nodes', 'cards']);
  out.section('nodes');
  const placed = new Map<EmBox, { y: number; h: number; w: number; index: number; lane: number }>();
  const text = (raw: string, fontSize: number, style = 0): Label => literalLabel(decodeEntities(raw), measurer, fontSize, textRoom, style);
  model.boxes.forEach((box, index) => {
    const laneRoom = passed.has(box) ? textRoom - ARROW_ROOM : textRoom;
    const lane = breakLabel(layoutLabel(box.lane.label, false, measurer, small, laneRoom, Style.Bold), measurer, laneRoom);
    const name = layoutLabel(box.name, false, measurer, small, textRoom - 36, Style.Bold);
    const data = box.data ? text(box.data, mono, Style.Mono) : undefined;
    const w = Math.max(cardWidth, lane.width + 2 * BOX_PAD_X, name.width + 2 * BOX_PAD_X + 36, (data?.width ?? 0) + 2 * BOX_PAD_X);
    const headH = lane.height + 12;
    const h = 2 * BOX_PAD_Y + name.height + (data ? data.height + 6 : 0);
    const series = SERIES.get(box.kind);
    const cy = y + headH;
    out.group({ cls: 'pele-cluster pele-em-lane', id: box.lane.label });
    leftLabel(out, lane, pad + BOX_PAD_X, y, ` class="pele-cluster-label" font-size="${small}" font-weight="var(--_hw)" fill="var(--_m)"`);
    out.group({ cls: `pele-node pele-em-${box.kind}${box.reset ? ' pele-em-reset' : ''}`, id: box.id, source: box.written });
    out.rect(pad, cy, w, h, OUTLINE);
    if (series !== undefined) out.rect(pad, cy, w, h, tint(seriesColor(series)));
    out.label(name, pad + BOX_PAD_X + name.width / 2, cy + BOX_PAD_Y + name.height / 2, ` class="pele-label" font-size="${small}" font-weight="var(--_hw)"`);
    out.text(pad + w - BOX_PAD_X, cy + BOX_PAD_Y + small, box.id, ' class="pele-em-frame"', ` text-anchor="end" font-size="${mono}" fill="var(--_m)"`);
    if (data) drawLines(out, data.lines.map(line => line.map(span => span.text).join('')), pad + BOX_PAD_X, cy + BOX_PAD_Y + name.height + 6 + data.lineHeight / 2 + mono * 0.35, data.lineHeight, ` class="pele-em-data" font-family="${FONT_MONO}" font-size="${mono}"`);
    out.end();
    out.end();
    placed.set(box, { y: cy, h, w, index, lane: lane.width });
    width = Math.max(width, w + gutter);
    bottom = cy + h;
    y = bottom + 28;
  });
  out.section('edges');
  for (const relation of model.relations) {
    const s = placed.get(relation.source), t = placed.get(relation.target);
    if (!s || !t || s === t) continue;
    const down = t.y > s.y;
    const dir = down ? 1 : -1;
    const sy = down ? s.y + s.h : s.y;
    const ty = down ? t.y : t.y + t.h;
    let d: Pen, head: () => void;
    if (Math.abs(s.index - t.index) === 1) {
      // The lower card's lane heading sits in the gap, and wraps to leave the arrow room beside it.
      const cx = pad + Math.max(Math.min(s.w, t.w) / 2, BOX_PAD_X + (down ? t : s).lane + 16);
      d = out.pen().M(cx, sy).V(ty - dir * markerTrim('arrow_point'));
      head = () => drawMarker(out, 'arrow_point', cx, ty, 0, dir, 'var(--_l)');
    } else {
      const rail = pad + width - gutter + 12 + RAIL_GAP * (railOf.get(relation.target) ?? 0);
      // A card can send one relation and receive another: they leave above and arrive below its middle.
      const from = s.y + s.h / 2 - 5, to = t.y + t.h / 2 + 5;
      d = out.pen().M(pad + s.w, from).H(rail).V(to).H(pad + t.w + markerTrim('arrow_point'));
      head = () => drawMarker(out, 'arrow_point', pad + t.w, to, -1, 0, 'var(--_l)');
    }
    out.group({ cls: 'pele-edge', id: `${relation.source.id}-${relation.target.id}`, source: relation.written });
    out.path(d, EDGE_LINE);
    head();
    out.end();
  }
  out.section('cards');
  const names = new Map(model.boxes.map(box => [box.id, box.name]));
  const card = (kind: string, heading: string, frame: string, raw: string, written: SourceInfo | undefined): void => {
    const head = layoutLabel(`${heading} · ${frame}${names.has(frame) ? ' ' + names.get(frame)! : ''}`, false, measurer, small, textRoom, Style.Bold);
    const body = text(raw, small);
    const w = Math.max(cardWidth, head.width + 2 * BOX_PAD_X, body.width + 2 * BOX_PAD_X);
    const h = 2 * BOX_PAD_Y + head.height + body.height;
    out.group({ cls: `pele-em-${kind}`, id: frame, source: written });
    out.rect(pad, y, w, h, OUTLINE);
    out.label(head, pad + BOX_PAD_X + head.width / 2, y + BOX_PAD_Y + head.height / 2, ` font-size="${small}" font-weight="var(--_hw)"`);
    drawLines(out, body.lines.map(line => line.map(span => span.text).join('')), pad + BOX_PAD_X, y + BOX_PAD_Y + head.height + body.lineHeight / 2 + small * 0.35, body.lineHeight, ` font-size="${small}"`);
    out.end();
    bottom = y + h;
    y = bottom + CARD_GAP;
    width = Math.max(width, w);
  };
  for (const note of model.notes) card('note', 'Note', note.frame, note.text, note.written);
  for (const spec of model.specifications) {
    const rows = [`Given  ${spec.given.join(', ')}`];
    if (spec.when.length) rows.push(`When  ${spec.when.join(', ')}`);
    rows.push(`Then  ${spec.then.join(', ')}`);
    card('specification', 'Given / When / Then', spec.frame, rows.join('\n'), spec.written);
  }
  const totalWidth = Math.ceil(width + 2 * pad), height = Math.ceil(bottom + pad);
  out.section('main');
  out.label(title, totalWidth / 2, pad + title.height / 2, TITLE);
  return { svg: out.done('eventmodeling', totalWidth, height, size, options, model), width: totalWidth, height, links: [] };
}
