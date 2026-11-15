// Scene output: a renderer-neutral vector scene written while a diagram is
// drawn, instead of SVG text that a host would have to parse again.
//
// A renderer that supports it checks `activeSink()`: when it is set, the
// renderer reports its structure (sections, items, translations) and the
// geometry it already holds as numbers. Labels go in straight from their
// measured layout. Shape outlines and markers are small SVG fragments that
// are parsed once per distinct fragment and cached, so no document-sized SVG
// is ever built or read.
//
// The data matches herdr-scene's scene contract, version 2: paint stays a
// token (`var(--_s)`) for the host's theme to resolve.

import { decodeEntities } from '../text/entities.js';
import type { Label } from '../text/label.js';
import { Style } from '../text/measurer.js';
import type { SourceInfo } from '../types.js';
import type { Group, Out } from './out.js';

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
export const ellipseCmds = ellipse;
export const circleCmds = (cx: number, cy: number, r: number): Path => ellipse(cx, cy, r, r);
export const polygonCmds = (list: number[]): Path => points(list, true);

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

// How many commands a path holds.
export function cmdCount(cmds: Path): number {
  let n = 0;
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) n++;
  return n;
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
  | { op: 'begin'; id: string | undefined; kind: string; dx: number; dy: number; look: Look }
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
    if (framed) ops.push({ op: 'begin', id, kind: a.class ?? el.tag, dx, dy, look: group ? look : {} });
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
  if (fragmentCache.size > 4000) fragmentCache.clear();
  fragmentCache.set(svg, ops);
  return ops;
}

// ---------------------------------------------------------------- sink

interface Section {
  look: Look;
  shapes: SceneShape[];
  texts: SceneText[];
  items: number[];
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
  private frames: Frame[] = [];
  private items: SceneItem[] = [];
  private skipped: Record<string, number> = {};
  // Geometry a helper handed over while its fragment was still being written; the fragment holds
  // a placeholder for it, so the parts of a shape are added in the order they are written.
  private deferred: (() => void)[] = [];

  constructor(private rootLook: Look = { fill: 'var(--_fg)', 'font-size': '16' }) {
    this.section('main');
  }

  // Starts over: a renderer that draws a diagram twice to compare keeps only the last attempt's
  // output, and takes each attempt's scene with finish().
  reset(rootLook?: Look): void {
    if (rootLook) this.rootLook = rootLook;
    this.sections.clear();
    this.items = [];
    this.skipped = {};
    this.deferred = [];
    this.section('main');
  }

  // Keeps `draw` for the fragment being written and returns its placeholder.
  defer(draw: () => void): string {
    this.deferred.push(draw);
    return `\u0000${this.deferred.length - 1}\u0000`;
  }

  // Switches to a named layer of the picture, creating it with the given inherited attributes.
  section(name: string, attrs = ''): void {
    let s = this.sections.get(name);
    if (!s) {
      s = { look: { ...this.rootLook, ...parseLook(attrs) }, shapes: [], texts: [], items: [] };
      this.sections.set(name, s);
    }
    this.current = s;
    this.frames = [{ item: -1, dx: 0, dy: 0, look: s.look }];
  }

  // Runs `draw` in another section and comes back.
  into(name: string, attrs: string, draw: () => void): void {
    const back = this.current;
    const frames = this.frames;
    this.section(name, attrs);
    draw();
    this.current = back;
    this.frames = frames;
  }

  private get frame(): Frame {
    return this.frames[this.frames.length - 1];
  }

  // Opens a group: an item when `id` is given, moved by (dx, dy), with inherited attributes, and
  // where it comes from in the text, read as `data-` attributes would be (see sourceAttrs).
  begin(id: string | undefined, kind: string, dx = 0, dy = 0, attrs = '', source?: SourceInfo): void {
    this.open(id, kind, dx, dy, attrs ? parseLook(attrs) : null, source);
  }

  private open(id: string | undefined, kind: string, dx: number, dy: number, own: Look | null, source?: SourceInfo): void {
    const f = this.frame;
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
      this.current.items.push(item);
    }
    this.frames.push({ item, dx: f.dx + dx, dy: f.dy + dy, look: own ? { ...f.look, ...own } : f.look });
  }

  end(): void {
    if (this.frames.length > 1) this.frames.pop();
  }

  skip(what: string): void {
    this.skipped[what] = (this.skipped[what] ?? 0) + 1;
  }

  private touch(box: Box): void {
    const i = this.frame.item;
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
  shape(cmds: Path, own: Look = {}): void {
    const f = this.frame;
    if (!cmds.length || f.hidden) return;
    const look = own === f.look ? own : { ...f.look, ...own };
    const placed = shift(cmds, f.dx, f.dy);
    const box = cmdsBox(placed);
    const opacity = len(look.opacity, 1);
    const fill = look.fill;
    if (fill && fill !== 'none' && fill !== 'transparent') {
      this.current.shapes.push({ kind: 'fill', paint: fill, opacity: opacity * len(look['fill-opacity'], 1), cmds: placed, box, item: f.item });
    }
    const stroke = look.stroke;
    const width = len(look['stroke-width'], 1);
    if (stroke && stroke !== 'none' && stroke !== 'transparent' && width > 0) {
      const dash = look['stroke-dasharray'] && look['stroke-dasharray'] !== 'none' ? numbers(look['stroke-dasharray']) : null;
      const p = width / 2;
      this.current.shapes.push({
        kind: 'stroke', paint: stroke, opacity: opacity * len(look['stroke-opacity'], 1), width, dash: dash?.length ? dash : null,
        cmds: placed, box: { x0: box.x0 - p, y0: box.y0 - p, x1: box.x1 + p, y1: box.y1 + p }, item: f.item,
      });
    }
    this.touch(box);
  }

  rect(x: number, y: number, w: number, h: number, attrs = ''): void {
    const look = parseLook(attrs);
    const rx = len(look.rx, 0);
    this.shape(roundRect(x, y, w, h, rx, rx), look);
  }

  // A small SVG fragment: a shape's outline, an arrowhead.
  fragment(svg: string): void {
    if (!svg) return;
    if (svg.includes('\u0000')) {
      // Placeholders sit between whole elements: written text, then held geometry, in turn.
      const parts = svg.split('\u0000');
      for (let i = 0; i < parts.length; i++) {
        if (i % 2) this.deferred[Number(parts[i])]?.();
        else if (parts[i]) this.fragment(parts[i]);
      }
      return;
    }
    for (const op of parseFragment(svg)) {
      switch (op.op) {
        case 'begin': {
          // A renderer that opened the item itself hands over the group it writes for it.
          const f = this.frame;
          const same = op.id !== undefined && f.item >= 0 && this.items[f.item].id === op.id && this.items[f.item].kind === op.kind;
          this.open(same ? undefined : op.id, op.kind, op.dx, op.dy, op.look);
          break;
        }
        case 'end':
          this.end();
          break;
        case 'shape':
          this.shape(op.cmds, op.look);
          break;
        case 'text': {
          const look = { ...this.frame.look, ...op.look };
          const anchor = op.anchor ?? look['text-anchor'] ?? 'start';
          this.text(op.x, op.y, op.spans, textBase(look, len(look['font-size'], 16)), anchor as 'start' | 'middle' | 'end');
          break;
        }
        case 'skip':
          this.skip(op.what);
      }
    }
  }

  // A measured label centered on (cx, cy), placed as labelSvg places it.
  label(label: Label, cx: number, cy: number, attrs = ''): void {
    const lines = label.lines;
    if (lines.length === 0) return;
    const f = this.frame;
    const look = { ...f.look, ...parseLook(attrs) };
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
          else if (s.text !== '') this.text(x, y, [span(s)], base, 'start');
          x += s.width;
        }
      } else if (line.length) {
        this.text(cx, y, line.map(span), base, 'middle');
      }
      top += h;
    }
  }

  private text(x: number, y: number, spans: SceneSpan[], base: { size: number; weight: number; italic: boolean; paint: string }, anchor: 'start' | 'middle' | 'end'): void {
    const f = this.frame;
    if (f.hidden || !spans.some((s) => s.text.trim())) return;
    const t: SceneText = { x: x + f.dx, y: y + f.dy, size: base.size, weight: base.weight, italic: base.italic, anchor, paint: base.paint, spans, item: f.item };
    this.current.texts.push(t);
    const w = spans.reduce((n, s) => n + s.text.length, 0) * base.size * 0.55;
    const x0 = anchor === 'middle' ? t.x - w / 2 : anchor === 'end' ? t.x - w : t.x;
    this.touch({ x0, y0: t.y - base.size, x1: x0 + w, y1: t.y + base.size * 0.25 });
  }

  // The scene, with sections painted in `order` (others after, in creation order).
  finish(order: string[], width: number, height: number): Scene {
    const names = [...order.filter((n) => this.sections.has(n)), ...[...this.sections.keys()].filter((n) => !order.includes(n))];
    const shapes: SceneShape[] = [];
    const texts: SceneText[] = [];
    // Items in the order the SVG writes them, section by section, as a host reading it would
    // number them (where two overlap, the later one is on top).
    const items: SceneItem[] = [];
    const at = new Array<number>(this.items.length);
    for (const n of names) {
      const s = this.sections.get(n)!;
      shapes.push(...s.shapes);
      texts.push(...s.texts);
      for (const i of s.items) at[i] = items.push(this.items[i]) - 1;
    }
    for (const x of shapes) if (x.item >= 0) x.item = at[x.item];
    for (const x of texts) if (x.item >= 0) x.item = at[x.item];
    return { version: SCENE_VERSION, x: 0, y: 0, w: width, h: height, baseline: null, shapes, texts, items, skipped: this.skipped };
  }

  // One unwrapped line of text at (x, y) with the given anchor, as a <text> element without
  // tspans: a member of a class, a cardinality.
  textAt(x: number, y: number, text: string, attrs: string, anchor: 'start' | 'middle' | 'end'): void {
    const look = { ...this.frame.look, ...parseLook(attrs) };
    const base = {
      size: len(look['font-size'], 16),
      weight: weight(look['font-weight'], 400),
      italic: look['font-style'] === 'italic',
      paint: look.fill && look.fill !== 'none' ? look.fill : 'var(--_fg)',
    };
    this.text(x, y, [{ text }], base, anchor);
  }

  // One line of a label as start-anchored text at (x, y), the baseline, for a renderer that sets
  // its own columns (a table cell) instead of centering the label.
  startText(line: Label['lines'][number], size: number, x: number, y: number, attrs = ''): void {
    const look = { ...this.frame.look, ...parseLook(attrs) };
    const base = {
      size,
      weight: weight(look['font-weight'], 400),
      italic: look['font-style'] === 'italic',
      paint: look.fill && look.fill !== 'none' ? look.fill : 'var(--_fg)',
    };
    const spans = line.map((s) => {
      const out: SceneSpan = { text: s.text };
      if (s.style & Style.Bold) out.weight = 700;
      if (s.style & Style.Italic) out.italic = true;
      if (s.style & Style.Mono) out.mono = true;
      return out;
    });
    this.text(x, y, spans, base, 'start');
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
    const attrs = g.attrs ?? '';
    if (attrs.includes('transform="')) {
      const t = RE_TRANSLATE.exec(/ transform="([^"]*)"/.exec(attrs)?.[1] ?? '');
      if (!t) {
        this.skip('transform');
        this.frames.push({ ...this.frame, hidden: true });
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

  link(): void {
    this.open(undefined, '', 0, 0, null);
  }

  tooltip(): void {}

  path(d: string, attrs = '', tokens?: number[]): void {
    this.shape(tokens ? tokensToCmds(tokens) : parsePathData(d), parseLook(attrs));
  }

  raw(): void {}

  done(_type: string, width: number, height: number, _fontSize: number, _options: unknown, _acc: unknown, order: string[]): string {
    this.scene = this.finish(order, width, height);
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

let active: SceneOut | null = null;

// The sink of the scene being drawn, or null while drawing SVG.
export function activeSink(): SceneOut | null {
  return active;
}

export function withSink<T>(sink: SceneOut, draw: () => T): T {
  const before = active;
  active = sink;
  try {
    return draw();
  } finally {
    active = before;
  }
}
