import type { Config } from '../../preprocess.js';
import { Paint, type Out } from '../../draw/out.js';
import { ARROW, drawMarker } from '../../svg/edges.js';
import { ROUNDED } from '../../svg/theme.js';
import { breakLabel } from '../common/literal-label.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { turnToFit, titleRoom } from '../common/fit-width.js';
import type { IshikawaModel, IshikawaNode } from './types.js';

// How far a bone moves toward the tail for each unit it rises from the spine.
const SLANT = 0.5;
const LENGTH = Math.hypot(SLANT, 1);
const FIRST_ROW = 14;
const ROW_GAP = 6;
const BONE_END = 8;
const TWIG_STEP = 22;
const STUB = 18;
const TEXT_GAP = 5;
const PAIR_GAP = 26;
const HEAD_GAP = 34;
const TAIL = 28;
const BOX_PAD_X = 10;
const BOX_PAD_Y = 5;
const BONES = new Paint(' fill="none" stroke="var(--_l)"');
const CATEGORY_BOX = new Paint(` fill="var(--_s)" stroke="var(--_b)"${ROUNDED}`);
const HEAD_SHAPE = new Paint(' fill="var(--_s)" stroke="var(--_b)" stroke-linejoin="round"');
const EDGE = new Paint(' fill="none" stroke="var(--_b)"');
const TITLE = ' class="pele-title" font-weight="var(--_tw)"';

// A cause below a category. Bones at even depths run level, from the slanted bone above them
// toward the tail; bones at odd depths slant away from the spine, from the level bone above them.
interface Bone {
  label: Label;
  depth: number;
  parent: number;
  // Its place among its siblings, counted from the spine outward.
  slot: number;
  kids: number;
  // How far its row is from the spine.
  rise: number;
  // Where it meets its parent, measured level from the category's bone: 0 on it, negative toward the tail.
  at: number;
  // Where its text ends.
  textEnd: number;
}

interface Category {
  node: IshikawaNode;
  label: Label;
  boxW: number;
  boxH: number;
  bones: Bone[];
  // The length of its bone, as distance from the spine.
  rise: number;
  // How far its causes reach toward the tail, measured level from its bone.
  reach: number;
}

interface Frame {
  node: IshikawaNode;
  depth: number;
  parent: number;
  slot: number;
  // Set when the bone was made and only its row is still to come.
  bone: number;
}

// Gives every cause of a category a row of its own, so that no two texts can meet, and measures
// how far the whole of it reaches. A level bone takes the row nearest the spine and its twigs the
// rows beyond; a slanted twig takes the row beyond everything that hangs off it. The outline may
// be nested as deep as its indentation goes, so the walk keeps a stack of its own.
function arrange(node: IshikawaNode, up: boolean, measurer: TextMeasurer, size: number, small: number): Category {
  const label = layoutLabel(node.text, false, measurer, size, 180);
  const lineHeight = Math.round(small * 1.5);
  const bones: Bone[] = [];
  const rows: number[] = [];
  const stack: Frame[] = [];
  // Above the spine the first cause goes farthest out, so that the causes read from the top down.
  const push = (children: IshikawaNode[], depth: number, parent: number): void => {
    const n = children.length;
    for (let slot = n - 1; slot >= 0; slot--) {
      stack.push({ node: children[up ? n - 1 - slot : slot], depth, parent, slot, bone: -1 });
    }
  };
  push(node.children, 2, -1);
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.bone !== -1) {
      rows.push(frame.bone);
      continue;
    }
    const index = bones.length;
    bones.push({
      label: layoutLabel(frame.node.text, false, measurer, small, 200),
      depth: frame.depth,
      parent: frame.parent,
      slot: frame.slot,
      kids: frame.node.children.length,
      rise: 0,
      at: 0,
      textEnd: 0,
    });
    if (frame.depth % 2 === 0) rows.push(index);
    else {
      frame.bone = index;
      stack.push(frame);
    }
    push(frame.node.children, frame.depth + 1, index);
  }

  let rise = FIRST_ROW;
  for (const index of rows) {
    const height = Math.max(bones[index].label.height, lineHeight) + ROW_GAP;
    bones[index].rise = rise + height / 2;
    rise += height;
  }
  const boxW = label.width + 2 * BOX_PAD_X;
  let reach = boxW / 2;
  for (const bone of bones) {
    const parent = bone.parent === -1 ? undefined : bones[bone.parent];
    if (bone.depth % 2 === 0) {
      bone.at = parent ? parent.at : 0;
      bone.textEnd = bone.at - (bone.kids > 0 ? (bone.kids + 1) * TWIG_STEP : STUB) - TEXT_GAP;
    } else {
      // Twigs stand along their level bone, the one nearest the spine nearest the tail.
      bone.at = parent!.at - (parent!.kids - bone.slot) * TWIG_STEP;
      bone.textEnd = bone.at - TEXT_GAP;
    }
    reach = Math.max(reach, bone.label.width - bone.textEnd);
  }
  return { node, label, boxW, boxH: label.height + 2 * BOX_PAD_Y, bones, rise: rise + BONE_END, reach };
}

export function renderIshikawa(model: IshikawaModel, _config: Config, options: RenderOptions, out: Out): Rendered {
  return turnToFit(options, (down, o) => draw(o, model, _config, options, down), out);
}

function draw(out: Out, model: IshikawaModel, _config: Config, options: RenderOptions, down: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  if (down) return verticalCauses(out, model, options);
  const root = model.root;
  const title = layoutLabel(model.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;

  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  if (root) {
    const head = layoutLabel(root.text, false, measurer, size, 200, Style.Bold);
    const headH = Math.max(head.height + 24, 48);
    const headW = head.width + 24 + headH / 2;
    const categories = root.children.map((node, i) => arrange(node, i % 2 === 0, measurer, size, small));
    // Even a category without causes has a bone long enough to carry its name clear of the head.
    for (const category of categories) category.rise = Math.max(category.rise, headH / 2 + 14);

    // Categories meet the spine in pairs, one above and one below, each pair as far toward the
    // tail from the one before as the wider of the two needs.
    const xs: number[] = [];
    let x = -HEAD_GAP;
    for (let i = 0; i < categories.length; i += 2) {
      if (i > 0) {
        let room = 0;
        for (let side = 0; side < 2; side++) {
          const before = categories[i - 2 + side];
          const next = categories[i + side];
          if (before) room = Math.max(room, before.reach + (next ? next.boxW / 2 : 0));
        }
        x -= room + PAIR_GAP;
      }
      xs.push(x, x);
    }
    const tail = categories.length > 0 ? x - TAIL : -HEAD_GAP;

    maxX = headW;
    minX = tail;
    minY = -headH / 2;
    maxY = headH / 2;
    // The drawing is moved by where its extent ends up, known only after it is drawn.
    out.frame(0, 0);
    out.section('body');
    out.path(out.pen().M(tail, 0).H(-(ARROW - 1)), BONES, undefined, { cls: 'pele-ishikawa-spine' });
    drawMarker(out, 'arrow_point', 0, 0, 1, 0, 'var(--_l)');
    categories.forEach((category, i) => {
      const sign = i % 2 === 0 ? -1 : 1;
      const ax = xs[i];
      const px = (at: number, rise: number): number => ax + at - rise * SLANT;
      const endX = px(0, category.rise);
      const endY = sign * category.rise;
      // The bone stops short of the spine to leave its arrowhead a clean point.
      const trim = ARROW - 1;
      const d = out.pen().M(ax - (SLANT / LENGTH) * trim, (sign * trim) / LENGTH).L(endX, endY);
      const texts: { label: Label; x: number; y: number; attrs: string }[] = [];
      for (const bone of category.bones) {
        const y = sign * bone.rise;
        if (bone.depth % 2 === 0) {
          d.M(px(bone.at, bone.rise), y).H(px(bone.textEnd + TEXT_GAP, bone.rise));
        } else {
          const from = category.bones[bone.parent].rise;
          d.M(px(bone.at, from), sign * from).L(px(bone.at, bone.rise), y);
        }
        const right = px(bone.textEnd, bone.rise);
        if (bone.label.lines.length > 0) texts.push({ label: bone.label, x: right - bone.label.width / 2, y, attrs: bone.depth > 2 ? ' fill="var(--_m)"' : '' });
        minX = Math.min(minX, right - bone.label.width);
      }
      const boxY = endY + sign * (category.boxH / 2);
      minX = Math.min(minX, endX - category.boxW / 2);
      maxX = Math.max(maxX, endX + category.boxW / 2);
      minY = Math.min(minY, boxY - category.boxH / 2);
      maxY = Math.max(maxY, boxY + category.boxH / 2);
      out.group({ cls: 'pele-ishikawa-category', id: category.node.text, source: category.node.source });
      out.path(d, BONES, undefined, { cls: 'pele-ishikawa-bones' });
      drawMarker(out, 'arrow_point', ax, 0, SLANT / LENGTH, -sign / LENGTH, 'var(--_l)');
      out.rect(endX - category.boxW / 2, boxY - category.boxH / 2, category.boxW, category.boxH, CATEGORY_BOX);
      out.label(category.label, endX, boxY, ' class="pele-label"');
      if (texts.length > 0) {
        out.group({ cls: 'pele-ishikawa-causes', attrs: ` font-size="${small}"` });
        for (const t of texts) out.label(t.label, t.x, t.y, t.attrs);
        out.end();
      }
      out.end();
    });

    const r = headH / 2;
    out.group({ cls: 'pele-ishikawa-head', id: root.text, source: root.source });
    out.path(out.pen().M(0, -r).H(headW - r).A(r, r, 0, 0, 1, headW - r, r).H(0).Z(), HEAD_SHAPE);
    out.label(head, 12 + head.width / 2, 0, ' class="pele-label" font-weight="var(--_hw)"');
    out.end();
  }

  const inner = Math.max(maxX - minX, title.width);
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);
  const ox = pad + (inner - (maxX - minX)) / 2 - minX;
  const oy = pad + titleHeight - minY;
  if (root) out.frame(ox, oy);
  out.section('main');
  out.label(title, width / 2, pad + title.height / 2, TITLE);
  out.done(width, height);
  return { width, height, links: [] };
}

function verticalCauses(out: Out, model: IshikawaModel, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const room = Math.max(140, (options.maxWidth ?? 320) - 2 * pad);
  const title = layoutLabel(model.title, false, measurer, size, titleRoom(options), Style.Bold);
  const order: { node: IshikawaNode; depth: number; parent: number; x: number; y: number; w: number; h: number; label?: Label }[] = [];
  const pending = model.root ? [{ node: model.root!, depth: 0, parent: -1 }] : [];
  let depth = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    const index = order.length;
    order.push({ ...entry, x: 0, y: 0, w: 0, h: 0 });
    depth = Math.max(depth, entry.depth);
    for (let i = entry.node.children.length - 1; i >= 0; i--) pending.push({ node: entry.node.children[i], depth: entry.depth + 1, parent: index });
  }
  const indent = Math.min(20, Math.max(2, (room - 120) / Math.max(1, depth)));
  let y = pad + (title.height ? title.height + 12 : 0), width = title.width;
  out.section('edges');
  out.section('nodes');
  for (const entry of order) {
    entry.x = pad + entry.depth * indent;
    const labelRoom = Math.max(60, room - entry.depth * indent - 20);
    entry.label = breakLabel(layoutLabel(entry.node.text, false, measurer, entry.depth < 2 ? size : small, labelRoom, entry.depth < 2 ? Style.Bold : 0), measurer, labelRoom);
    entry.w = entry.label.width + 20;
    entry.h = entry.label.height + 12;
    entry.y = y;
    y += entry.h + 12;
    width = Math.max(width, entry.x - pad + entry.w);
    const framed = entry.depth < 2;
    out.section('nodes');
    out.group({
      cls: `pele-node ${entry.depth === 0 ? 'pele-ishikawa-head' : entry.depth === 1 ? 'pele-ishikawa-category' : 'pele-ishikawa-cause'}`,
      id: entry.node.text,
      source: entry.node.source,
    });
    if (framed) out.rect(entry.x, entry.y, entry.w, entry.h, ` rx="${entry.depth === 0 ? 12 : 4}" fill="var(--_s)" stroke="var(--_b)"`);
    out.label(entry.label, entry.x + entry.w / 2, entry.y + entry.h / 2, ` class="pele-label"${entry.depth < 2 ? ' font-weight="var(--_hw)"' : ''}${entry.depth > 1 ? ` font-size="${small}"` : ''}`);
    out.end();
    if (entry.parent >= 0) {
      const parent = order[entry.parent];
      const gx = parent.x + indent / 2;
      out.section('edges');
      out.path(out.pen().M(gx, parent.y + parent.h).V(entry.y + entry.h / 2).H(entry.x), EDGE, undefined, { cls: 'pele-edge' });
    }
  }
  const totalWidth = Math.ceil(width + 2 * pad), height = Math.ceil(Math.max(pad + title.height, y - 12) + pad);
  out.section('main');
  out.label(title, totalWidth / 2, pad + title.height / 2, TITLE);
  out.done(totalWidth, height);
  return { width: totalWidth, height, links: [] };
}
