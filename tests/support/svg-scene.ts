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

// The path's bounds. An arc is followed along its ellipse in fine steps, close enough at the
// sizes diagrams use to the hundredths a scene is compared to.
function cmdsBox(cmds: Path): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (x: number, y: number) => {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  };
  let [cur, start] = [[0, 0], [0, 0]];
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i];
    const end = i + 1 + ARGC[op];
    if (op === A) for (const [x, y] of arcPoints(cur[0], cur[1], cmds.slice(i + 1, end))) add(x, y);
    for (let k = op === A ? i + 6 : i + 1; k + 1 < end; k += 2) add(cmds[k], cmds[k + 1]);
    if (op === Z) cur = start;
    else {
      cur = [cmds[end - 2], cmds[end - 1]];
      if (op === M) start = cur;
    }
    i = end;
  }
  return b;
}

// Points along an arc from (x1, y1), from its centre form (SVG 1.1, F.6.5 and F.6.6).
function arcPoints(x1: number, y1: number, [rx0, ry0, rot, large, sweep, x2, y2]: number[]): number[][] {
  let [rx, ry] = [Math.abs(rx0), Math.abs(ry0)];
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [];
  const phi = (rot * Math.PI) / 180;
  const [c, s] = [Math.cos(phi), Math.sin(phi)];
  const x = (c * (x1 - x2)) / 2 + (s * (y1 - y2)) / 2;
  const y = (-s * (x1 - x2)) / 2 + (c * (y1 - y2)) / 2;
  const lambda = (x * x) / (rx * rx) + (y * y) / (ry * ry);
  if (lambda > 1) [rx, ry] = [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)];
  const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x));
  const f = (large === sweep ? -1 : 1) * Math.sqrt(sq);
  const [ccx, ccy] = [(f * rx * y) / ry, (-f * ry * x) / rx];
  const [cx, cy] = [c * ccx - s * ccy + (x1 + x2) / 2, s * ccx + c * ccy + (y1 + y2) / 2];
  const from = Math.atan2((y - ccy) / ry, (x - ccx) / rx);
  let span = Math.atan2((-y - ccy) / ry, (-x - ccx) / rx) - from;
  if (sweep && span < 0) span += 2 * Math.PI;
  if (!sweep && span > 0) span -= 2 * Math.PI;
  const steps = 2048;
  const out: number[][] = [];
  for (let n = 0; n <= steps; n++) {
    const t = from + (span * n) / steps;
    out.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]);
  }
  return out;
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

// An affine map as SVG writes one, matrix(a b c d e f).
type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

// p -> outer(inner(p)).
function compose(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [g, h, i, j, k, l] = inner;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

// A transform attribute, read one function at a time; null when one is not understood.
function readTransform(text: string): Affine | null {
  let at = IDENTITY;
  let rest = text.trim();
  while (rest) {
    const open = rest.indexOf('(');
    const close = rest.indexOf(')');
    if (open < 0 || close < open) return null;
    const name = rest.slice(0, open).trim();
    const v = numbers(rest.slice(open + 1, close));
    rest = rest.slice(close + 1).replace(/^[\s,]+/, '');
    const deg = (x: number) => (x * Math.PI) / 180;
    let t: Affine;
    if (name === 'translate') t = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (name === 'scale') t = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (name === 'matrix' && v.length === 6) t = [v[0], v[1], v[2], v[3], v[4], v[5]];
    else if (name === 'rotate') {
      const r: Affine = [Math.cos(deg(v[0])), Math.sin(deg(v[0])), -Math.sin(deg(v[0])), Math.cos(deg(v[0])), 0, 0];
      t = v.length >= 3 ? compose(compose([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]) : r;
    } else if (name === 'skewX') t = [1, 0, Math.tan(deg(v[0])), 1, 0, 0];
    else if (name === 'skewY') t = [1, Math.tan(deg(v[0])), 0, 1, 0, 0];
    else return null;
    at = compose(at, t);
  }
  return at;
}

// How much a map scales lengths, and how far it turns the x axis (degrees).
const scaleOf = (m: Affine) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const angleOf = (m: Affine) => (Math.atan2(m[1], m[0]) * 180) / Math.PI;

// A path in a frame's coordinates, in the scene's.
function place(cmds: Path, m: Affine): Path {
  const out = cmds.slice();
  for (let i = 0; i < out.length; ) {
    const op = out[i];
    const end = i + 1 + ARGC[op];
    if (op === A) {
      out[i + 1] *= Math.hypot(m[0], m[1]);
      out[i + 2] *= Math.hypot(m[2], m[3]);
      out[i + 3] += angleOf(m);
      if (m[0] * m[3] - m[1] * m[2] < 0) out[i + 5] = 1 - out[i + 5];
    }
    for (let k = op === A ? i + 6 : i + 1; k + 1 < end; k += 2) {
      const [x, y] = [out[k], out[k + 1]];
      out[k] = m[0] * x + m[2] * y + m[4];
      out[k + 1] = m[1] * x + m[3] * y + m[5];
    }
    i = end;
  }
  return out;
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
  const shape = (local: Path, look: Look, m: Affine) => {
    if (!local.length) return;
    const cmds = place(local, m);
    const box = cmdsBox(cmds);
    const item = items[items.length - 1];
    const opacity = len(look.opacity, 1);
    if (look.fill && look.fill !== 'none' && look.fill !== 'transparent') {
      scene.shapes.push({ kind: 'fill', paint: look.fill, opacity: opacity * len(look['fill-opacity'], 1), cmds, box, item });
    }
    const k = scaleOf(m);
    const width = len(look['stroke-width'], 1) * k;
    if (look.stroke && look.stroke !== 'none' && look.stroke !== 'transparent' && width > 0) {
      const dash = look['stroke-dasharray'] && look['stroke-dasharray'] !== 'none' ? numbers(look['stroke-dasharray']).map((d) => d * k) : [];
      const p = width / 2;
      scene.shapes.push({
        kind: 'stroke', paint: look.stroke, opacity: opacity * len(look['stroke-opacity'], 1), width, dash: dash.length ? dash : null,
        cmds, box: { x0: box.x0 - p, y0: box.y0 - p, x1: box.x1 + p, y1: box.y1 + p }, item,
      });
    }
    touch(box);
  };
  // Texts in an icon are not drawn: a scene text has no scale.
  let inIcon = 0;
  const text = (el: Node, look: Look, m: Affine) => {
    const size = len(look['font-size'], 16) * scaleOf(m);
    const filled = look.fill !== undefined && look.fill !== 'none' && look.fill !== 'transparent';
    const base = { size, weight: weight(look['font-weight'], 400), italic: look['font-style'] === 'italic', paint: look.fill === undefined ? 'var(--_fg)' : filled ? look.fill : 'none' };
    const width = len(look['stroke-width'], 1);
    const outline = look.stroke && look.stroke !== 'none' && look.stroke !== 'transparent' && width > 0 ? { stroke: look.stroke, strokeWidth: width * scaleOf(m) } : {};
    let x = len(el.attrs.x, 0);
    let y = len(el.attrs.y, 0);
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
        if (inIcon) skip('text');
        else {
          const px = m[0] * x + m[2] * y + m[4];
          const py = m[1] * x + m[3] * y + m[5];
          const t: SceneText = { x: px, y: py, ...base, anchor, spans, item: items[items.length - 1], ...outline };
          const angle = angleOf(m);
          const w = spans.reduce((n, s) => n + s.text.length, 0) * size * 0.55;
          const left = anchor === 'middle' ? -w / 2 : anchor === 'end' ? -w : 0;
          // The text's box, turned with it about its origin.
          const r = (angle * Math.PI) / 180;
          const xs: number[] = [];
          const ys: number[] = [];
          for (const u of [left, left + w])
            for (const v of [-size, size * 0.25]) {
              xs.push(px + u * Math.cos(r) - v * Math.sin(r));
              ys.push(py + u * Math.sin(r) + v * Math.cos(r));
            }
          if (Math.abs(angle) >= 1e-9) t.angle = angle;
          scene.texts.push(t);
          touch({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
        }
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
        if (c.attrs.x !== undefined) x = len(c.attrs.x, 0);
        if (c.attrs.y !== undefined) y = len(c.attrs.y, 0);
        anchor = (c.attrs['text-anchor'] ?? look['text-anchor'] ?? 'start') as typeof anchor;
      }
      spans.push(run(c.children.filter((t): t is string => typeof t === 'string').join(''), own(c)));
    }
    flush();
  };
  // A nested viewport: its viewBox fitted to its box, centred (preserveAspectRatio's default).
  const icon = (el: Node, look: Look, m: Affine) => {
    const w = len(el.attrs.width, 0);
    const h = len(el.attrs.height, 0);
    const vb = el.attrs.viewBox ? numbers(el.attrs.viewBox) : [0, 0, w, h];
    if (!(w > 0 && h > 0 && vb[2] > 0 && vb[3] > 0)) return;
    const k = Math.min(w / vb[2], h / vb[3]);
    const ox = len(el.attrs.x, 0) + (w - vb[2] * k) / 2 - vb[0] * k;
    const oy = len(el.attrs.y, 0) + (h - vb[3] * k) / 2 - vb[1] * k;
    inIcon++;
    walk(el, look, compose(m, [k, 0, 0, k, ox, oy]));
    inIcon--;
  };
  const walk = (el: Node, inherited: Look, outer: Affine) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      const a = own(c);
      const look: Look = { ...inherited };
      for (const k of INHERITED) if (a[k] !== undefined) look[k] = a[k];
      let m = outer;
      if (c.attrs.transform) {
        const t = readTransform(c.attrs.transform);
        if (!t) {
          skip('transform');
          continue;
        }
        m = compose(outer, t);
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
          walk(c, look, m);
          break;
        case 'rect': {
          const w = len(a.width, 0);
          const h = len(a.height, 0);
          if (w > 0 && h > 0) shape(roundRect(len(a.x, 0), len(a.y, 0), w, h, len(look.rx ?? a.ry, 0), len(a.ry ?? look.rx, 0)), look, m);
          break;
        }
        case 'circle':
          if (len(a.r, 0) > 0) shape(ellipse(len(a.cx, 0), len(a.cy, 0), len(a.r, 0), len(a.r, 0)), look, m);
          break;
        case 'ellipse':
          if (len(a.rx, 0) > 0 && len(a.ry, 0) > 0) shape(ellipse(len(a.cx, 0), len(a.cy, 0), len(a.rx, 0), len(a.ry, 0)), look, m);
          break;
        case 'line':
          shape([M, len(a.x1, 0), len(a.y1, 0), L, len(a.x2, 0), len(a.y2, 0)], { ...look, fill: 'none' }, m);
          break;
        case 'polygon':
        case 'polyline':
          shape(points(numbers(a.points ?? ''), c.tag === 'polygon'), c.tag === 'polyline' && a.fill === undefined ? { ...look, fill: 'none' } : look, m);
          break;
        case 'path':
          if (a.d) shape(pathData(a.d), look, m);
          break;
        case 'text':
          text(c, look, m);
          break;
        case 'title':
        case 'desc':
          break;
        case 'svg':
          if (/\bpele-icon\b/.test(c.attrs.class ?? '')) icon(c, look, m);
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
  const font = root.attrs.style?.match(/font:\s*(\d+(?:\.\d+)?)px/);
  walk(root, { fill: root.attrs.fill ?? 'var(--_fg)', 'font-size': font ? font[1] : '16' }, IDENTITY);
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
