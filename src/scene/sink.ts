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

// One element of a small SVG fragment, in the fragment's own coordinates.
interface Piece {
  cmds: Path;
  look: Look;
}

interface Fragment {
  pieces: Piece[];
  skipped: string[];
}

const RE_TAG = /<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|[^<]+/g;
const fragmentCache = new Map<string, Fragment>();

// Parses a shape or marker fragment: rect, circle, ellipse, path, polygon, polyline, line, and
// <g> with a translate() and presentation attributes. Text and nested images are reported as
// skipped: labels never come this way.
function parseFragment(svg: string): Fragment {
  let frag = fragmentCache.get(svg);
  if (frag) return frag;
  frag = { pieces: [], skipped: [] };
  const groups: { look: Look; dx: number; dy: number }[] = [{ look: {}, dx: 0, dy: 0 }];
  let depthSkip = 0;
  for (const m of svg.matchAll(RE_TAG)) {
    if (m[1]) {
      if (depthSkip > 0) depthSkip--;
      else if (m[1] === 'g' && groups.length > 1) groups.pop();
      continue;
    }
    const tag = m[2];
    if (!tag) continue;
    if (depthSkip > 0) {
      if (!m[4]) depthSkip++;
      continue;
    }
    const attrs = m[3];
    const a: Record<string, string> = {};
    for (const p of attrs.matchAll(RE_ATTR)) a[p[1]] = p[2];
    const parent = groups[groups.length - 1];
    const look = { ...parent.look, ...parseLook(attrs) };
    const dx = parent.dx;
    const dy = parent.dy;
    let cmds: Path | null = null;
    switch (tag) {
      case 'g': {
        let gx = dx;
        let gy = dy;
        const t = a.transform?.match(/^\s*translate\(\s*([-\d.e+]+)(?:[\s,]+([-\d.e+]+))?\s*\)\s*$/);
        if (t) {
          gx += Number(t[1]);
          gy += Number(t[2] ?? 0);
        } else if (a.transform) frag.skipped.push('transform');
        if (!m[4]) groups.push({ look, dx: gx, dy: gy });
        continue;
      }
      case 'rect': {
        const w = len(a.width, 0);
        const h = len(a.height, 0);
        const rx = len(look.rx ?? a.ry, 0);
        const ry = len(a.ry ?? look.rx, 0);
        if (w > 0 && h > 0) cmds = roundRect(len(a.x, 0), len(a.y, 0), w, h, rx, ry);
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
        look.fill = 'none';
        break;
      case 'polygon':
      case 'polyline':
        cmds = points(numbers(a.points ?? ''), tag === 'polygon');
        if (tag === 'polyline' && a.fill === undefined) look.fill = 'none';
        break;
      case 'path':
        if (a.d) cmds = parsePathData(a.d);
        break;
      case 'title':
      case 'desc':
        if (!m[4]) depthSkip = 1;
        break;
      default:
        frag.skipped.push(tag);
        if (!m[4]) depthSkip = 1;
    }
    if (cmds && cmds.length) frag.pieces.push({ cmds: shift(cmds, dx, dy), look });
  }
  if (fragmentCache.size > 4000) fragmentCache.clear();
  fragmentCache.set(svg, frag);
  return frag;
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
}

export class SceneSink {
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
    const f = this.frame;
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
    this.frames.push({ item, dx: f.dx + dx, dy: f.dy + dy, look: attrs ? { ...f.look, ...parseLook(attrs) } : f.look });
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
    if (!cmds.length) return;
    const f = this.frame;
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

  path(d: string, attrs = ''): void {
    this.shape(parsePathData(d), parseLook(attrs));
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
    const frag = parseFragment(svg);
    for (const s of frag.skipped) this.skip(s);
    for (const p of frag.pieces) this.shape(p.cmds, p.look);
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
    if (!spans.some((s) => s.text.trim())) return;
    const f = this.frame;
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
}

let active: SceneSink | null = null;

// The sink of the scene being drawn, or null while drawing SVG.
export function activeSink(): SceneSink | null {
  return active;
}

export function withSink<T>(sink: SceneSink, draw: () => T): T {
  const before = active;
  active = sink;
  try {
    return draw();
  } finally {
    active = before;
  }
}
