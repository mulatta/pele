import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import type { Path, Scene, SceneItem } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, hasClass, itemById, items, lineOf, lines, paints, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('block', /block/);

// A block or composite, by the middle of its box and its size.
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxOf = (scene: Scene, item: SceneItem): Box => {
  const { box } = shapesOf(scene, item)[0];
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, w: box.x1 - box.x0, h: box.y1 - box.y0 };
};

// Center of every drawn block and box of every composite, by id.
function boxes(scene: Scene): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const item of scene.items) if (hasClass(item, 'pele-node') || hasClass(item, 'pele-cluster')) out.set(item.id, boxOf(scene, item));
  return out;
}

function layoutOf(src: string): Map<string, Box> {
  return boxes(draw(src).scene);
}

// The moves, lines, curves and arcs of a path, in order, as letters.
const ARGC = [2, 2, 6, 4, 7, 0];
function route(cmds: Path): string {
  let out = '';
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) out += 'MLCQAZ'[cmds[i]];
  return out;
}

// Every point a path passes through.
function pointsOf(cmds: Path): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) {
    const end = i + 1 + ARGC[cmds[i]];
    if (end - i > 1) out.push([cmds[end - 2], cmds[end - 1]]);
  }
  return out;
}

// The line of each connection, from where it leaves to where it arrives.
const paths = (scene: Scene): Path[] => items(scene, 'pele-edge').map((edge) => shapesOf(scene, edge)[0].cmds);

function labelBoxes(scene: Scene): Box[] {
  return items(scene, 'pele-edge-label').map((label) => boxOf(scene, label));
}

const nodeLabel = (scene: Scene, id: string): string[] => textsOf(scene, itemById(scene, id, 'pele-node')!).map(lineOf);

// What is drawn, without where in the source each part was written.
const picture = (scene: Scene): string => JSON.stringify([scene.shapes, scene.texts]);

function expectSeparateLabels(src: string, count: number): void {
  const result = draw(src);
  const model = parse(src);
  if (model.type !== 'block') throw new Error('not a block model');
  const labels = items(result.scene, 'pele-edge-label').map((label) => ({ id: label.id, ...boxOf(result.scene, label) }));
  expect(labels).toHaveLength(count);
  expect(labels.map((label) => label.id)).toEqual(model.edges.filter((edge) => edge.label).map((edge) => edge.id));
  expect(paths(result.scene)).toHaveLength(model.edges.length);
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    expect(a.w).toBeGreaterThan(0);
    expect(a.h).toBeGreaterThan(0);
    expect(a.x - a.w / 2).toBeGreaterThanOrEqual(0);
    expect(a.y - a.h / 2).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w / 2).toBeLessThanOrEqual(result.width);
    expect(a.y + a.h / 2).toBeLessThanOrEqual(result.height);
    for (const b of labels.slice(i + 1)) {
      const overlapX = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
      const overlapY = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
      expect(Math.min(overlapX, overlapY), `${a.id} overlaps ${b.id}`).toBeLessThanOrEqual(0.01);
    }
    // Labels paint last, so a label's center must belong to that label alone.
    const hits = labels.filter((b) => Math.abs(a.x - b.x) < b.w / 2 && Math.abs(a.y - b.y) < b.h / 2);
    expect(hits.map((b) => b.id)).toEqual([a.id]);
  }
  expect(draw(src)).toEqual(result);
}

describe('block rendering', () => {
  it('renders every corpus input that parses, safely and the same each time', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      expect(textOf(result.scene), where).not.toMatch(/NaN|undefined|Infinity/);
      expect(tryDraw(src), where).toEqual(result);
    }
    expect(rendered).toBeGreaterThan(60);
  });

  it('reports size and type for both keywords', () => {
    const result = draw('block\n  a b c');
    expect(result.type).toBe('block');
    expect(result.links).toEqual([]);
    expect(draw('block-beta\n  a b c')).toEqual(result);
    expect(detectType('block-beta\n a')).toBe('block');
    expect(supports('block\n a')).toBe(true);
  });

  it('puts blocks on one row without a column count', () => {
    const at = layoutOf('block\n  a b c');
    expect(at.get('a')!.y).toBe(at.get('b')!.y);
    expect(at.get('b')!.y).toBe(at.get('c')!.y);
    expect(at.get('b')!.x - at.get('a')!.x).toBe(at.get('c')!.x - at.get('b')!.x);
  });

  it('wraps to a new row after the column count', () => {
    const at = layoutOf('block\n  columns 3\n  a b c d');
    expect(at.get('d')!.x).toBe(at.get('a')!.x);
    expect(at.get('d')!.y).toBeGreaterThan(at.get('a')!.y);
    const stacked = layoutOf('block\n  columns 1\n  a b');
    expect(stacked.get('a')!.x).toBe(stacked.get('b')!.x);
  });

  it('makes every column as wide as the widest block and every row as tall as the tallest', () => {
    const at = layoutOf('block\n  columns 2\n  a["A much longer label"] b\n  c["two<br>lines"] d');
    const sizes = ['a', 'b', 'c', 'd'].map((id) => at.get(id)!);
    for (const box of sizes) {
      expect(box.w).toBeCloseTo(sizes[0].w, 6);
      expect(box.h).toBeCloseTo(sizes[0].h, 6);
    }
    expect(sizes[0].h).toBeGreaterThan(layoutOf('block\n a').get('a')!.h);
  });

  it('spans columns, with the gap between them included', () => {
    const at = layoutOf('block\n  columns 3\n  a["A label"] b:2 c:2 d');
    const a = at.get('a')!;
    const b = at.get('b')!;
    const d = at.get('d')!;
    expect(b.w).toBeCloseTo(2 * a.w + 12, 6);
    expect(at.get('c')!.x).toBeCloseTo(a.x + (a.w + 12) / 2, 1);
    expect(d.x).toBeCloseTo(a.x + 2 * (a.w + 12), 1);
    expect(d.y).toBe(at.get('c')!.y);
  });

  it('uses the wider cell to wrap a spanning block label', () => {
    const text = 'Something long long long long long long';
    const { scene } = draw(`block\n  1["Something"]\n  2["${text}"]:2\n  3["${text}"]:5\n  4["${text}"]:2\n  5["Something"]`);
    expect(nodeLabel(scene, '3')).toEqual([text]);
    expect(nodeLabel(scene, '2')).toHaveLength(2);
  });

  it('keeps fixed shapes and explicit line breaks when a block spans columns', () => {
    const text = 'Something long long long long long long';
    const fixed = draw(`block\n  a(("${text}")) c{"${text}"} d["${text}"]:5`);
    expect(nodeLabel(fixed.scene, 'a')).toHaveLength(2);
    expect(nodeLabel(fixed.scene, 'c')).toHaveLength(2);
    expect(nodeLabel(fixed.scene, 'd')).toEqual([text]);

    const broken = draw(`block\n  a["${text}<br>tail"]:5 b c d e`);
    expect(nodeLabel(broken.scene, 'a')).toEqual(['Something long long long long long', 'long', 'tail']);
  });

  it('stops a block that is wider than the rest of its row at the last column', () => {
    const at = layoutOf('block\n  columns 3\n  a b:3 c');
    const a = at.get('a')!;
    expect(at.get('b')!.w).toBeCloseTo(2 * a.w + 12, 6);
    expect(at.get('c')!.x).toBe(a.x);
    expect(at.get('c')!.y).toBeGreaterThan(a.y);
    const every = layoutOf('block\n  a:0 b');
    expect(every.get('a')!.w).toBeCloseTo(every.get('b')!.w, 6);
  });

  it('leaves room for space blocks', () => {
    const at = layoutOf('block\n  columns 3\n  a space b\n  c d e');
    expect(at.get('b')!.x).toBe(at.get('e')!.x);
    expect(at.get('d')!.x).toBe((at.get('a')!.x + at.get('b')!.x) / 2);
    const wide = layoutOf('block\n  ida space:3 idb idc');
    const step = wide.get('idc')!.x - wide.get('idb')!.x;
    expect(wide.get('idb')!.x - wide.get('ida')!.x).toBeCloseTo(4 * step, 1);
    expect(items(draw('block\n  a space b').scene, 'pele-node')).toHaveLength(2);
  });

  it('sizes a composite from its children and lets it use its own columns', () => {
    const at = layoutOf('block\n  columns 1\n  top\n  block:group\n    columns 2\n    a b c d\n  end');
    const group = at.get('group')!;
    for (const id of ['a', 'b', 'c', 'd']) {
      const box = at.get(id)!;
      expect(box.x - box.w / 2).toBeGreaterThanOrEqual(group.x - group.w / 2 + 12);
      expect(box.x + box.w / 2).toBeLessThanOrEqual(group.x + group.w / 2 - 12);
      expect(box.y - box.h / 2).toBeGreaterThanOrEqual(group.y - group.h / 2 + 12);
      expect(box.y + box.h / 2).toBeLessThanOrEqual(group.y + group.h / 2 - 12);
    }
    expect(at.get('c')!.x).toBe(at.get('a')!.x);
    expect(at.get('top')!.w).toBeCloseTo(group.w, 6);
  });

  it('stretches the children of a composite that spans a wider cell', () => {
    const at = layoutOf('block\n  columns 3\n  a["A wide block label here"]:3\n  block:g:2\n    x y\n  end\n  z');
    const g = at.get('g')!;
    const x = at.get('x')!;
    expect(g.w).toBeCloseTo((2 * (at.get('a')!.w - 24)) / 3 + 12, 5);
    expect(2 * x.w + 3 * 12).toBeCloseTo(g.w, 5);
  });

  it('makes rows with a plain block as tall as the tallest block, and rows of composites as tall as they need', () => {
    const at = layoutOf(
      'block\n  columns 3\n  a:3\n  block:group1:2\n    columns 2\n    h i j k\n  end\n  g\n  block:group2:3\n    l m n o p q r\n  end'
    );
    const plain = layoutOf('block\n  l').get('l')!.h;
    expect(at.get('group1')!.h).toBeCloseTo(2 * plain + 3 * 12, 6);
    expect(at.get('a')!.h).toBeCloseTo(at.get('group1')!.h, 6);
    expect(at.get('g')!.h).toBeCloseTo(at.get('group1')!.h, 6);
    expect(at.get('group2')!.h).toBeCloseTo(plain + 2 * 12, 6);
    expect(at.get('l')!.h).toBeCloseTo(plain, 6);
    expect(at.get('group2')!.w).toBeCloseTo(at.get('a')!.w, 6);
  });

  it('draws a composite title above its children', () => {
    const { scene } = draw('block\n  block:g["Group title"]\n    a b\n  end');
    const at = boxes(scene);
    const [title] = textsOf(scene, itemById(scene, 'g', 'pele-cluster')!);
    expect(lineOf(title)).toBe('Group title');
    expect(title.y).toBeLessThan(at.get('a')!.y - at.get('a')!.h / 2);
    const plain = layoutOf('block\n  block:g\n    a b\n  end');
    expect(at.get('g')!.h).toBeGreaterThan(plain.get('g')!.h);
  });

  it('honours block.padding', () => {
    const tight = draw('---\nconfig:\n  block:\n    padding: 2\n---\nblock\n  a b c');
    const loose = draw('---\nconfig:\n  block:\n    padding: 40\n---\nblock\n  a b c');
    expect(loose.width - tight.width).toBe(2 * 38);
  });

  it('draws each bracket shape', () => {
    const shapes: [string, string][] = [
      ['a', 'rect'], ['a["x"]', 'rect'], ['a("x")', 'rounded'], ['a(["x"])', 'stadium'], ['a[["x"]]', 'fr-rect'],
      ['a[("x")]', 'cyl'], ['a(("x"))', 'circle'], ['a((("x")))', 'dbl-circ'], ['a>"x"]', 'odd'], ['a{"x"}', 'diam'],
      ['a{{"x"}}', 'hex'], ['a[/"x"/]', 'lean-r'], ['a[\\"x"\\]', 'lean-l'], ['a[/"x"\\]', 'trap-b'],
      ['a[\\"x"/]', 'trap-t'], ['a<["x"]>(right)', 'block-arrow'], ['a("x"]', 'rect'],
    ];
    for (const [source, shape] of shapes) {
      expect(items(draw(`block\n  ${source}`).scene, `pele-shape-${shape}`), source).toHaveLength(1);
    }
  });

  it('keeps circles and diamonds at their own size in a larger cell', () => {
    const at = layoutOf('block\n  columns 1\n  a(("x"))\n  b["A much wider block than the circle"]');
    expect(at.get('a')!.w).toBeLessThan(at.get('b')!.w / 2);
  });

  it('draws block arrows for every direction', () => {
    // A block arrow is one outline, with a point for each corner.
    const points = (dirs: string): number => {
      const { scene } = draw(`block\n  a<["Label"]>(${dirs})`);
      return route(shapesOf(scene, itemById(scene, 'a', 'pele-node')!)[0].cmds).replaceAll('Z', '').length;
    };
    for (const dir of ['right', 'left', 'up', 'down']) expect(points(dir), dir).toBe(7);
    expect(points('x')).toBe(10);
    expect(points('y')).toBe(10);
    expect(points('x, down')).toBe(13);
    expect(points('x, y')).toBe(16);
    expect(points('up, up')).toBe(7);
    expect(points(' up ')).toBe(7);
    const labelled = draw('block\n  a<["Label"]>(right)');
    const blank = draw('block\n  a<["&nbsp;&nbsp;&nbsp;"]>(right)');
    expect(blank.height).toBeLessThan(labelled.height);
    expect(picture(draw('block\n  a<["x"]>(right)').scene)).not.toBe(picture(draw('block\n  a<["x"]>(left)').scene));
  });

  it('joins blocks in one row or column with a straight line between their borders', () => {
    const row = draw('block\n  a space b\n  a --> b').scene;
    const at = boxes(row);
    const [d] = paths(row);
    expect(route(d)).toBe('ML');
    expect(d[1]).toBe(at.get('a')!.x + at.get('a')!.w / 2);
    expect(d[2]).toBe(at.get('a')!.y);
    expect(d[5]).toBe(d[2]);
    expect(d[4]).toBeLessThan(at.get('b')!.x - at.get('b')!.w / 2);
    const [v] = paths(draw('block\n  columns 1\n  a space b\n  b --> a').scene);
    expect(route(v)).toBe('ML');
    expect(v[1]).toBe(v[4]);
    expect(v[5]).toBeLessThan(v[2]);
  });

  it('bends once between blocks that share neither, when the corner is free', () => {
    const { scene } = draw('block\n  columns 3\n  a space:2\n  space:3\n  space:2 b\n  a --> b');
    expect(route(paths(scene)[0])).toBe('MLQL');
  });

  it('goes straight across when a block sits on each corner', () => {
    const { scene } = draw('block\n  columns 2\n  a b\n  c d\n  a --> d');
    expect(route(paths(scene)[0])).toBe('ML');
  });

  it('draws arrowheads, line styles and labels', () => {
    const { scene } = draw(
      'block\n  columns 3\n  a space b\n  c space d\n  a --> b\n  c --o d\n  a --x c\n  b <--> d\n  a == "thick" ==> b\n  c -. "dotted" .-> d\n  b --- d'
    );
    const edges = items(scene, 'pele-edge');
    expect(edges).toHaveLength(7);
    const parts = edges.flatMap((edge) => shapesOf(scene, edge));
    // Arrowheads are closed triangles, a circle ends --o, and a cross ends --x.
    expect(parts.filter((s) => s.kind === 'fill' && route(s.cmds) === 'MLLZ')).toHaveLength(5);
    expect(parts.filter((s) => s.kind === 'fill' && route(s.cmds) === 'MAAZ')).toHaveLength(1);
    expect(parts.filter((s) => s.kind === 'stroke' && route(s.cmds) === 'MLML')).toHaveLength(1);
    expect(parts.some((s) => s.kind === 'stroke' && s.width === 2.5)).toBe(true);
    expect(parts.some((s) => s.dash?.join(' ') === '3 4')).toBe(true);
    expect(lines(scene)).toContain('thick');
    expect(lines(scene)).toContain('dotted');
    expect(items(scene, 'pele-edge-label')).toHaveLength(2);
  });

  it('spreads edges between the same two blocks', () => {
    const [first, second] = paths(draw('block\n  a space b\n  a --> b\n  b --> a').scene);
    expect(first[2]).not.toBe(second[2]);
  });

  it('separates labels on opposite vertical edges', () => {
    expectSeparateLabels(
      'block\n  columns 1\n  a["Upper layer"]\n  space:3\n  b["Lower layer"]\n  a -- "12 production conforming" --> b\n  b -- "12 production deviation" --> a',
      2
    );
  });

  it('separates labels on opposite horizontal edges', () => {
    expectSeparateLabels(
      'block\n  a["Left layer"] space:3 b["Right layer"]\n  a -- "12 production<br>conforming" --> b\n  b -- "12 production<br>deviation" --> a',
      2
    );
  });

  it('keeps disjoint labels on their original straight parallel routes', () => {
    const src = 'block\n  a space:3 b\n  a -- "forward" --> b\n  b -- "reverse" --> a';
    expectSeparateLabels(src, 2);
    for (const path of paths(draw(src).scene)) expect(route(path)).toBe('ML');
  });

  it('separates wide labels when narrow endpoints clamp the parallel routes', () => {
    expectSeparateLabels(
      'block\n  columns 1\n  a["A"]\n  space\n  b["B"]\n  a -- "144 production conforming" --> b\n  b -- "144 production deviation" --> a',
      2
    );
  });

  it('keeps every label for several edges between the same blocks', () => {
    expectSeparateLabels(
      'block\n  columns 1\n  a["A"]\n  space:2\n  b["B"]\n  a -- "7 production policy" --> b\n  a -- "7 test policy" --> b\n  a -- "7 production exception" --> b\n  b -- "7 production deviation" --> a',
      4
    );
  });

  it('keeps parallel edges straight while it stacks their labels', () => {
    const src = 'block\n  columns 3\n  l a r\n  space:3\n  m b n\n  a -- "production conforming" --> b\n  b -- "production deviation" --> a';
    expectSeparateLabels(src, 2);
    for (const path of paths(draw(src).scene)) expect(route(path)).toBe('ML');
  });

  it('leaves parallel labels in place when stacking them would cover another block', () => {
    const expectClear = (src: string, ids: string[]): void => {
      const { scene } = draw(src);
      const all = boxes(scene);
      for (const id of ids) {
        const b = all.get(id)!;
        for (const l of labelBoxes(scene)) expect(Math.abs(l.x - b.x) >= (l.w + b.w) / 2 || Math.abs(l.y - b.y) >= (l.h + b.h) / 2).toBe(true);
      }
    };
    expectClear('block\n  columns 1\n  a\n  space\n  c["Middle"]\n  space\n  b\n  a -- "forward label" --> b\n  a -- "second label" --> b', ['c']);
    expectClear('block\n  columns 1\n  a c d e b\n  a -- "one<br>two<br>three<br>four" --> b\n  a -- "one<br>two<br>three<br>four" --> b', ['c', 'e']);
  });

  it('leaves parallel labels in place when stacking them would cover a composite title', () => {
    const { scene } = draw('block\n  columns 1\n  b\n  space\n  block:g["Group"]\n    x\n  end\n  a\n  a -- "a long label" --> b\n  a -- "a long label" --> b\n  a -- "a long label" --> b');
    const [{ x, y: baseline }] = textsOf(scene, itemById(scene, 'g', 'pele-cluster')!);
    for (const l of labelBoxes(scene)) expect(Math.abs(l.x - x) >= l.w / 2 || Math.abs(l.y - (baseline - 6)) >= l.h / 2).toBe(true);
  });

  it('keeps stacked labels clear of arrowheads', () => {
    const { scene } = draw('block\n  columns 1\n  a\n  space\n  b\n  a -- "first label" --> b\n  a -- "second label" --> b\n  b -- "third label" --> a');
    const tips = items(scene, 'pele-edge')
      .flatMap((edge) => shapesOf(scene, edge))
      .filter((s) => s.kind === 'fill')
      .flatMap((s) => pointsOf(s.cmds));
    expect(tips.length).toBeGreaterThan(0);
    for (const l of labelBoxes(scene)) {
      for (const [x, y] of tips) expect(Math.abs(x - l.x) >= l.w / 2 || Math.abs(y - l.y) >= l.h / 2).toBe(true);
    }
  });

  it('widens the gap between blocks whose parallel labels do not fit between them', () => {
    const rows = 'block\n  columns 1\n  a\n  b\n  a -- "conforming" --> b\n  b -- "deviation" --> a';
    expectSeparateLabels(rows, 2);
    const near = layoutOf('block\n  columns 1\n  a\n  b\n  a --> b\n  b --> a');
    const far = layoutOf(rows);
    expect(far.get('b')!.y - far.get('a')!.y).toBeGreaterThan(near.get('b')!.y - near.get('a')!.y);
    expectSeparateLabels('block\n  a["Service"] space b["Database"]\n  a -- "read" --> b\n  a -- "write rows" --> b\n  b -- "notify" --> a', 3);
    expectSeparateLabels('block\n  columns 1\n  a\n  space\n  b\n  a -- "one" --> b\n  a -- "two" --> b\n  a -- "three" --> b\n  a -- "four" --> b\n  a -- "five" --> b', 5);
    expectSeparateLabels('block\n  columns 1\n  block:up["Up"]\n    a b\n  end\n  c\n  up -- "hi there" --> c\n  c -- "back again" --> up', 2);
    for (const path of paths(draw(rows).scene)) expect(route(path)).toBe('ML');
    // The row is stretched by its neighbor, so the first gap it gets falls short.
    expectSeparateLabels('block\n  columns 2\n  block:g\n    columns 1\n    a{"a"} b\n  end\n  q["Q<br>Q<br>Q<br>Q<br>Q<br>Q"]\n  a -- "long label" --> b\n  a -- "long label" --> b', 2);
  });

  it('keeps the gap between blocks when widening it leaves labels overlapping', () => {
    const src = 'block\n  columns 3\n  t1 t2 t3\n  a space b\n  b1 b2 b3\n  a -- "line one<br>line two<br>line three" --> b\n  b -- "back one<br>back two<br>back three" --> a';
    expect(draw(src).width).toBe(draw(src.replace(/ -- "[^"]*" --> /g, ' --> ')).width);
  });

  it('does not widen columns past maxWidth', () => {
    const src = 'block\n  a["Service"] space b["Database"]\n  a -- "read" --> b\n  a -- "write rows" --> b\n  b -- "notify" --> a';
    for (const maxWidth of [380, 397.5]) expect(draw(src, { maxWidth }).width).toBeLessThanOrEqual(maxWidth);
  });

  it('stacks parallel labels without widening the drawing past maxWidth', () => {
    const src = 'block\n  columns 1\n  a\n  space:2\n  b\n  a -- "a fairly long forward label" --> b\n  b -- "a fairly long backward label" --> a';
    expectSeparateLabels(src, 2);
    expect(draw(src, { maxWidth: 240 }).width).toBeLessThanOrEqual(240);
  });

  it('draws a self-loop as an arc', () => {
    const result = draw('block\n  a\n  a -- "again" --> a');
    const [loop] = paths(result.scene);
    expect(route(loop)).toBe('MA');
    expect(loop.slice(3, 9)).toEqual([4, 10, 10, 0, 1, 1]);
    expect(lines(result.scene)).toContain('again');
    assertSafe(result, 'self-loop');
  });

  it('joins a block to a composite that holds it', () => {
    const result = draw('block\n  block:g\n    a b\n  end\n  a --> g\n  g --> b');
    expect(paths(result.scene).length).toBe(2);
    assertSafe(result, 'edges to a composite');
  });

  it('keeps every link of a statement with several', () => {
    const model = parse('block\n  a --> b --> c -- "x" --> d');
    expect(model.type).toBe('block');
    if (model.type !== 'block') return;
    expect(model.blocks.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(model.edges.map((e) => [e.start, e.end, e.label])).toEqual([['a', 'b', ''], ['b', 'c', ''], ['c', 'd', 'x']]);
    expect(model.edges.map((e) => e.id)).toEqual(['1-a-b', '1-b-c', '1-c-d']);
  });

  it('applies styles and classes, also when they come before the block', () => {
    const { scene } = draw('block\n  classDef hot fill:#f96,stroke:#333,color:#400;\n  class a hot\n  style b fill:red;stroke:blue,stroke-width:2px\n  a b c\n  class b, c hot');
    expect(itemById(scene, 'a', 'pele-node')!.kind).toBe('pele-node pele-shape-rect hot');
    expect(itemById(scene, 'c', 'pele-node')!.kind).toBe('pele-node pele-shape-rect hot');
    const look = (id: string) => shapesOf(scene, itemById(scene, id, 'pele-node')!).map((s) => [s.kind, s.paint, s.width]);
    expect(look('a')).toEqual([['fill', '#f96', undefined], ['stroke', '#333', 1]]);
    expect(look('b')).toEqual([['fill', 'red', undefined], ['stroke', 'blue', 2]]);
    expect(textsOf(scene, itemById(scene, 'a', 'pele-node')!)[0].paint).toBe('#400');
    expect(boxes(scene).size).toBe(3);
  });

  it('gives blocks without a class the default class', () => {
    const { scene } = draw('block\n  a b\n  classDef default stroke:#f00\n  classDef other fill:#0f0\n  class b other');
    expect(scene.shapes.filter((s) => s.paint === '#f00')).toHaveLength(1);
  });

  it('styles a composite', () => {
    const { scene } = draw('block\n  block:g\n    a\n  end\n  style g fill:#fee,stroke:#f00');
    expect(shapesOf(scene, itemById(scene, 'g', 'pele-cluster')!).map((s) => [s.kind, s.paint])).toEqual([['fill', '#fee'], ['stroke', '#f00']]);
  });

  it('draws a composite fill the author sets at full opacity', () => {
    const { scene } = draw('block\n  block:g\n    a\n  end\n  block:h\n    b\n  end\n  style g fill:#fee');
    const [g] = shapesOf(scene, itemById(scene, 'g', 'pele-cluster')!);
    const [h] = shapesOf(scene, itemById(scene, 'h', 'pele-cluster')!);
    expect([g.paint, g.opacity]).toEqual(['#fee', 1]);
    expect([h.paint, h.opacity]).toEqual(['var(--_a)', 0.5]);
  });

  it('picks a contrasting label color on fills a style sets', () => {
    const { scene } = draw(
      'block\n  block:g["Group"]\n    a["Light"]\n  end\n  b["Dark"] c["Own"] d["Plain"]\n  e<["Go"]>(right)\n  style g fill:#FFF9C4\n  style a fill:#BBDEFB\n  style b fill:#1f3a5f\n  style c fill:#1f3a5f,color:#eee\n  style e fill:black'
    );
    const paintOf = (line: string): string => scene.texts.find((t) => lineOf(t) === line)!.paint;
    expect(paintOf('Group')).toBe('var(--pele-fg-on-light,#1f1f1f)');
    expect(paintOf('Light')).toBe('var(--pele-fg-on-light,#1f1f1f)');
    expect(paintOf('Dark')).toBe('var(--pele-fg-on-dark,#fff)');
    expect(paintOf('Own')).toBe('#eee');
    expect(paintOf('Plain')).toBe('var(--_fg)');
    expect(paintOf('Go')).toBe('var(--pele-fg-on-dark,#fff)');
  });

  it('cases edges that cross a composite fill a style sets and inks those inside it', () => {
    const src = 'block\n  block:g\n    a b\n  end\n  c\n  a --> b\n  b --> c\n  c --> c\n  style g fill:#BBDEFB';
    const { scene } = draw(src);
    // A casing is a wide stroke in the background color under the line, which belongs to no item.
    const casings = scene.shapes.filter((s) => s.item === -1 && s.kind === 'stroke' && s.paint === 'var(--_bg)' && s.width === 5);
    const edges = items(scene, 'pele-edge').map((edge) => shapesOf(scene, edge)[0]);
    expect(edges).toHaveLength(3);
    expect(edges.map((e) => casings.some((c) => JSON.stringify(c.cmds) === JSON.stringify(e.cmds)))).toEqual([false, true, false]);
    expect(edges.map((e) => e.paint)).toEqual(['var(--pele-fg-on-light,#1f1f1f)', 'var(--_l)', 'var(--_l)']);
    const plain = draw(src.replace('\n  style g fill:#BBDEFB', '')).scene;
    expect(plain.shapes.filter((s) => s.item === -1 && s.paint === 'var(--_bg)')).toEqual([]);
    expect(paints(plain).filter((p) => p.includes('--pele-fg-on'))).toEqual([]);
    // The second loop on a reaches out past the composite, so it is cased.
    const loops = draw('block\n  block:g\n    a\n  end\n  a --> a\n  a --> a\n  style g fill:white').scene;
    const [first] = shapesOf(loops, itemById(loops, '1-a-a', 'pele-edge')!);
    const [second] = shapesOf(loops, itemById(loops, '2-a-a', 'pele-edge')!);
    expect(first.paint).toBe('var(--pele-fg-on-light,#1f1f1f)');
    expect(second.paint).toBe('var(--_l)');
    expect(loops.shapes.some((s) => s.item === -1 && s.paint === 'var(--_bg)' && JSON.stringify(s.cmds) === JSON.stringify(second.cmds))).toBe(true);
  });

  it('draws the front matter title', () => {
    const plain = draw('block\n  a');
    const titled = draw('---\ntitle: Systems\n---\nblock\n  a');
    expect(titled.scene.texts.find((t) => lineOf(t) === 'Systems')!.weight).toBe(700);
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it('shows label text as text and decodes entities', () => {
    const { scene } = draw('block\n  a["<b>bold</b> & #quot;q#quot; #9829;"]\n  b["<img src=x onerror=alert(1)>"]');
    expect(textOf(scene)).not.toContain('<img');
    expect(lines(scene)).toEqual(['bold & "q" ♥']);
    expect(scene.texts[0].spans.map((s) => [s.text, s.weight])).toEqual([['bold', 700], [' & "q" ♥', undefined]]);
  });

  it('uses the id as the label and merges later statements into the first', () => {
    const model = parse('block\n  a b\n  a["Named"]\n  b(("x")) --> a');
    if (model.type !== 'block') throw new Error('not a block model');
    expect(model.blocks.map((b) => [b.id, b.label, b.type])).toEqual([['a', 'Named', 'square'], ['b', 'x', 'circle']]);
  });

  it('lets a block be called root', () => {
    const model = parse('block\n  root leaf\n  root --> leaf');
    if (model.type !== 'block') throw new Error('not a block model');
    expect(model.blocks.map((b) => b.id)).toEqual(['root', 'leaf']);
    expect(layoutOf('block\n  root leaf').size).toBe(2);
  });

  it('rejects a column count of zero the way Mermaid does', () => {
    expect(() => draw('block\n  columns 0\n  a b')).toThrow('Columns must be an integer !== 0.');
    expect(() => draw('block\n  columns 0\n  a b')).toThrow(PeleError);
    expect(picture(draw('block\n  columns auto\n  a b').scene)).toBe(picture(draw('block\n  a b').scene));
  });

  it('rejects what the grammar rejects', () => {
    for (const src of ['block', 'block\n', 'block\n  a - b', 'block\n  a[label]', 'block\n  block\n  a', 'block\n  a\n  end', 'block\n  default', 'block\n  accTitle: t\n  a']) {
      expect(() => parse(src), src).toThrow(PeleError);
    }
    expect(() => parse('block\n  a - b')).toThrow(/Lexical error on line 2/);
    expect(() => parse('block\n  a\n  end')).toThrow(/Parse error on line 3:[\s\S]*got 'end'/);
  });

  it('renders deep nesting without running out of stack', () => {
    const src = 'block\n' + 'block\n'.repeat(3000) + 'a\n' + 'end\n'.repeat(3000);
    const { scene } = draw(src, { limit: Infinity });
    expect(items(scene, 'pele-cluster')).toHaveLength(3000);
  });

  it('gives generated ids that do not change between runs', () => {
    const model = parse('block\n  a space:2\n  block\n    b\n  end');
    if (model.type !== 'block') throw new Error('not a block model');
    expect(model.blocks.map((b) => b.id)).toEqual(['a', 'id-1-0', 'id-1-1', 'id-2']);
  });
});
