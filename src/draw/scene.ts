// Scene output: a renderer-neutral vector scene written while a diagram is
// drawn, instead of SVG text that a host would have to parse again.
//
// A renderer draws into it through the Out calls: structure (sections, items,
// translations) and the geometry it holds as numbers go in as they are, labels
// straight from their measured layout. SVG fragments (a shape's outline, a
// marker) are read the way the SVG they are part of would be, and small ones
// are cached, as the same pieces come again.
//
// The data matches herdr-scene's scene contract, version 2: paint stays a
// token (`var(--_s)`) for the host's theme to resolve.

import { decodeEntities } from '../text/entities.js';
import type { Label } from '../text/label.js';
import { Style } from '../text/measurer.js';
import type { SourceInfo } from '../types.js';
import type { Attrs, Group, Item, Out, Pen, Run } from './out.js';

export const SCENE_VERSION = 2;

// A path is one flat array of numbers: an op code, then that op's arguments, command after
// command. One array per shape keeps a diagram's heap (and every walk over it) to a few objects
// instead of one array and one string per command.
//   M x y            0    L x y            1
//   C x1 y1 x2 y2 x y  2  Q x1 y1 x y      3
//   A rx ry rot large sweep x y  4         Z (no arguments)  5
export type Path = number[];
export const M = 0;
export const L = 1;
export const C = 2;
export const Q = 3;
export const A = 4;
export const Z = 5;
// Arguments after each op code.
const ARGC = [2, 2, 6, 4, 7, 0];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SceneShape {
  kind: 'fill' | 'stroke';
  paint: string;
  opacity: number;
  width?: number;
  dash?: number[] | null;
  cmds: Path;
  box: Box;
  item: number;
}

export interface SceneSpan {
  text: string;
  weight?: number;
  italic?: boolean;
  mono?: boolean;
  paint?: string;
}

export interface SceneText {
  x: number;
  y: number;
  size: number;
  weight: number;
  italic: boolean;
  anchor: 'start' | 'middle' | 'end';
  paint: string;
  spans: SceneSpan[];
  item: number;
}

export interface SceneItem extends SourceInfo {
  id: string;
  kind: string;
  box: Box | null;
}

export interface Scene {
  version: number;
  x: number;
  y: number;
  w: number;
  h: number;
  baseline: number | null;
  shapes: SceneShape[];
  texts: SceneText[];
  items: SceneItem[];
  skipped: Record<string, number>;
}

// ---------------------------------------------------------------- style

// Presentation properties that inherit, as pele writes them in attributes or
// in a style="" declaration list.
interface Look {
  fill?: string;
  stroke?: string;
  'stroke-width'?: string;
  'stroke-dasharray'?: string;
  'fill-opacity'?: string;
  'stroke-opacity'?: string;
  opacity?: string;
  'font-size'?: string;
  'font-weight'?: string;
  'font-style'?: string;
  'text-anchor'?: string;
  rx?: string;
}

const KEYS = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'opacity', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'rx']);
const RE_ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

const lookCache = new Map<string, Look>();

// ` fill="x" style="stroke:y;rx:var(--_r)"` -> { fill: 'x', stroke: 'y', rx: ... }. Declarations in
// style win over attributes, as in CSS.
export function parseLook(attrs: string): Look {
  let look = lookCache.get(attrs);
  if (look) return look;
  look = {};
  let style = '';
  for (const m of attrs.matchAll(RE_ATTR)) {
    if (m[1] === 'style') style = m[2];
    else if (KEYS.has(m[1])) (look as Record<string, string>)[m[1]] = m[2];
  }
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i <= 0) continue;
    const key = decl.slice(0, i).trim();
    if (KEYS.has(key)) (look as Record<string, string>)[key] = decl.slice(i + 1).trim().replace(/\s*!important$/, '');
  }
  if (lookCache.size > 2000) lookCache.clear();
  lookCache.set(attrs, look);
  return look;
}

const len = (v: string | undefined, fallback: number): number => {
  if (v === undefined) return fallback;
  if (v === 'var(--_r)') return 4; // --pele-radius
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const weight = (v: string | undefined, fallback: number): number => {
  if (v === undefined) return fallback;
  if (v === 'bold' || /^var\(--_(w|tw|hw)\)$/.test(v)) return 700;
  if (v === 'normal') return 400;
  return len(v, fallback);
};

const NO_LOOK: Look = {};
const NO_FILL: Look = { fill: 'none' };

// A Paint keeps what it was read as, so it is read once however often it is drawn.
const lookAt = (a: Attrs): Look =>
  typeof a === 'string' ? (a === '' ? NO_LOOK : parseLook(a)) : ((a.look as Look | undefined) ?? (a.look = parseLook(a.attrs)) as Look);

class ScenePen implements Pen {
  cmds: Path = [];
  private x = 0;
  private y = 0;
  // Where the subpath started, for Z, and the last control points, for S and T.
  private sx = 0;
  private sy = 0;
  private cx: number | null = null;
  private cy = 0;
  private qx: number | null = null;
  private qy = 0;
  // The commands set the current point themselves: a helper call per command costs an interpreter
  // as much as the command.
  M(x: number, y: number): this {
    this.cmds.push(M, x, y);
    this.x = this.sx = x;
    this.y = this.sy = y;
    this.cx = this.qx = null;
    return this;
  }
  L(x: number, y: number): this {
    this.cmds.push(L, x, y);
    this.x = x;
    this.y = y;
    this.cx = this.qx = null;
    return this;
  }
  H(x: number): this {
    return this.L(x, this.y);
  }
  V(y: number): this {
    return this.L(this.x, y);
  }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.cmds.push(C, x1, y1, x2, y2, x, y);
    this.cx = x2;
    this.cy = y2;
    this.qx = null;
    this.x = x;
    this.y = y;
    return this;
  }
  S(x2: number, y2: number, x: number, y: number): this {
    const x1 = this.cx === null ? this.x : 2 * this.x - this.cx;
    const y1 = this.cx === null ? this.y : 2 * this.y - this.cy;
    return this.C(x1, y1, x2, y2, x, y);
  }
  Q(x1: number, y1: number, x: number, y: number): this {
    this.cmds.push(Q, x1, y1, x, y);
    this.qx = x1;
    this.qy = y1;
    this.cx = null;
    this.x = x;
    this.y = y;
    return this;
  }
  T(x: number, y: number): this {
    const x1 = this.qx === null ? this.x : 2 * this.x - this.qx;
    const y1 = this.qx === null ? this.y : 2 * this.y - this.qy;
    return this.Q(x1, y1, x, y);
  }
  A(rx: number, ry: number, rotation: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): this {
    this.cmds.push(A, Math.abs(rx), Math.abs(ry), rotation, large, sweep, x, y);
    this.cx = this.qx = null;
    this.x = x;
    this.y = y;
    return this;
  }
  Z(): this {
    this.cmds.push(Z);
    this.cx = this.qx = null;
    this.x = this.sx;
    this.y = this.sy;
    return this;
  }
  m(dx: number, dy: number): this {
    return this.M(this.x + dx, this.y + dy);
  }
  l(dx: number, dy: number): this {
    return this.L(this.x + dx, this.y + dy);
  }
  h(dx: number): this {
    return this.L(this.x + dx, this.y);
  }
  v(dy: number): this {
    return this.L(this.x, this.y + dy);
  }
  c(dx1: number, dy1: number, dx2: number, dy2: number, dx: number, dy: number): this {
    const x = this.x;
    const y = this.y;
    return this.C(x + dx1, y + dy1, x + dx2, y + dy2, x + dx, y + dy);
  }
  s(dx2: number, dy2: number, dx: number, dy: number): this {
    return this.S(this.x + dx2, this.y + dy2, this.x + dx, this.y + dy);
  }
  q(dx1: number, dy1: number, dx: number, dy: number): this {
    const x = this.x;
    const y = this.y;
    return this.Q(x + dx1, y + dy1, x + dx, y + dy);
  }
  t(dx: number, dy: number): this {
    return this.T(this.x + dx, this.y + dy);
  }
  a(rx: number, ry: number, rotation: number, large: 0 | 1, sweep: 0 | 1, dx: number, dy: number): this {
    return this.A(rx, ry, rotation, large, sweep, this.x + dx, this.y + dy);
  }
  z(): this {
    return this.Z();
  }
  both(_svg: string, scene: (pen: Pen) => void): this {
    scene(this);
    return this;
  }
}
const merges = new WeakMap<Look, WeakMap<Look, Look>>();

// `own` over `base`. Looks are never changed once made, so a merge is kept for the next drawing.
function merge(base: Look, own: Look): Look {
  if (own === NO_LOOK || own === base) return base;
  let made = merges.get(base);
  if (!made) {
    made = new WeakMap();
    merges.set(base, made);
  }
  let look = made.get(own);
  if (!look) {
    look = { ...base, ...own };
    made.set(own, look);
  }
  return look;
}

// What a look paints with, read from its attribute text once: looks are shared and never change.
interface Ink {
  fill: string | null;
  fillOpacity: number;
  stroke: string | null;
  strokeOpacity: number;
  width: number;
  dash: number[] | null;
}
const inks = new WeakMap<Look, Ink>();

function inkOf(look: Look): Ink {
  let ink = inks.get(look);
  if (ink) return ink;
  const opacity = len(look.opacity, 1);
  const fill = look.fill;
  const stroke = look.stroke;
  const width = len(look['stroke-width'], 1);
  const dashed = look['stroke-dasharray'] && look['stroke-dasharray'] !== 'none' ? numbers(look['stroke-dasharray']) : null;
  ink = {
    fill: fill && fill !== 'none' && fill !== 'transparent' ? fill : null,
    fillOpacity: opacity * len(look['fill-opacity'], 1),
    stroke: stroke && stroke !== 'none' && stroke !== 'transparent' && width > 0 ? stroke : null,
    strokeOpacity: opacity * len(look['stroke-opacity'], 1),
    width,
    dash: dashed?.length ? dashed : null,
  };
  inks.set(look, ink);
  return ink;
}

const roots = new Map<number, Look>();

// What a scene of the given font size inherits at its root.
export function sceneRoot(size: number): Look {
  let look = roots.get(size);
  if (!look) {
    look = { fill: 'var(--_fg)', 'font-size': String(size) };
    roots.set(size, look);
  }
  return look;
}

// ---------------------------------------------------------------- geometry

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
const numbers = (s: string): number[] => (s.match(NUM) ?? []).map(Number);
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function arcNumbers(s: string): number[] {
  const out: number[] = [];
  const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    const k = i % 7;
    // Arc flags are single digits and may be packed: "011" is three numbers.
    if ((k === 3 || k === 4) && /^[01]{2,}/.test(m[0])) {
      re.lastIndex = m.index + 1;
      out.push(Number(m[0][0]));
    } else out.push(Number(m[0]));
    i++;
  }
  return out;
}

// Path tokens as routePath keeps them (command code, argument count, arguments; absolute M, L, C,
// Q) -> commands, with no text in between.
export function tokensToCmds(tokens: number[]): Path {
  const out: Path = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i];
    const n = tokens[i + 1];
    out.push(code === 77 ? M : code === 76 ? L : code === 67 ? C : Q);
    for (let k = 0; k < n; k++) out.push(tokens[i + 2 + k]);
    i += 2 + n;
  }
  return out;
}

// Path data -> absolute commands.
export function parsePathData(d: string): Path {
  const out: Path = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cx: number | null = null;
  let cy = 0;
  let qx: number | null = null;
  let qy = 0;
  for (const [, cmd, rest] of d.matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const lc = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const v = lc === 'a' ? arcNumbers(rest) : numbers(rest);
    const n = ARGS[lc];
    let first = true;
    do {
      const a = v.splice(0, n);
      if (a.length < n) break;
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      const kind = lc === 'm' && !first ? 'l' : lc;
      switch (kind) {
        case 'm': x = a[0] + ox; y = a[1] + oy; sx = x; sy = y; out.push(M, x, y); cx = qx = null; break;
        case 'l': x = a[0] + ox; y = a[1] + oy; out.push(L, x, y); cx = qx = null; break;
        case 'h': x = a[0] + ox; out.push(L, x, y); cx = qx = null; break;
        case 'v': y = a[0] + oy; out.push(L, x, y); cx = qx = null; break;
        case 'c': {
          const x2 = a[2] + ox;
          const y2 = a[3] + oy;
          out.push(C, a[0] + ox, a[1] + oy, x2, y2, a[4] + ox, a[5] + oy);
          cx = x2; cy = y2; x = a[4] + ox; y = a[5] + oy; qx = null; break;
        }
        case 's': {
          const x1 = cx === null ? x : 2 * x - cx;
          const y1 = cx === null ? y : 2 * y - cy;
          const x2 = a[0] + ox;
          const y2 = a[1] + oy;
          out.push(C, x1, y1, x2, y2, a[2] + ox, a[3] + oy);
          cx = x2; cy = y2; x = a[2] + ox; y = a[3] + oy; qx = null; break;
        }
        case 'q': {
          const x1 = a[0] + ox;
          const y1 = a[1] + oy;
          out.push(Q, x1, y1, a[2] + ox, a[3] + oy);
          qx = x1; qy = y1; x = a[2] + ox; y = a[3] + oy; cx = null; break;
        }
        case 't': {
          const x1: number = qx === null ? x : 2 * x - qx;
          const y1: number = qx === null ? y : 2 * y - qy;
          out.push(Q, x1, y1, a[0] + ox, a[1] + oy);
          qx = x1; qy = y1; x = a[0] + ox; y = a[1] + oy; cx = null; break;
        }
        case 'a':
          x = a[5] + ox;
          y = a[6] + oy;
          out.push(A, Math.abs(a[0]), Math.abs(a[1]), a[2], a[3] ? 1 : 0, a[4] ? 1 : 0, x, y);
          cx = qx = null;
          break;
        case 'z': x = sx; y = sy; out.push(Z); cx = qx = null; break;
      }
      first = false;
    } while (n > 0 && v.length);
  }
  return out;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number): Path => [
  M, cx - rx, cy, A, rx, ry, 0, 0, 1, cx + rx, cy, A, rx, ry, 0, 0, 1, cx - rx, cy, Z,
];

function roundRect(x: number, y: number, w: number, h: number, rx: number, ry: number): Path {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!(rx > 0 && ry > 0)) return [M, x, y, L, x + w, y, L, x + w, y + h, L, x, y + h, Z];
  return [
    M, x + rx, y, L, x + w - rx, y, A, rx, ry, 0, 0, 1, x + w, y + ry,
    L, x + w, y + h - ry, A, rx, ry, 0, 0, 1, x + w - rx, y + h,
    L, x + rx, y + h, A, rx, ry, 0, 0, 1, x, y + h - ry,
    L, x, y + ry, A, rx, ry, 0, 0, 1, x + rx, y, Z,
  ];
}

function points(list: number[], close: boolean): Path {
  if (list.length < 4) return [];
  const cmds: Path = [M, list[0], list[1]];
  for (let i = 2; i + 1 < list.length; i += 2) cmds.push(L, list[i], list[i + 1]);
  if (close) cmds.push(Z);
  return cmds;
}

// A copy of the path moved by (dx, dy), or the path itself when there is nothing to move: callers
// must not write to the result, which can be a cached fragment. All arguments are x, y pairs but
// an arc's radii, rotation and flags.
export function shift(cmds: Path, dx: number, dy: number): Path {
  if (dx === 0 && dy === 0) return cmds;
  const o = cmds.slice();
  for (let i = 0; i < o.length; ) {
    const op = o[i];
    if (op === A) {
      o[i + 6] += dx;
      o[i + 7] += dy;
      i += 8;
    } else {
      const end = i + 1 + ARGC[op];
      for (let k = i + 1; k < end; k += 2) {
        o[k] += dx;
        o[k + 1] += dy;
      }
      i = end;
    }
  }
  return o;
}

function cmdsBox(cmds: Path): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i];
    const end = i + 1 + ARGC[op];
    for (let k = op === A ? i + 6 : i + 1; k + 1 < end; k += 2) {
      const x = cmds[k];
      const y = cmds[k + 1];
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x > b.x1) b.x1 = x;
      if (y > b.y1) b.y1 = y;
    }
    i = end;
  }
  return b;
}

// ---------------------------------------------------------------- fragments

// What a fragment draws, in the fragment's own coordinates, to be replayed into the group it is
// drawn in: a group opens (an item when it has an id) and closes, a shape, a run of text.
type Op =
  | { op: 'begin'; id: string | undefined; kind: string; dx: number; dy: number; look: Look; source: SourceInfo | undefined }
  | { op: 'end' }
  | { op: 'shape'; cmds: Path; look: Look }
  | { op: 'text'; x: number; y: number; anchor: string | undefined; spans: SceneSpan[]; look: Look }
  | { op: 'skip'; what: string };

const RE_TAG = /<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
const RE_TRANSLATE = /^\s*translate\(\s*([-\d.e+]+)(?:[\s,]+([-\d.e+]+))?\s*\)\s*$/;
const fragmentCache = new Map<string, Op[]>();

// An element's own presentation attributes; declarations in style win, as in CSS.
function lookOf(a: Record<string, string>): Look {
  const look: Look = {};
  for (const key in a) if (KEYS.has(key)) (look as Record<string, string>)[key] = a[key];
  if (a.style) {
    for (const decl of a.style.split(';')) {
      const i = decl.indexOf(':');
      if (i <= 0) continue;
      const key = decl.slice(0, i).trim();
      if (KEYS.has(key)) (look as Record<string, string>)[key] = decl.slice(i + 1).trim().replace(/\s*!important$/, '');
    }
  }
  return look;
}

interface Element {
  tag: string;
  a: Record<string, string>;
  children: (Element | string)[];
}

function elements(svg: string): Element[] {
  const root: Element = { tag: '', a: {}, children: [] };
  const stack = [root];
  for (const m of svg.matchAll(RE_TAG)) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      if (stack.length > 1) stack.pop();
    } else if (m[2]) {
      const a: Record<string, string> = {};
      for (const p of m[3].matchAll(RE_ATTR)) a[p[1]] = p[2];
      const el: Element = { tag: m[2], a, children: [] };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5] !== undefined) top.children.push(m[5]);
  }
  return root.children.filter((c): c is Element => typeof c !== 'string');
}

const XML: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
// Text and attribute values as the SVG means them.
const unescape = (s: string): string =>
  s.includes('&')
    ? s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) =>
        e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML[e] ?? all)
      )
    : s;

// Where an element comes from, read from the `data-` attributes sourceAttrs writes.
function sourceOf(a: Record<string, string>): SourceInfo | undefined {
  const info: SourceInfo = {};
  if (a['data-line'] !== undefined) info.line = Number(a['data-line']);
  if (a['data-end'] !== undefined) info.end = Number(a['data-end']);
  if (a['data-symbol'] !== undefined) info.symbol = unescape(a['data-symbol']);
  if (a['data-from'] !== undefined) info.from = unescape(a['data-from']);
  if (a['data-to'] !== undefined) info.to = unescape(a['data-to']);
  return Object.keys(info).length > 0 ? info : undefined;
}

// A tspan's own attributes, as the reader of its SVG would see them.
const runCache = new Map<string, Record<string, string>>();
function runAttrs(attrs: string): Record<string, string> {
  let a = runCache.get(attrs);
  if (!a) {
    a = {};
    for (const m of attrs.matchAll(RE_ATTR)) a[m[1]] = m[2];
    if (runCache.size > 500) runCache.clear();
    runCache.set(attrs, a);
  }
  return a;
}

const textOf = (el: Element): string => el.children.filter((c): c is string => typeof c === 'string').map(unescape).join('');

function spanOf(text: string, a: Record<string, string>): SceneSpan {
  const span: SceneSpan = { text };
  if (a['font-weight'] !== undefined && weight(a['font-weight'], 400) >= 600) span.weight = 700;
  if (a['font-style'] === 'italic') span.italic = true;
  if (a['font-family'] === 'var(--_fm)') span.mono = true;
  return span;
}

// A <text>: a new run starts at each tspan that sets its own position.
function textOps(el: Element, look: Look, dx: number, dy: number, ops: Op[]): void {
  let x = len(el.a.x, 0) + dx;
  let y = len(el.a.y, 0) + dy;
  let anchor: string | undefined = undefined;
  let spans: SceneSpan[] = [];
  const flush = () => {
    if (spans.length) ops.push({ op: 'text', x, y, anchor, spans, look });
    spans = [];
  };
  for (const c of el.children) {
    if (typeof c === 'string') {
      if (c) spans.push({ text: unescape(c) });
      continue;
    }
    if (c.tag !== 'tspan') continue;
    if (c.a.x !== undefined || c.a.y !== undefined) {
      flush();
      if (c.a.x !== undefined) x = len(c.a.x, 0) + dx;
      if (c.a.y !== undefined) y = len(c.a.y, 0) + dy;
      anchor = c.a['text-anchor'];
    }
    spans.push(spanOf(textOf(c), c.a));
  }
  flush();
}

function fragmentOps(list: (Element | string)[], ops: Op[]): void {
  for (const el of list) {
    if (typeof el === 'string') continue;
    const a = el.a;
    let dx = 0;
    let dy = 0;
    if (a.transform !== undefined) {
      const t = RE_TRANSLATE.exec(a.transform);
      if (!t) {
        ops.push({ op: 'skip', what: 'transform' });
        continue;
      }
      dx = Number(t[1]);
      dy = Number(t[2] ?? 0);
    }
    const look = lookOf(a);
    const id = a['data-id'] === undefined ? undefined : unescape(a['data-id']);
    const group = el.tag === 'g' || el.tag === 'a';
    // A group, or an element that is an item or moved: what is in it is drawn in its frame.
    const framed = group || id !== undefined || dx !== 0 || dy !== 0;
    if (framed) ops.push({ op: 'begin', id, kind: a.class ?? el.tag, dx, dy, look: group ? look : {}, source: id === undefined ? undefined : sourceOf(a) });
    let cmds: Path | null = null;
    let own = look;
    switch (el.tag) {
      case 'g':
      case 'a':
        fragmentOps(el.children, ops);
        break;
      case 'rect': {
        const w = len(a.width, 0);
        const h = len(a.height, 0);
        if (w > 0 && h > 0) cmds = roundRect(len(a.x, 0), len(a.y, 0), w, h, len(look.rx ?? a.ry, 0), len(a.ry ?? look.rx, 0));
        break;
      }
      case 'circle': {
        const r = len(a.r, 0);
        if (r > 0) cmds = ellipse(len(a.cx, 0), len(a.cy, 0), r, r);
        break;
      }
      case 'ellipse': {
        const rx = len(a.rx, 0);
        const ry = len(a.ry, 0);
        if (rx > 0 && ry > 0) cmds = ellipse(len(a.cx, 0), len(a.cy, 0), rx, ry);
        break;
      }
      case 'line':
        cmds = [M, len(a.x1, 0), len(a.y1, 0), L, len(a.x2, 0), len(a.y2, 0)];
        own = { ...look, fill: 'none' };
        break;
      case 'polygon':
      case 'polyline':
        cmds = points(numbers(a.points ?? ''), el.tag === 'polygon');
        if (el.tag === 'polyline' && a.fill === undefined) own = { ...look, fill: 'none' };
        break;
      case 'path':
        if (a.d) cmds = parsePathData(a.d);
        break;
      case 'text':
        textOps(el, look, 0, 0, ops);
        break;
      case 'title':
      case 'desc':
        break;
      case 'svg':
      case 'foreignObject':
        ops.push({ op: 'skip', what: /\bpele-math\b/.test(a.class ?? '') ? 'math' : /\bpele-icon\b/.test(a.class ?? '') ? 'icon' : el.tag });
        break;
      default:
        ops.push({ op: 'skip', what: el.tag });
    }
    if (cmds) ops.push({ op: 'shape', cmds, look: own });
    if (framed) ops.push({ op: 'end' });
  }
}

// Reads a fragment the way the SVG it is part of would be read.
function parseFragment(svg: string): Op[] {
  let ops = fragmentCache.get(svg);
  if (ops) return ops;
  ops = [];
  fragmentOps(elements(svg), ops);
  // A whole drawing is read once: only small pieces come again.
  if (svg.length > 2000) return ops;
  if (fragmentCache.size > 4000) fragmentCache.clear();
  fragmentCache.set(svg, ops);
  return ops;
}

// ---------------------------------------------------------------- sink

interface Section {
  // Read from `attrs` over the outer section's look when first drawn in: many sections stay empty.
  look: Look | null;
  attrs: string;
  outer: Section | undefined;
  // Inside the frame, and the frame's move when the section was made.
  framed: boolean;
  dx: number;
  dy: number;
  // What it holds, made when the first is added: many sections stay empty.
  shapes: SceneShape[] | null;
  texts: SceneText[] | null;
  items: number[] | null;
  // The frames of the section with no group open, kept for each switch back to it; empty until
  // the section is first drawn in.
  base: Frame[];
}

interface Frame {
  item: number;
  dx: number;
  dy: number;
  look: Look;
  // Inside a group the scene cannot show (one turned or scaled): nothing in it is drawn.
  hidden?: boolean;
}

export class SceneOut implements Out {
  // The finished scene, once done() has been called.
  scene: Scene | null = null;
  private sections = new Map<string, Section>();
  private current!: Section;
  private currentName = '';
  private frames: Frame[] = [];
  // The move of sections made from the first call of frame() on.
  private framing: { x: number; y: number } | null = null;
  readonly sources = true;
  readonly numbers = true;
  private items: SceneItem[] = [];
  private skipped: Record<string, number> = {};

  constructor(private readonly rootLook: Look = sceneRoot(16)) {
    this.section('main');
  }

  // Switches to a named layer of the picture, creating it with the given inherited attributes.
  section(name: string, attrs = '', _always = false, within?: string): void {
    // Already there, with no group open: nothing to switch.
    if (this.frames.length <= 1 && this.currentName === name) return;
    this.currentName = name;
    let s = this.sections.get(name);
    if (!s) {
      const outer = within === undefined ? undefined : this.sections.get(within);
      const f = this.framing;
      s = { look: null, attrs, outer, framed: f !== null, dx: f ? f.x : 0, dy: f ? f.y : 0, shapes: null, texts: null, items: null, base: [] };
      this.sections.set(name, s);
    }
    this.current = s;
    this.frames = s.base;
  }

  // Runs `draw` in another section and comes back.
  into(name: string, attrs: string, draw: () => void): void {
    const back = this.current;
    const backName = this.currentName;
    const frames = this.frames;
    this.section(name, attrs);
    draw();
    this.current = back;
    this.currentName = backName;
    this.frames = frames;
  }

  private get top(): Frame {
    const frames = this.frames;
    if (frames.length === 0) {
      const s = this.current;
      frames.push({ item: -1, dx: s.dx, dy: s.dy, look: this.lookOf(s) });
    }
    return frames[frames.length - 1];
  }

  private lookOf(s: Section): Look {
    if (s.look === null) {
      const outer = s.outer ? this.lookOf(s.outer) : this.rootLook;
      s.look = s.attrs ? merge(outer, parseLook(s.attrs)) : outer;
    }
    return s.look;
  }

  // Opens a group: an item when `id` is given, moved by (dx, dy), with inherited attributes, and
  // where it comes from in the text, read as `data-` attributes would be (see sourceAttrs).
  private open(id: string | undefined, kind: string, dx: number, dy: number, own: Look | null, source?: SourceInfo): void {
    const f = this.top;
    if (f.hidden) {
      this.frames.push(f);
      return;
    }
    let item = f.item;
    if (id !== undefined) {
      const it: SceneItem = { id, kind, box: null };
      if (source !== undefined) {
        if (source.line !== undefined) it.line = source.line;
        if (source.end !== undefined) it.end = source.end;
        if (source.symbol !== undefined) it.symbol = decodeEntities(source.symbol);
        if (source.from !== undefined) it.from = decodeEntities(source.from);
        if (source.to !== undefined) it.to = decodeEntities(source.to);
      }
      this.items.push(it);
      item = this.items.length - 1;
      (this.current.items ??= []).push(item);
    }
    this.frames.push({ item, dx: f.dx + dx, dy: f.dy + dy, look: own ? merge(f.look, own) : f.look });
  }

  end(): void {
    if (this.frames.length > 1) this.frames.pop();
  }

  skip(what: string): void {
    this.skipped[what] = (this.skipped[what] ?? 0) + 1;
  }

  private touch(box: Box): void {
    const i = this.top.item;
    if (i < 0) return;
    const it = this.items[i];
    if (!it.box) it.box = { ...box };
    else {
      if (box.x0 < it.box.x0) it.box.x0 = box.x0;
      if (box.y0 < it.box.y0) it.box.y0 = box.y0;
      if (box.x1 > it.box.x1) it.box.x1 = box.x1;
      if (box.y1 > it.box.y1) it.box.y1 = box.y1;
    }
  }

  // Adds geometry in the current group's coordinates, painted by `look` over the inherited one.
  shape(cmds: Path, own: Look = NO_LOOK): void {
    const f = this.top;
    if (!cmds.length || f.hidden) return;
    const ink = inkOf(merge(f.look, own));
    const placed = shift(cmds, f.dx, f.dy);
    const box = cmdsBox(placed);
    if (ink.fill !== null) {
      (this.current.shapes ??= []).push({ kind: 'fill', paint: ink.fill, opacity: ink.fillOpacity, cmds: placed, box, item: f.item });
    }
    if (ink.stroke !== null) {
      const p = ink.width / 2;
      (this.current.shapes ??= []).push({
        kind: 'stroke', paint: ink.stroke, opacity: ink.strokeOpacity, width: ink.width, dash: ink.dash === null ? null : ink.dash.slice(),
        cmds: placed, box: { x0: box.x0 - p, y0: box.y0 - p, x1: box.x1 + p, y1: box.y1 + p }, item: f.item,
      });
    }
    this.touch(box);
  }

  // A shape, in an item of its own when it is a part, as a reader of its SVG would see it.
  private part(cmds: Path, look: Look, item: Item | undefined, tag: string): void {
    if (item === undefined || item.id === undefined) return this.shape(cmds, look);
    this.open(item.id, item.cls ?? tag, 0, 0, null, item.source);
    this.shape(cmds, look);
    this.end();
  }

  rect(x: number | null, y: number | null, w: number, h: number, attrs: Attrs = '', item?: Item): void {
    const look = lookAt(attrs);
    const rx = len(look.rx, 0);
    if (w > 0 && h > 0) this.part(roundRect(x ?? 0, y ?? 0, w, h, rx, rx), look, item, 'rect');
    else if (item?.id !== undefined) this.part([], look, item, 'rect');
  }

  circle(cx: number | null, cy: number | null, r: number, attrs: Attrs, item?: Item): void {
    this.part(r > 0 ? ellipse(cx ?? 0, cy ?? 0, r, r) : [], lookAt(attrs), item, 'circle');
  }

  spans(x: number, y: number, runs: Run[], attrs: Attrs, after = ''): void {
    const look = merge(this.top.look, after ? parseLook((typeof attrs === 'string' ? attrs : attrs.attrs) + after) : lookAt(attrs));
    const list: SceneSpan[] = [];
    for (const r of runs) {
      if (r.attrs === undefined) {
        if (r.text) list.push({ text: r.text });
      } else list.push(spanOf(r.text, runAttrs(r.attrs)));
    }
    this.put(x, y, list, textBase(look, len(look['font-size'], 16)), (look['text-anchor'] ?? 'start') as 'start' | 'middle' | 'end');
  }

  opaque(_svg: string, what: string): void {
    this.skip(what);
  }

  both(_svg: () => string, scene: () => void): void {
    scene();
  }

  ellipse(cx: number | null, cy: number | null, rx: number, ry: number, attrs: Attrs, item?: Item): void {
    this.part(rx > 0 && ry > 0 ? ellipse(cx ?? 0, cy ?? 0, rx, ry) : [], lookAt(attrs), item, 'ellipse');
  }

  line(x1: number, y1: number, x2: number, y2: number, attrs: Attrs, item?: Item): void {
    // A line has no inside, whatever fill it inherits.
    this.part([M, x1, y1, L, x2, y2], merge(lookAt(attrs), NO_FILL), item, 'line');
  }

  polygon(list: number[], attrs: Attrs, item?: Item): void {
    this.part(points(list, true), lookAt(attrs), item, 'polygon');
  }

  at(x: number, y: number, draw: (x: number, y: number) => string): void {
    const svg = draw(0, 0);
    if (!svg) return;
    this.open(undefined, '', x, y, null);
    this.fragment(svg);
    this.end();
  }

  pen(): Pen {
    return new ScenePen();
  }

  // A small SVG fragment: a shape's outline, an arrowhead.
  fragment(svg: string): void {
    if (!svg) return;
    for (const op of parseFragment(svg)) {
      switch (op.op) {
        case 'begin':
          this.open(op.id, op.kind, op.dx, op.dy, op.look, op.source);
          break;
        case 'end':
          this.end();
          break;
        case 'shape':
          this.shape(op.cmds, op.look);
          break;
        case 'text': {
          const look = merge(this.top.look, op.look);
          const anchor = op.anchor ?? look['text-anchor'] ?? 'start';
          this.put(op.x, op.y, op.spans, textBase(look, len(look['font-size'], 16)), anchor as 'start' | 'middle' | 'end');
          break;
        }
        case 'skip':
          this.skip(op.what);
      }
    }
  }

  // A measured label centered on (cx, cy), placed as labelSvg places it.
  label(label: Label, cx: number, cy: number, attrs: Attrs = ''): void {
    const lines = label.lines;
    if (lines.length === 0) return;
    const f = this.top;
    const look = merge(f.look, lookAt(attrs));
    const base = {
      size: label.size,
      weight: weight(look['font-weight'], 400),
      italic: look['font-style'] === 'italic',
      paint: look.fill && look.fill !== 'none' ? look.fill : 'var(--_fg)',
    };
    const lh = label.lineHeight;
    const shiftY = label.size * 0.35;
    let top = cy - label.height / 2;
    const span = (s: { text: string; style: number }): SceneSpan => {
      const out: SceneSpan = { text: s.text };
      if (s.style & Style.Bold) out.weight = 700;
      if (s.style & Style.Italic) out.italic = true;
      if (s.style & Style.Mono) out.mono = true;
      return out;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h = label.heights ? label.heights[i] : lh;
      const y = top + h / 2 + shiftY;
      const placed = line.some((s) => s.icon !== undefined || s.math);
      if (placed) {
        let x = cx - label.widths[i] / 2;
        for (const s of line) {
          if (s.math) this.skip('math');
          else if (s.icon !== undefined) this.skip('icon');
          else if (s.text !== '') this.put(x, y, [span(s)], base, 'start');
          x += s.width;
        }
      } else if (line.length) {
        this.put(cx, y, line.map(span), base, 'middle');
      }
      top += h;
    }
  }

  private put(x: number, y: number, spans: SceneSpan[], base: { size: number; weight: number; italic: boolean; paint: string }, anchor: 'start' | 'middle' | 'end'): void {
    const f = this.top;
    if (f.hidden || !spans.some((s) => s.text.trim())) return;
    const t: SceneText = { x: x + f.dx, y: y + f.dy, size: base.size, weight: base.weight, italic: base.italic, anchor, paint: base.paint, spans, item: f.item };
    (this.current.texts ??= []).push(t);
    const w = spans.reduce((n, s) => n + s.text.length, 0) * base.size * 0.55;
    const x0 = anchor === 'middle' ? t.x - w / 2 : anchor === 'end' ? t.x - w : t.x;
    this.touch({ x0, y0: t.y - base.size, x1: x0 + w, y1: t.y + base.size * 0.25 });
  }

  // The scene, with sections painted in the order they were made.
  private finish(width: number, height: number): Scene {
    const names = this.sections.keys();
    const shapes: SceneShape[] = [];
    const texts: SceneText[] = [];
    // Items in the order the SVG writes them, section by section, as a host reading it would
    // number them (where two overlap, the later one is on top).
    const items: SceneItem[] = [];
    const at = new Array<number>(this.items.length);
    const f = this.framing;
    for (const n of names) {
      const s = this.sections.get(n)!;
      if (!s.shapes && !s.texts && !s.items) continue;
      // A frame moved after the section was drawn moves what it holds.
      if (s.framed && f && (f.x !== s.dx || f.y !== s.dy)) this.move(s, f.x - s.dx, f.y - s.dy);
      if (s.shapes) for (const x of s.shapes) shapes.push(x);
      if (s.texts) for (const x of s.texts) texts.push(x);
      if (s.items) for (const i of s.items) at[i] = items.push(this.items[i]) - 1;
    }
    for (const x of shapes) if (x.item >= 0) x.item = at[x.item];
    for (const x of texts) if (x.item >= 0) x.item = at[x.item];
    return { version: SCENE_VERSION, x: 0, y: 0, w: width, h: height, baseline: null, shapes, texts, items, skipped: this.skipped };
  }

  private move(s: Section, dx: number, dy: number): void {
    const box = (b: Box): void => {
      b.x0 += dx;
      b.x1 += dx;
      b.y0 += dy;
      b.y1 += dy;
    };
    for (const x of s.shapes ?? []) {
      // shift copies: a shape's path can be shared with the fragment cache.
      x.cmds = shift(x.cmds, dx, dy);
      box(x.box);
    }
    for (const t of s.texts ?? []) {
      t.x += dx;
      t.y += dy;
    }
    for (const i of s.items ?? []) {
      const b = this.items[i].box;
      if (b) box(b);
    }
  }

  // ---------------------------------------------------------------- Out

  fork(): SceneOut {
    return new SceneOut(this.rootLook);
  }

  adopt(attempt: Out): void {
    this.scene = (attempt as SceneOut).scene;
  }

  group(g: Group): void {
    let dx = g.x ?? 0;
    let dy = g.y ?? 0;
    const attrs = g.before === undefined ? (g.attrs ?? '') : g.before + (g.attrs ?? '');
    if (attrs.includes('transform="')) {
      const t = RE_TRANSLATE.exec(/ transform="([^"]*)"/.exec(attrs)?.[1] ?? '');
      if (!t) {
        this.skip('transform');
        this.frames.push({ ...this.top, hidden: true });
        return;
      }
      dx += Number(t[1]);
      dy += Number(t[2] ?? 0);
    }
    this.open(g.id, g.cls ?? 'g', dx, dy, attrs ? parseLook(attrs) : null, g.source);
  }

  shift(x: number, y: number): void {
    this.open(undefined, '', x, y, null);
  }

  frame(x: number, y: number): void {
    if (this.framing) {
      this.framing.x = x;
      this.framing.y = y;
    } else this.framing = { x, y };
  }

  link(): void {
    this.open(undefined, '', 0, 0, null);
  }

  tooltip(): void {}

  text(x: number, y: number, text: string, attrs: Attrs, after = ''): void {
    const look = merge(this.top.look, after ? parseLook((typeof attrs === 'string' ? attrs : attrs.attrs) + after) : lookAt(attrs));
    this.put(x, y, [{ text }], textBase(look, len(look['font-size'], 16)), (look['text-anchor'] ?? 'start') as 'start' | 'middle' | 'end');
  }

  path(d: string | Pen, attrs: Attrs = '', tokens?: number[], item?: Item): void {
    this.part(typeof d !== 'string' ? (d as ScenePen).cmds : tokens ? tokensToCmds(tokens) : parsePathData(d), lookAt(attrs), item, 'path');
  }

  raw(): void {}

  done(_type: string, width: number, height: number): string {
    this.scene = this.finish(width, height);
    return '';
  }
}

function textBase(look: Look, size: number): { size: number; weight: number; italic: boolean; paint: string } {
  return {
    size,
    weight: weight(look['font-weight'], 400),
    italic: look['font-style'] === 'italic',
    paint: look.fill && look.fill !== 'none' ? look.fill : 'var(--_fg)',
  };
}
