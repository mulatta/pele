// Reads pele's SVG back into a scene, as a host that only has the SVG would, to check the scene a
// renderer draws directly against the SVG it writes. Follows what the scene output keeps: groups
// moved by translate(), inherited presentation attributes, `data-id` items, outlines and text.
// Anything else (another transform, images, icons, math) is counted in `skipped` and not drawn.
// Path geometry is computed here, not imported from the scene output, so a fault there shows.
import type { Box, Path, Scene, SceneItem, SceneSpan, SceneText } from '../../src/draw/scene.js';

const [M, L, C, Q, A, Z] = [0, 1, 2, 3, 4, 5];
const ARGC = [2, 2, 6, 4, 7, 0];

// Path data -> absolute commands (M, L, C, Q, A, Z), as SVG reads it.
function pathData(d: string): Path {
  const out: Path = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let px: number | null = null;
  let py = 0;
  let last = '';
  const tokens = d.match(/[MLHVCSQTAZ]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  const flag = () => {
    // Arc flags may be packed with what follows: "011" is three numbers.
    const t = tokens[i];
    if (t.length > 1 && /^[01]/.test(t)) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    i++;
    return Number(t);
  };
  let cmd = '';
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === '') break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const c = cmd.toUpperCase();
    if (c === 'Z') {
      out.push(Z);
      x = sx;
      y = sy;
      last = 'Z';
      px = null;
      continue;
    }
    if (i >= tokens.length) break;
    switch (c) {
      case 'M':
        x = num() + ox;
        y = num() + oy;
        sx = x;
        sy = y;
        out.push(M, x, y);
        cmd = rel ? 'l' : 'L';
        px = null;
        break;
      case 'L':
        x = num() + ox;
        y = num() + oy;
        out.push(L, x, y);
        px = null;
        break;
      case 'H':
        x = num() + ox;
        out.push(L, x, y);
        px = null;
        break;
      case 'V':
        y = num() + oy;
        out.push(L, x, y);
        px = null;
        break;
      case 'C':
      case 'S': {
        const smooth = c === 'S';
        const x1 = smooth ? (last === 'C' && px !== null ? 2 * x - px : x) : num() + ox;
        const y1 = smooth ? (last === 'C' && px !== null ? 2 * y - py : y) : num() + oy;
        const x2 = num() + ox;
        const y2 = num() + oy;
        x = num() + ox;
        y = num() + oy;
        out.push(C, x1, y1, x2, y2, x, y);
        px = x2;
        py = y2;
        last = 'C';
        continue;
      }
      case 'Q':
      case 'T': {
        const smooth = c === 'T';
        const x1 = smooth ? (last === 'Q' && px !== null ? 2 * x - px : x) : num() + ox;
        const y1 = smooth ? (last === 'Q' && px !== null ? 2 * y - py : y) : num() + oy;
        x = num() + ox;
        y = num() + oy;
        out.push(Q, x1, y1, x, y);
        px = x1;
        py = y1;
        last = 'Q';
        continue;
      }
      case 'A': {
        const rx = Math.abs(num());
        const ry = Math.abs(num());
        const rot = num();
        const large = flag();
        const sweep = flag();
        x = num() + ox;
        y = num() + oy;
        out.push(A, rx, ry, rot, large ? 1 : 0, sweep ? 1 : 0, x, y);
        px = null;
        break;
      }
      default:
        i++;
    }
    last = c;
  }
  return out;
}

function moved(cmds: Path, dx: number, dy: number): Path {
  const o = cmds.slice();
  for (let i = 0; i < o.length; ) {
    const op = o[i];
    const end = i + 1 + ARGC[op];
    for (let k = op === A ? i + 6 : i + 1; k + 1 < end; k += 2) {
      o[k] += dx;
      o[k + 1] += dy;
    }
    i = end;
  }
  return o;
}

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

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'opacity', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-anchor', 'rx'];
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
    for (let k = op === A ? i + 6 : i + 1; k + 1 < end; k += 2) {
      b.x0 = Math.min(b.x0, cmds[k]);
      b.y0 = Math.min(b.y0, cmds[k + 1]);
      b.x1 = Math.max(b.x1, cmds[k]);
      b.y1 = Math.max(b.y1, cmds[k + 1]);
    }
    i = end;
  }
  return b;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number): Path => pathData(`M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}Z`);

function roundRect(x: number, y: number, w: number, h: number, rx: number, ry: number): Path {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!(rx > 0 && ry > 0)) return [M, x, y, L, x + w, y, L, x + w, y + h, L, x, y + h, Z];
  return pathData(
    `M${x + rx} ${y}L${x + w - rx} ${y}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}L${x + w} ${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
      `L${x + rx} ${y + h}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}L${x} ${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  );
}

function points(list: number[], close: boolean): Path {
  if (list.length < 4) return [];
  const cmds: Path = [M, list[0], list[1]];
  for (let i = 2; i + 1 < list.length; i += 2) cmds.push(L, list[i], list[i + 1]);
  if (close) cmds.push(Z);
  return cmds;
}

export function svgToScene(svg: string): Scene {
  const root = parseXml(svg);
  const vb = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);
  const scene: Scene = { version: 3, x: 0, y: 0, w: vb[2] ?? 0, h: vb[3] ?? 0, baseline: null, shapes: [], texts: [], items: [], skipped: {} };
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
    // A run's style as the text it is in gives it, and its own over that.
    const run = (t: string, a: Look): SceneSpan => {
      const span: SceneSpan = { text: t };
      const w = a['font-weight'];
      if (w !== undefined && weight(w, 400) >= 600) span.weight = 700;
      if (a['font-style'] === 'italic') span.italic = true;
      if ((a['font-family'] ?? look['font-family']) === 'var(--_fm)') span.mono = true;
      if (a.fill !== undefined && a.fill !== 'none') span.paint = a.fill;
      return span;
    };
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
        if (c) spans.push(run(c, {}));
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
      spans.push(run(c.children.filter((t): t is string => typeof t === 'string').join(''), own(c)));
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
        const it: SceneItem = { id, kind: c.attrs.class ?? c.tag, box: null };
        if (c.attrs['data-line'] !== undefined) it.line = Number(c.attrs['data-line']);
        if (c.attrs['data-end'] !== undefined) it.end = Number(c.attrs['data-end']);
        if (c.attrs['data-symbol'] !== undefined) it.symbol = c.attrs['data-symbol'];
        if (c.attrs['data-from'] !== undefined) it.from = c.attrs['data-from'];
        if (c.attrs['data-to'] !== undefined) it.to = c.attrs['data-to'];
        scene.items.push(it);
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
          shape(moved(points(numbers(a.points ?? ''), c.tag === 'polygon'), tx, ty), c.tag === 'polyline' && a.fill === undefined ? { ...look, fill: 'none' } : look);
          break;
        case 'path':
          if (a.d) shape(moved(pathData(a.d), tx, ty), look);
          break;
        case 'text':
          text(c, look, tx, ty);
          break;
        case 'title':
        case 'desc':
          break;
        case 'svg':
          if (/\bpele-icon\b/.test(c.attrs.class ?? '')) icon(c, look, tx, ty);
          else skip(/\bpele-math\b/.test(c.attrs.class ?? '') ? 'math' : c.tag);
          break;
        case 'foreignObject':
          skip(c.tag);
          break;
        default:
          skip(c.tag);
      }
      if (id !== undefined) items.pop();
    }
  };
  // A nested viewport: its viewBox fitted to its box, centred (preserveAspectRatio's default).
  // What it holds is read on its own and then scaled and moved into place, line widths too.
  const icon = (el: Node, look: Look, dx: number, dy: number) => {
    const w = len(el.attrs.width, 0);
    const h = len(el.attrs.height, 0);
    const vb = el.attrs.viewBox ? numbers(el.attrs.viewBox) : [0, 0, w, h];
    if (!(w > 0 && h > 0 && vb[2] > 0 && vb[3] > 0)) return;
    const k = Math.min(w / vb[2], h / vb[3]);
    const ox = len(el.attrs.x, 0) + dx + (w - vb[2] * k) / 2 - vb[0] * k;
    const oy = len(el.attrs.y, 0) + dy + (h - vb[3] * k) / 2 - vb[1] * k;
    const from = scene.shapes.length;
    const texts = scene.texts.length;
    items.push(-1);
    walk(el, look, 0, 0);
    items.pop();
    for (let n = scene.texts.length - texts; n > 0; n--) skip('text');
    scene.texts.length = texts;
    for (const x of scene.shapes.slice(from)) {
      const c = x.cmds.slice();
      for (let i = 0; i < c.length; ) {
        const op = c[i];
        const end = i + 1 + ARGC[op];
        if (op === A) {
          c[i + 1] *= k;
          c[i + 2] *= k;
        }
        for (let j = op === A ? i + 6 : i + 1; j + 1 < end; j += 2) {
          c[j] = c[j] * k + ox;
          c[j + 1] = c[j + 1] * k + oy;
        }
        i = end;
      }
      x.cmds = c;
      x.item = items[items.length - 1];
      const box = cmdsBox(c);
      if (x.kind === 'stroke') {
        x.width = x.width! * k;
        if (x.dash) x.dash = x.dash.map((d) => d * k);
        const p = x.width / 2;
        x.box = { x0: box.x0 - p, y0: box.y0 - p, x1: box.x1 + p, y1: box.y1 + p };
      } else x.box = box;
      touch(box);
    }
  };
  const font = root.attrs.style?.match(/font:\s*(\d+(?:\.\d+)?)px/);
  walk(root, { fill: root.attrs.fill ?? 'var(--_fg)', 'font-size': font ? font[1] : '16' }, 0, 0);
  return scene;
}

// What two scenes must share: size, text (content, anchor, position), items (id, kind, order, box)
// and the order of shapes by kind and paint. Positions are compared to the SVG's two decimals.
export function sceneDifference(actual: Scene, expected: Scene): string | null {
  if (actual.w !== expected.w || actual.h !== expected.h) return `size ${actual.w}x${actual.h}, expected ${expected.w}x${expected.h}`;
  const name = (s: Scene, k: 'texts' | 'items' | 'shapes', i: number) => {
    const t = s.texts[i];
    if (k === 'texts') return t ? JSON.stringify(t.spans.map((p) => p.text).join('')) : 'none';
    if (k === 'items') return s.items[i]?.id ?? 'none';
    return `${s.shapes[i]?.kind ?? 'none'} ${s.shapes[i]?.paint ?? ''}`;
  };
  for (const k of ['items', 'texts', 'shapes'] as const) {
    const a = k === 'texts' ? actual.texts.map(seen) : actual[k];
    const e = k === 'texts' ? expected.texts.map(seen) : expected[k];
    for (let i = 0; i < Math.max(a.length, e.length); i++) {
      const d = valueDifference(a[i], e[i], '');
      if (d) return `${k.slice(0, -1)} ${i} (${name(actual, k, i)}, expected ${name(expected, k, i)})${d}${a.length !== e.length ? ` (${a.length} ${k}, expected ${e.length})` : ''}`;
    }
  }
  return valueDifference(actual.skipped, expected.skipped, ' skipped');
}

// A text as it shows: a style set on the text or on its run looks the same.
function seen(t: SceneText) {
  const { weight, italic, paint, spans, ...rest } = t;
  return {
    ...rest,
    spans: spans.map((s) => ({ text: s.text, weight: s.weight ?? weight, italic: s.italic ?? italic, mono: s.mono ?? false, paint: s.paint ?? paint })),
  };
}

// Numbers compared to the SVG's two decimals: a value read from the SVG it writes is to the hundredth.
function valueDifference(actual: unknown, expected: unknown, at: string): string | null {
  if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual - expected) < 0.0151 ? null : `${at}: ${actual}, expected ${expected}`;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${at}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
    for (let i = 0; i < actual.length; i++) {
      const d = valueDifference(actual[i], expected[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const d = valueDifference((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${at}.${key}`);
      if (d) return d;
    }
    return null;
  }
  return actual === expected ? null : `${at}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
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
export function signatureDifference(actual: unknown, expected: unknown): string | null {
  return valueDifference(actual, expected, '');
}
