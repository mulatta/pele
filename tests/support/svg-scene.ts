// Reads pele's SVG back into a scene, as a host that only has the SVG would, to check the scene a
// renderer draws directly against the SVG it writes. Follows what the scene output keeps: groups
// moved by translate(), inherited presentation attributes, `data-id` items, outlines and text.
// Anything else (another transform, images, icons, math) is counted in `skipped` and not drawn.
import { M, L, parsePathData, shift, type Box, type Path, type Scene, type SceneSpan } from '../../src/draw/scene.js';

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescape = (s: string): string =>
  s.includes('&')
    ? s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) =>
        e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? all)
      )
    : s;

function parseXml(src: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      if (stack.length > 1) stack.pop();
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = unescape(a[2]);
      const el: Node = { tag: m[2], attrs, children: [] };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5] !== undefined) top.children.push(unescape(m[5]));
  }
  return root.children.find((c): c is Node => typeof c !== 'string' && c.tag === 'svg') ?? root;
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'opacity', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'rx'];
type Look = Record<string, string>;

function own(el: Node): Look {
  const out: Look = { ...el.attrs };
  for (const decl of (el.attrs.style ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim().replace(/\s*!important$/, '');
  }
  return out;
}

const len = (v: string | undefined, fallback: number): number => {
  if (v === undefined) return fallback;
  if (v === 'var(--_r)') return 4;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const weight = (v: string | undefined, fallback: number): number =>
  v === undefined ? fallback : v === 'bold' || /^var\(--_(w|tw|hw)\)$/.test(v) ? 700 : v === 'normal' ? 400 : len(v, fallback);
const numbers = (s: string): number[] => (s.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

function cmdsBox(cmds: Path): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const argc = [2, 2, 6, 4, 7, 0];
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i];
    const end = i + 1 + argc[op];
    for (let k = op === 4 ? i + 6 : i + 1; k + 1 < end; k += 2) {
      b.x0 = Math.min(b.x0, cmds[k]);
      b.y0 = Math.min(b.y0, cmds[k + 1]);
      b.x1 = Math.max(b.x1, cmds[k]);
      b.y1 = Math.max(b.y1, cmds[k + 1]);
    }
    i = end;
  }
  return b;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number): Path => parsePathData(`M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}Z`);

function roundRect(x: number, y: number, w: number, h: number, rx: number, ry: number): Path {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!(rx > 0 && ry > 0)) return [M, x, y, L, x + w, y, L, x + w, y + h, L, x, y + h, 5];
  return parsePathData(
    `M${x + rx} ${y}L${x + w - rx} ${y}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}L${x + w} ${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
      `L${x + rx} ${y + h}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}L${x} ${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  );
}

function points(list: number[], close: boolean): Path {
  if (list.length < 4) return [];
  const cmds: Path = [M, list[0], list[1]];
  for (let i = 2; i + 1 < list.length; i += 2) cmds.push(L, list[i], list[i + 1]);
  if (close) cmds.push(5);
  return cmds;
}

export function svgToScene(svg: string): Scene {
  const root = parseXml(svg);
  const vb = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);
  const scene: Scene = { version: 2, x: 0, y: 0, w: vb[2] ?? 0, h: vb[3] ?? 0, baseline: null, shapes: [], texts: [], items: [], skipped: {} };
  const items: number[] = [-1];
  const skip = (what: string) => (scene.skipped[what] = (scene.skipped[what] ?? 0) + 1);
  const touch = (box: Box) => {
    const i = items[items.length - 1];
    if (i < 0) return;
    const it = scene.items[i];
    if (!it.box) it.box = { ...box };
    else {
      it.box.x0 = Math.min(it.box.x0, box.x0);
      it.box.y0 = Math.min(it.box.y0, box.y0);
      it.box.x1 = Math.max(it.box.x1, box.x1);
      it.box.y1 = Math.max(it.box.y1, box.y1);
    }
  };
  const shape = (cmds: Path, look: Look) => {
    if (!cmds.length) return;
    const box = cmdsBox(cmds);
    const item = items[items.length - 1];
    const opacity = len(look.opacity, 1);
    if (look.fill && look.fill !== 'none' && look.fill !== 'transparent') {
      scene.shapes.push({ kind: 'fill', paint: look.fill, opacity: opacity * len(look['fill-opacity'], 1), cmds, box, item });
    }
    const width = len(look['stroke-width'], 1);
    if (look.stroke && look.stroke !== 'none' && look.stroke !== 'transparent' && width > 0) {
      const dash = look['stroke-dasharray'] && look['stroke-dasharray'] !== 'none' ? numbers(look['stroke-dasharray']) : [];
      const p = width / 2;
      scene.shapes.push({
        kind: 'stroke', paint: look.stroke, opacity: opacity * len(look['stroke-opacity'], 1), width, dash: dash.length ? dash : null,
        cmds, box: { x0: box.x0 - p, y0: box.y0 - p, x1: box.x1 + p, y1: box.y1 + p }, item,
      });
    }
    touch(box);
  };
  const text = (el: Node, look: Look, dx: number, dy: number) => {
    const size = len(look['font-size'], 16);
    const base = { size, weight: weight(look['font-weight'], 400), italic: look['font-style'] === 'italic', paint: look.fill && look.fill !== 'none' ? look.fill : 'var(--_fg)' };
    let x = len(el.attrs.x, 0) + dx;
    let y = len(el.attrs.y, 0) + dy;
    let anchor = (look['text-anchor'] ?? 'start') as 'start' | 'middle' | 'end';
    let spans: SceneSpan[] = [];
    const flush = () => {
      if (spans.some((s) => s.text.trim())) {
        scene.texts.push({ x, y, ...base, anchor, spans, item: items[items.length - 1] });
        const w = spans.reduce((n, s) => n + s.text.length, 0) * size * 0.55;
        const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        touch({ x0, y0: y - size, x1: x0 + w, y1: y + size * 0.25 });
      }
      spans = [];
    };
    for (const c of el.children) {
      if (typeof c === 'string') {
        if (c) spans.push({ text: c });
        continue;
      }
      if (c.tag !== 'tspan') continue;
      // A tspan with its own position starts a new run of text.
      if (c.attrs.x !== undefined || c.attrs.y !== undefined) {
        flush();
        if (c.attrs.x !== undefined) x = len(c.attrs.x, 0) + dx;
        if (c.attrs.y !== undefined) y = len(c.attrs.y, 0) + dy;
        anchor = (c.attrs['text-anchor'] ?? look['text-anchor'] ?? 'start') as typeof anchor;
      }
      spans.push({ text: c.children.filter((t): t is string => typeof t === 'string').join('') });
    }
    flush();
  };
  const walk = (el: Node, inherited: Look, dx: number, dy: number) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      const a = own(c);
      const look: Look = { ...inherited };
      for (const k of INHERITED) if (a[k] !== undefined) look[k] = a[k];
      let tx = dx;
      let ty = dy;
      if (c.attrs.transform) {
        const t = c.attrs.transform.match(/^\s*translate\(\s*([-\d.e+]+)(?:[\s,]+([-\d.e+]+))?\s*\)\s*$/);
        if (!t) {
          skip('transform');
          continue;
        }
        tx += Number(t[1]);
        ty += Number(t[2] ?? 0);
      }
      const id = c.attrs['data-id'];
      if (id !== undefined) {
        scene.items.push({ id, kind: c.attrs.class ?? c.tag, box: null });
        items.push(scene.items.length - 1);
      }
      switch (c.tag) {
        case 'g':
        case 'a':
          walk(c, look, tx, ty);
          break;
        case 'rect': {
          const w = len(a.width, 0);
          const h = len(a.height, 0);
          if (w > 0 && h > 0) shape(roundRect(len(a.x, 0) + tx, len(a.y, 0) + ty, w, h, len(look.rx ?? a.ry, 0), len(a.ry ?? look.rx, 0)), look);
          break;
        }
        case 'circle':
          if (len(a.r, 0) > 0) shape(ellipse(len(a.cx, 0) + tx, len(a.cy, 0) + ty, len(a.r, 0), len(a.r, 0)), look);
          break;
        case 'ellipse':
          if (len(a.rx, 0) > 0 && len(a.ry, 0) > 0) shape(ellipse(len(a.cx, 0) + tx, len(a.cy, 0) + ty, len(a.rx, 0), len(a.ry, 0)), look);
          break;
        case 'line':
          shape([M, len(a.x1, 0) + tx, len(a.y1, 0) + ty, L, len(a.x2, 0) + tx, len(a.y2, 0) + ty], { ...look, fill: 'none' });
          break;
        case 'polygon':
        case 'polyline':
          shape(shift(points(numbers(a.points ?? ''), c.tag === 'polygon'), tx, ty), c.tag === 'polyline' && a.fill === undefined ? { ...look, fill: 'none' } : look);
          break;
        case 'path':
          if (a.d) shape(shift(parsePathData(a.d), tx, ty), look);
          break;
        case 'text':
          text(c, look, tx, ty);
          break;
        case 'title':
        case 'desc':
          break;
        case 'svg':
        case 'foreignObject':
          skip(/\bpele-math\b/.test(c.attrs.class ?? '') ? 'math' : /\bpele-icon\b/.test(c.attrs.class ?? '') ? 'icon' : c.tag);
          break;
        default:
          skip(c.tag);
      }
      if (id !== undefined) items.pop();
    }
  };
  const font = root.attrs.style?.match(/font:\s*(\d+(?:\.\d+)?)px/);
  walk(root, { fill: root.attrs.fill ?? 'var(--_fg)', 'font-size': font ? font[1] : '16' }, 0, 0);
  return scene;
}

// What two scenes must share: size, text (content, anchor, position), items (id, kind, order, box)
// and the order of shapes by kind and paint. Positions are compared to the SVG's two decimals.
export function sceneDifference(actual: Scene, expected: Scene): string | null {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.0151;
  const nearBox = (a: Box | null, b: Box | null) => (a === null || b === null ? a === b : near(a.x0, b.x0) && near(a.y0, b.y0) && near(a.x1, b.x1) && near(a.y1, b.y1));
  if (actual.w !== expected.w || actual.h !== expected.h) return `size ${actual.w}x${actual.h}, expected ${expected.w}x${expected.h}`;
  const texts = (s: Scene) => s.texts.map((t) => `${t.spans.map((p) => p.text).join('')} ${t.anchor}`);
  const at = texts(actual);
  const et = texts(expected);
  for (let i = 0; i < Math.max(at.length, et.length); i++) {
    if (at[i] !== et[i]) return `text ${i}: ${JSON.stringify(at[i])}, expected ${JSON.stringify(et[i])}`;
    const a = actual.texts[i];
    const e = expected.texts[i];
    if (!near(a.x, e.x) || !near(a.y, e.y)) return `text ${i} ${JSON.stringify(at[i])} at ${a.x},${a.y}, expected ${e.x},${e.y}`;
  }
  for (let i = 0; i < Math.max(actual.items.length, expected.items.length); i++) {
    const a = actual.items[i];
    const e = expected.items[i];
    if (a?.id !== e?.id || a?.kind !== e?.kind) return `item ${i}: ${a?.id} ${a?.kind}, expected ${e?.id} ${e?.kind}`;
    if (!nearBox(a.box, e.box)) return `item ${i} ${a.id} box ${JSON.stringify(a.box)}, expected ${JSON.stringify(e.box)}`;
  }
  const shapes = (s: Scene) => s.shapes.map((x) => `${x.kind}|${x.paint}`);
  const as = shapes(actual);
  const es = shapes(expected);
  for (let i = 0; i < Math.max(as.length, es.length); i++) {
    if (as[i] !== es[i]) return `shape ${i}: ${as[i]}, expected ${es[i]} (${as.length} shapes, expected ${es.length})`;
  }
  return null;
}

// What sceneDifference compares, rounded to the SVG's two decimals, to keep as a baseline.
export function sceneSignature(scene: Scene): unknown {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    w: scene.w,
    h: scene.h,
    texts: scene.texts.map((t) => [t.spans.map((p) => p.text).join(''), t.anchor, r(t.x), r(t.y)]),
    items: scene.items.map((t) => [t.id, t.kind, t.box && [r(t.box.x0), r(t.box.y0), r(t.box.x1), r(t.box.y1)]]),
    shapes: scene.shapes.map((x) => `${x.kind}|${x.paint}`).join(' '),
  };
}

// Where two signatures part, numbers compared to the SVG's two decimals: a shape read from the
// SVG it writes is placed to the hundredth.
export function signatureDifference(actual: unknown, expected: unknown, at = ''): string | null {
  if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual - expected) < 0.0151 ? null : `${at}: ${actual}, expected ${expected}`;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${at}: ${actual.length} entries, expected ${expected.length}`;
    for (let i = 0; i < actual.length; i++) {
      const d = signatureDifference(actual[i], expected[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const d = signatureDifference((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${at}.${key}`);
      if (d) return d;
    }
    return null;
  }
  return actual === expected ? null : `${at}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}
