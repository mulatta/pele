import type { Out } from '../draw/out.js';
import type { CNode } from '../layout/compound.js';
import { num } from './builder.js';
import { rounded } from './theme.js';

export interface ShapeSize {
  w: number;
  h: number;
  // Vertical shift of the label from the shape's center.
  dy: number;
}

export const PAD_X = 18;
export const PAD_Y = 12;

type Sizer = (tw: number, th: number) => ShapeSize;
type Drawer = (o: Out, w: number, h: number, a: string, line: string) => void;

// Distance from the bounding box to the outline on a side: 0 top, 1 right, 2 bottom, 3 left.
// `t` is how far along the side from its middle, to the right or down.
type Inset = (w: number, h: number, side: number, t: number) => number;

// How much of a side edges may spread along, centered on its middle: the top and bottom, or the
// left and right when `sideways`. A shape without one keeps its edges at the middle.
type Span = (w: number, h: number, sideways: boolean) => number;

interface ShapeDef {
  size: Sizer;
  draw: Drawer;
  inset?: Inset;
  span?: Span;
  noLabel?: boolean;
  // Ignores style fills.
  bare?: boolean;
}

// Kept clear at each end of a straight side, for the corner.
const CORNER = 12;

const flat: Span = (w, h, sideways) => (sideways ? h : w) - 2 * CORNER;
// Straight along the top and bottom except for `cut(h)` at each end, and not straight at the sides.
const flatAcross =
  (cut: (h: number) => number): Span =>
  (w, h, sideways) =>
    sideways ? 0 : w - 2 * cut(h) - 2 * CORNER;

// How far an ellipse's outline has fallen away from its bounding box, `t` from the middle of a side `half` long.
function bulge(t: number, half: number, depth: number): number {
  const k = Math.min(1, Math.abs(t) / half);
  return depth * (1 - Math.sqrt(1 - k * k));
}

const roundInset: Inset = (w, h, side, t) => (side & 1 ? bulge(t, h / 2, w / 2) : bulge(t, w / 2, h / 2));
const roundSpan: Span = (w, h, sideways) => (sideways ? h : w) * 0.6;
const capInset: Inset = (w, _h, side, t) => (side & 1 ? 0 : bulge(t, w / 2, Math.min(12, Math.max(6, w / 14))));

const fixed = (w: number, h: number): Sizer => () => ({ w, h, dy: 0 });

function triSize(tw: number, th: number, flip: boolean): ShapeSize {
  const w = Math.max(1.6 * tw + 40, 80);
  const h = (th + 10) / (1 - (tw + 8) / w);
  const dy = h / 2 - 10 - th / 2;
  return { w, h, dy: flip ? -dy : dy };
}

function circle(o: Out, r: number, a: string): void {
  o.circle(null, null, r, a);
}

const leanInset: Inset = (_w, h, side) => (side & 1 ? h / 8 : 0);

const box: Sizer = (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 2 * PAD_X + 12), h: th + 2 * PAD_Y, dy: 0 });

function poly(o: Out, points: number[], a: string): void {
  o.polygon(points, a);
}

function rect(o: Out, w: number, h: number, a: string, rx = ''): void {
  o.rect(-w / 2, -h / 2, w, h, rx + a);
}

const SHAPES: Record<string, ShapeDef> = {
  rect: { size: box, span: flat, draw: (o, w, h, a) => rect(o, w, h, rounded(a)) },
  rounded: {
    size: box,
    span: flat,
    draw: (o, w, h, a) => rect(o, w, h, a, ` rx="${num(Math.min(12, h / 2))}"`),
  },
  stadium: {
    inset: (_w, h, side, t) => (side & 1 ? bulge(t, h / 2, h / 2) : 0),
    span: (w, h, sideways) => (sideways ? h * 0.6 : w - h),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + h * 0.5 + 2 * PAD_X - 8, h, dy: 0 };
    },
    draw: (o, w, h, a) => rect(o, w, h, a, ` rx="${num(h / 2)}"`),
  },
  'fr-rect': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 16, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (o, w, h, a, line) => {
      const x = w / 2 - 8;
      rect(o, w, h, rounded(a));
      o.path(o.pen().M(-x, -h / 2).V(h / 2).M(x, -h / 2).V(h / 2), ' fill="none"' + line);
    },
  },
  cyl: {
    inset: capInset,
    span: (w, h, sideways) => (sideways ? h - 2 * CORNER - 12 : w * 0.6),
    size: (tw, th) => {
      const w = Math.max(tw + 2 * PAD_X, 56);
      const ry = Math.min(12, Math.max(6, w / 14));
      return { w, h: th + 2 * PAD_Y + 2 * ry, dy: ry / 2 };
    },
    draw: (o, w, h, a, line) => {
      const rx = w / 2;
      const ry = Math.min(12, Math.max(6, w / 14));
      const top = -h / 2 + ry;
      const bottom = h / 2 - ry;
      o.path(o.pen().M(-rx, top).A(rx, ry, 0, 0, 1, rx, top).V(bottom).A(rx, ry, 0, 0, 1, -rx, bottom).Z(), a);
      o.path(o.pen().M(-rx, top).A(rx, ry, 0, 0, 0, rx, top), ' fill="none"' + line);
    },
  },
  circle: {
    inset: roundInset,
    span: roundSpan,
    size: (tw, th) => {
      const d = Math.max(Math.sqrt(tw * tw + th * th) + 16, 44);
      return { w: d, h: d, dy: 0 };
    },
    draw: (o, w, _h, a) => circle(o, w / 2, a),
  },
  'dbl-circ': {
    inset: roundInset,
    span: roundSpan,
    size: (tw, th) => {
      const d = Math.max(Math.sqrt(tw * tw + th * th) + 26, 54);
      return { w: d, h: d, dy: 0 };
    },
    draw: (o, w, _h, a, line) => {
      circle(o, w / 2, a);
      circle(o, w / 2 - 5, ' fill="none"' + line);
    },
  },
  ellipse: {
    inset: roundInset,
    span: roundSpan,
    size: (tw, th) => ({ w: tw * 1.3 + 2 * PAD_X, h: th * 1.2 + 2 * PAD_Y, dy: 0 }),
    draw: (o, w, h, a) => o.ellipse(null, null, w / 2, h / 2, a),
  },
  diam: {
    inset: (w, h, side, t) => (side & 1 ? (Math.abs(t) * w) / h : (Math.abs(t) * h) / w),
    span: (w, h, sideways) => (sideways ? h : w) * 0.6,
    size: (tw, th) => {
      const a = tw + 16;
      const b = th + 8;
      return { w: a + 1.6 * b, h: a / 1.6 + b, dy: 0 };
    },
    draw: (o, w, h, a) => poly(o, [0, -h / 2, w / 2, 0, 0, h / 2, -w / 2, 0], a),
  },
  hex: {
    inset: (_w, _h, side, t) => (side & 1 ? Math.abs(t) / 2 : 0),
    span: (w, h, sideways) => (sideways ? h * 0.5 : w - h / 2 - CORNER),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const m = h / 4;
      return poly(o, [-w / 2 + m, -h / 2, w / 2 - m, -h / 2, w / 2, 0, w / 2 - m, h / 2, -w / 2 + m, h / 2, -w / 2, 0], a);
    },
  },
  odd: {
    inset: (_w, h, side) => (side === 3 ? h / 4 : 0),
    span: flatAcross(() => 0),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 4, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const notch = h / 4;
      return poly(o, [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2 + notch, 0], a);
    },
  },
  'lean-r': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const s = h / 4;
      return poly(o, [-w / 2 + s, -h / 2, w / 2, -h / 2, w / 2 - s, h / 2, -w / 2, h / 2], a);
    },
  },
  'lean-l': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const s = h / 4;
      return poly(o, [-w / 2, -h / 2, w / 2 - s, -h / 2, w / 2, h / 2, -w / 2 + s, h / 2], a);
    },
  },
  'trap-b': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const s = h / 4;
      return poly(o, [-w / 2 + s, -h / 2, w / 2 - s, -h / 2, w / 2, h / 2, -w / 2, h / 2], a);
    },
  },
  'trap-t': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const s = h / 4;
      return poly(o, [-w / 2, -h / 2, w / 2, -h / 2, w / 2 - s, h / 2, -w / 2 + s, h / 2], a);
    },
  },
  text: {
    bare: true,
    span: flat,
    size: (tw, th) => ({ w: tw + 8, h: th + 8, dy: 0 }),
    draw: (o, w, h) => rect(o, w, h, ' fill="none" stroke="none"'),
  },
  'sm-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(14, 14),
    draw: (o, w, _h, a) => circle(o, w / 2, a) },
  'f-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(14, 14),
    draw: (o, w, _h, _a, line) => circle(o, w / 2, ' fill="var(--_l)"' + line),
  },
  'fr-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(18, 18),
    draw: (o, w, _h, a, line) => {
      circle(o, w / 2, a);
      circle(o, w / 2 - 4, ' fill="var(--_l)"' + line);
    },
  },
  fork: {
    noLabel: true,
    span: (w, h, sideways) => (sideways ? h : w) - 8,
    size: fixed(72, 8),
    draw: (o, w, h, _a, line) => rect(o, w, h, ` fill="var(--_l)"${line}`, ' rx="2"'),
  },
  'notch-rect': {
    size: box,
    span: flat,
    draw: (o, w, h, a) => {
      const c = 10;
      return poly(o, [-w / 2 + c, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2 + c], a);
    },
  },
  'lin-rect': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (o, w, h, a, line) => {
      rect(o, w, h, rounded(a));
      o.path(o.pen().M(-w / 2 + 8, -h / 2).V(h / 2), ' fill="none"' + line);
    },
  },
  'div-rect': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (o, w, h, a, line) => {
      rect(o, w, h, rounded(a));
      o.path(o.pen().M(-w / 2, -h / 2 + 8).H(w / 2), ' fill="none"' + line);
    },
  },
  'win-pane': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (o, w, h, a, line) => {
      rect(o, w, h, rounded(a));
      o.path(o.pen().M(-w / 2 + 8, -h / 2).V(h / 2).M(-w / 2, -h / 2 + 8).H(w / 2), ' fill="none"' + line);
    },
  },
  tri: {
    inset: (w, _h, side) => (side & 1 ? w / 4 : 0),
    size: (tw, th) => triSize(tw, th, false),
    draw: (o, w, h, a) => poly(o, [0, -h / 2, w / 2, h / 2, -w / 2, h / 2], a),
  },
  'flip-tri': {
    inset: (w, _h, side) => (side & 1 ? w / 4 : 0),
    size: (tw, th) => triSize(tw, th, true),
    draw: (o, w, h, a) => poly(o, [-w / 2, -h / 2, w / 2, -h / 2, 0, h / 2], a),
  },
  'sl-rect': {
    inset: (_w, _h, side) => (side === 0 ? 5 : 0),
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 10, dy: 5 }),
    draw: (o, w, h, a) => poly(o, [-w / 2, -h / 2 + 10, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2], a),
  },
  'notch-pent': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (o, w, h, a) => {
      const c = 10;
      return poly(o, [-w / 2 + c, -h / 2, w / 2 - c, -h / 2, w / 2, -h / 2 + c, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2 + c], a);
    },
  },
  hourglass: {
    noLabel: true,
    inset: (w, _h, side) => (side & 1 ? w / 2 : 0),
    size: fixed(32, 40),
    draw: (o, w, h, a) => poly(o, [-w / 2, -h / 2, w / 2, -h / 2, -w / 2, h / 2, w / 2, h / 2], a),
  },
  delay: {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 4, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const r = h / 2;
      o.path(o.pen().M(-w / 2, -r).H(w / 2 - r).A(r, r, 0, 0, 1, w / 2 - r, r).H(-w / 2).Z(), a);
    },
  },
  'h-cyl': {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      const rx = Math.min(12, h / 4);
      return { w: tw + 2 * PAD_X + 2 * rx, h, dy: 0 };
    },
    draw: (o, w, h, a, line) => {
      const ry = h / 2;
      const rx = Math.min(12, h / 4);
      const l = -w / 2 + rx;
      const r = w / 2 - rx;
      o.path(o.pen().M(l, -ry).H(r).A(rx, ry, 0, 0, 1, r, ry).H(l).A(rx, ry, 0, 0, 1, l, -ry).Z(), a);
      o.path(o.pen().M(r, -ry).A(rx, ry, 0, 0, 0, r, ry), ' fill="none"' + line);
    },
  },
  'cross-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(44, 44),
    draw: (o, w, _h, a, line) => {
      const r = w / 2;
      const k = r * Math.SQRT1_2;
      circle(o, r, a);
      o.path(o.pen().M(-k, -k).L(k, k).M(k, -k).L(-k, k), ' fill="none"' + line);
    },
  },
  'st-rect': {
    span: (w, h, sideways) => (sideways ? h : w) - 2 * CORNER - 8,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (o, w, h, a) => {
      const bw = w - 8;
      const bh = h - 8;
      const ra = rounded(a);
      for (let i = 0; i < 3; i++) o.rect(-w / 2 + (2 - i) * 4, -h / 2 + i * 4, bw, bh, ra);
    },
  },
  doc: {
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 10, dy: -5 }),
    draw: (o, w, h, a) => wave(o, w, h, a),
  },
  flag: {
    inset: (_w, _h, side) => (side & 1 ? 0 : 8),
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 16, dy: 0 }),
    draw: (o, w, h, a) => {
      const x = w / 2;
      const y = h / 2 - 8;
      const q = w / 4;
      o.path(o.pen().M(-x, -y).q(q, -10, 2 * q, 0).t(2 * q, 0).V(y).q(-q, 10, -2 * q, 0).t(-2 * q, 0).Z(), a);
    },
  },
  datastore: {
    size: box,
    span: flat,
    draw: (o, w, h, a, line) => {
      rect(o, w, h, a.replace('stroke="var(--_b)"', 'stroke="none"'));
      o.path(o.pen().M(-w / 2, -h / 2).H(w / 2).M(-w / 2, h / 2).H(w / 2), ' fill="none"' + line);
    },
  },
  folder: {
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 64), h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (o, w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const tab = Math.min(w * 0.4, 48);
      o.path(o.pen().M(-x, -y).H(-x + tab).L(-x + tab + 8, -y + 8).H(x).V(y).H(-x).Z(), a);
    },
  },
  bucket: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 20, h: th + 2 * PAD_Y + 10, dy: 3 }),
    inset: (_w, h, side) => (side & 1 ? h / 12 : 0),
    draw: (o, w, h, a, line) => {
      const x = w / 2;
      const y = h / 2;
      const ry = 5;
      const taper = h / 6;
      o.path(o.pen().M(-x, -y + ry).A(x, ry, 0, 0, 1, x, -y + ry).L(x - taper, y - ry).A(x - taper, ry, 0, 0, 1, -x + taper, y - ry).Z(), a);
      o.path(o.pen().M(-x, -y + ry).A(x, ry, 0, 0, 0, x, -y + ry), ' fill="none"' + line);
    },
  },
  console: {
    span: flat,
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 72), h: th + 2 * PAD_Y + 12, dy: 6 }),
    draw: (o, w, h, a, line) => {
      rect(o, w, h, rounded(a));
      o.path(o.pen().M(-w / 2, -h / 2 + 12).H(w / 2).M(-w / 2 + 7, -h / 2 + 4).l(3, 2.5).l(-3, 2.5).M(-w / 2 + 13, -h / 2 + 9).h(4), ' fill="none"' + line);
    },
  },
  browser: {
    span: flat,
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 72), h: th + 2 * PAD_Y + 12, dy: 6 }),
    draw: (o, w, h, a, line) => {
      rect(o, w, h, rounded(a));
      o.path(o.pen().M(-w / 2, -h / 2 + 12).H(w / 2), ' fill="none"' + line);
      for (let i = 0; i < 3; i++) o.circle(-w / 2 + 8 + i * 7, -h / 2 + 6, 1.5, ' fill="none"' + line);
    },
  },
  person: {
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 56), h: th + 2 * PAD_Y + 26, dy: 13 }),
    draw: (o, w, h, a) => {
      const top = -h / 2;
      o.rect(-w / 2, top + 26, w, h - 26, ' rx="12"' + a);
      o.circle(null, top + 14, 13, a);
    },
  },
  bang: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 28, h: th + 2 * PAD_Y + 24, dy: 0 }),
    inset: () => 3,
    draw: (o, w, h, a) => {
      const spikes = 14;
      const pts: number[] = [];
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (Math.PI * i) / spikes - Math.PI / 2;
        const k = i % 2 === 0 ? 1 : 0.82;
        pts.push(Math.cos(angle) * (w / 2) * k, Math.sin(angle) * (h / 2) * k);
      }
      return poly(o, pts, a);
    },
  },
  cloud: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 32, h: th + 2 * PAD_Y + 24, dy: 0 }),
    inset: (_w, _h, side) => (side & 1 ? 2 : 1),
    draw: (o, w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const r = y * 0.55;
      o.path(
        o
          .pen()
          .M(-x + r, y)
          .A(r, r, 0, 0, 1, -x + r * 0.6, -y * 0.1)
          .A(x * 0.42, y * 0.7, 0, 0, 1, -x * 0.1, -y * 0.72)
          .A(x * 0.4, y * 0.62, 0, 0, 1, x * 0.62, -y * 0.42)
          .A(r * 1.05, r * 1.05, 0, 0, 1, x - r, y)
          .Z(),
        a
      );
    },
  },
  brace: {
    bare: true,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 12, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (o, w, h, _a, line) => {
      rect(o, w, h, ' fill="none" stroke="none"');
      brace(o, -w / 2 + 12, h, -1, line);
    },
  },
  'brace-r': {
    bare: true,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 12, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (o, w, h, _a, line) => {
      rect(o, w, h, ' fill="none" stroke="none"');
      brace(o, w / 2 - 12, h, 1, line);
    },
  },
  braces: {
    bare: true,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 24, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (o, w, h, _a, line) => {
      rect(o, w, h, ' fill="none" stroke="none"');
      brace(o, -w / 2 + 12, h, -1, line);
      brace(o, w / 2 - 12, h, 1, line);
    },
  },
  bolt: {
    noLabel: true,
    size: fixed(36, 56),
    inset: (w, _h, side) => (side & 1 ? w / 4 : 0),
    draw: (o, w, h, a) => poly(o, [w * 0.15, -h / 2, -w / 2, h * 0.08, -w * 0.05, h * 0.08, -w * 0.15, h / 2, w / 2, -h * 0.08, w * 0.05, -h * 0.08], a),
  },
  'lin-cyl': {
    inset: capInset,
    span: (w, h, sideways) => (sideways ? h - 2 * CORNER - 20 : w * 0.6),
    size: (tw, th) => {
      const w = Math.max(tw + 2 * PAD_X, 56);
      const ry = Math.min(12, Math.max(6, w / 14));
      return { w, h: th + 2 * PAD_Y + 2 * ry + 8, dy: ry / 2 + 4 };
    },
    draw: (o, w, h, a, line) => {
      const rx = w / 2;
      const ry = Math.min(12, Math.max(6, w / 14));
      const top = -h / 2 + ry;
      const bottom = h / 2 - ry;
      o.path(o.pen().M(-rx, top).A(rx, ry, 0, 0, 1, rx, top).V(bottom).A(rx, ry, 0, 0, 1, -rx, bottom).Z(), a);
      o.path(o.pen().M(-rx, top).A(rx, ry, 0, 0, 0, rx, top).M(-rx, top + 8).A(rx, ry, 0, 0, 0, rx, top + 8), ' fill="none"' + line);
    },
  },
  'curv-trap': {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h * 0.6, h, dy: 0 };
    },
    draw: (o, w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const k = h * 0.3;
      o.path(o.pen().M(-x + k, -y).H(x - k).A(k, y, 0, 0, 1, x - k, y).H(-x + k).L(-x, 0).Z(), a);
    },
  },
  docs: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 18, dy: -1 }),
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    draw: (o, w, h, a) => {
      for (let i = 0; i < 3; i++) {
        o.shift((1 - i) * 4, (i - 1) * 4);
        wave(o, w - 8, h - 8, a);
        o.end();
      }
    },
  },
  'bow-rect': {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h * 0.4, h, dy: 0 };
    },
    inset: (_w, h, side) => (side === 1 ? h * 0.2 : 0),
    draw: (o, w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const k = h * 0.2;
      o.path(o.pen().M(-x + k, -y).H(x).A(k, y, 0, 0, 0, x, y).H(-x + k).A(k, y, 0, 0, 1, -x + k, -y).Z(), a);
    },
  },
  'tag-rect': {
    size: box,
    span: flat,
    draw: (o, w, h, a, line) => {
      rect(o, w, h, rounded(a));
      o.path(o.pen().M(w / 2 - 12, h / 2).L(w / 2, h / 2 - 12), ' fill="none"' + line);
    },
  },
  'tag-doc': {
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 10, dy: -5 }),
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    draw: (o, w, h, a, line) => {
      wave(o, w, h, a);
      o.path(o.pen().M(w / 2 - 12, h / 2 - 14).L(w / 2, h / 2 - 26), ' fill="none"' + line);
    },
  },
  'lin-doc': {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 10, dy: -5 }),
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    draw: (o, w, h, a, line) => {
      wave(o, w, h, a);
      o.path(o.pen().M(-w / 2 + 8, -h / 2).V(h / 2 - 6), ' fill="none"' + line);
    },
  },
  collapsedGroup: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 8, dy: -2 }),
    draw: (o, w, h, a) => {
      o.rect(-w / 2 + 6, -h / 2 + 8, w - 12, h - 8, rounded(a));
      o.rect(-w / 2, -h / 2, w, h - 4, rounded(a));
    },
  },
};

function brace(o: Out, x: number, h: number, dir: number, line: string): void {
  const y = h / 2;
  const k = 6 * dir;
  o.path(o.pen().M(x, -y).q(k, 0, k, 6).V(-6).q(0, 6, k, 6).q(-k, 0, -k, 6).V(y - 6).q(0, 6, -k, 6), ' fill="none"' + line);
}

function wave(o: Out, w: number, h: number, a: string): void {
  const x = w / 2;
  const top = -h / 2;
  const base = h / 2 - 10;
  const q = w / 4;
  o.path(o.pen().M(-x, top).H(x).V(base).q(-q, -12, -2 * q, 0).t(-2 * q, 0).Z(), a);
}

const FALLBACK = SHAPES.rect;

// Looked up through a Map so that names like "constructor" cannot reach Object.prototype.
const BY_NAME = new Map(Object.entries(SHAPES));

export function shapeSize(shape: string, tw: number, th: number): ShapeSize {
  return (BY_NAME.get(shape) ?? FALLBACK).size(tw, th);
}

// Draws a node's outline centered on the origin of the group it is in.
export function drawShape(o: Out, shape: string, w: number, h: number, a: string, line: string): void {
  (BY_NAME.get(shape) ?? FALLBACK).draw(o, w, h, a, line);
}

export function shapeInset(shape: string, w: number, h: number, side: number, t = 0): number {
  return BY_NAME.get(shape)?.inset?.(w, h, side, t) ?? 0;
}

// How much of a side of the shape edges may spread along, when the flow runs down or, if `sideways`, across.
export function shapeSpan(shape: string, w: number, h: number, sideways: boolean): number {
  return Math.max(0, BY_NAME.get(shape)?.span?.(w, h, sideways) ?? 0);
}

export function shapeHasLabel(shape: string): boolean {
  return BY_NAME.get(shape)?.noLabel !== true;
}

export function shapeFilled(shape: string): boolean {
  return (BY_NAME.get(shape) ?? FALLBACK).bare !== true;
}

// The side of a node's layout box that a route end lies on: 0 top, 1 right, 2 bottom, 3 left, or -1 for none.
export function endSide(route: number[], at: number, c: CNode): number {
  const dx = route[at] - c.x;
  const dy = route[at + 1] - c.y;
  if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) return dy < 0 ? 0 : 2;
  if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) return dx < 0 ? 3 : 1;
  return -1;
}

// Moves a route end from a node's layout box onto the outline of the shape drawn in it.
export function insetRoute(route: number[], at: number, view: { shape: string; w: number; h: number }, c: CNode): void {
  if (c.isGroup) return;
  const side = endSide(route, at, c);
  if (side === 0 || side === 2) {
    const amount = shapeInset(view.shape, view.w, view.h, side, route[at] - c.x) + (c.h - view.h) / 2;
    route[at + 1] += side === 0 ? amount : -amount;
  } else if (side >= 0) {
    const amount = shapeInset(view.shape, view.w, view.h, side, route[at + 1] - c.y) + (c.w - view.w) / 2;
    route[at] += side === 3 ? amount : -amount;
  }
}
