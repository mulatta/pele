import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { MindmapModel } from '../../src/index.js';
import type { Box, Scene } from '../../src/draw/scene.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { random } from '../support/corpus.js';
import { draw, itemById, items, lineOf, lines, overlaps, sceneProblem, shapesOf, textOf, textsOf } from '../support/scene.js';

interface Node {
  id: string;
  // Where the node's centre is, and how far it reaches.
  x: number;
  y: number;
  box: Box;
}

// Every node here is drawn as a rectangle, so the area of its item is its bounding box.
function boxes(scene: Scene): Node[] {
  return items(scene, 'pele-node').map((i) => ({ id: i.id, x: (i.box!.x0 + i.box!.x1) / 2, y: (i.box!.y0 + i.box!.y1) / 2, box: i.box! }));
}

function model(src: string): MindmapModel {
  return parse(src) as MindmapModel;
}

describe('mindmap rendering', () => {
  it('draws a node per line and a link per child', () => {
    const { scene, type, links } = draw('mindmap\n  root((Center))\n    A\n      A1\n      A2\n    B');
    expect(type).toBe('mindmap');
    expect(supports('mindmap\n  root')).toBe(true);
    expect(links).toEqual([]);
    expect(items(scene, 'pele-node')).toHaveLength(5);
    expect(scene.shapes.filter((h) => h.item === -1)).toHaveLength(4);
    expect(lines(scene).sort()).toEqual(['A', 'A1', 'A2', 'B', 'Center']);
    expect(itemById(scene, 'root')).toBeDefined();
  });

  it('maps each pair of delimiters to its shape', () => {
    const { scene } = draw('mindmap\n  root\n    a[Square]\n    b(Rounded)\n    c((Circle))\n    d))Bang((\n    e)Cloud(\n    f{{Hexagon}}\n    Plain');
    for (const [id, shape] of [['root', 'stadium pele-root'], ['a', 'rect'], ['b', 'rounded'], ['c', 'circle'], ['d', 'bang'], ['e', 'cloud'], ['f', 'hex'], ['Plain', 'text']]) {
      expect(itemById(scene, id)!.kind, shape).toBe(`pele-node pele-shape-${shape}`);
    }
    const nodes = model('mindmap\n  root\n    a[x)\n    b(x]\n    c(-x-)\n    -)x(-').nodes;
    expect(nodes.map((node) => node.type)).toEqual([0, 2, 4, 0, 0]);
  });

  it('colors each first-level branch and keeps the root neutral', () => {
    const { scene } = draw('mindmap\n  [root]\n    [a]\n      [a1]\n    [b]\n    [c]');
    const SERIES = /^var\(--pele-series-(\d),/;
    const series = (paint: string): string | undefined => SERIES.exec(paint)?.[1];
    expect(shapesOf(scene, itemById(scene, 'root')!).map((h) => h.paint)).toEqual(['var(--_s)', 'var(--_b)']);
    // The links to a branch's nodes are drawn in its color.
    expect(scene.shapes.filter((h) => h.item === -1).map((h) => series(h.paint))).toEqual(['1', '1', '2', '3']);
    // A shaped node is filled with a tint of its branch's color, as a pill is, and outlined in that color.
    for (const [id, n] of [['a1', '1'], ['b', '2'], ['c', '3']]) {
      const [fill, stroke] = shapesOf(scene, itemById(scene, id)!);
      expect([series(fill.paint), fill.opacity, series(stroke.paint)], id).toEqual([n, 0.22, n]);
    }
    // So is a pill, which the source gave no shape.
    const pill = draw('mindmap\n  root\n    a\n      b').scene;
    const [fill, stroke] = shapesOf(pill, itemById(pill, 'a', 'pele-shape-branch')!);
    expect([series(fill.paint), fill.opacity, series(stroke.paint)]).toEqual(['1', 0.22, '1']);
  });

  it('wraps section numbers after eleven branches, as Mermaid does', () => {
    const src = 'mindmap\n  root\n' + Array.from({ length: 13 }, (_, i) => `    b${i}\n      leaf${i}\n`).join('');
    const nodes = model(src).nodes;
    expect(nodes.find((node) => node.nodeId === 'b10')?.section).toBe(10);
    expect(nodes.find((node) => node.nodeId === 'b11')?.section).toBe(0);
    expect(nodes.find((node) => node.nodeId === 'leaf12')?.section).toBe(1);
    expect(nodes[0].section).toBeUndefined();
  });

  it('puts branches on both sides of the root, balanced by height', () => {
    const src = 'mindmap\n  [root]\n    [a]\n      [a1]\n      [a2]\n      [a3]\n    [b]\n    [c]\n    [d]';
    const all = boxes(draw(src).scene);
    const at = (id: string): Node => all.find((node) => node.id === id)!;
    expect(at('a').x).toBeGreaterThan(at('root').x);
    expect(at('a1').x).toBeGreaterThan(at('a').x);
    for (const id of ['b', 'c', 'd']) expect(at(id).x).toBeLessThan(at('root').x);
    expect(at('a1').y).toBeLessThan(at('a2').y);
    expect(at('a2').y).toBeCloseTo(at('a').y, 1);
    expect(at('b').y).toBeLessThan(at('c').y);
    expect(at('c').y).toBeCloseTo(at('root').y, 1);

    const single = boxes(draw('mindmap\n  [root]\n    [a]\n      [b]').scene);
    expect(single.map((node) => node.id)).toEqual(['a', 'b', 'root']);
    expect(single[2].x).toBeLessThan(single[0].x);
    expect(single[0].x).toBeLessThan(single[1].x);
  });

  it('keeps branch sides when a growing final branch reaches a balanced tie', () => {
    const start = 'mindmap\n  [root]\n    [Build]\n      [Prototype]\n      [Iterate]\n    [Review]\n      [Test]\n      [Refine]';
    for (const tail of ['', '\n    [Ship]', '\n    [Ship]\n      [Launch]', '\n    [Ship]\n      [Launch]\n      [Learn]']) {
      const all = boxes(draw(start + tail).scene);
      const x = (id: string): number => all.find((node) => node.id === id)!.x;
      expect(x('Build')).toBeGreaterThan(x('root'));
      expect(x('Review')).toBeLessThan(x('root'));
      if (tail) expect(x('Ship')).toBeLessThan(x('root'));
    }
  });

  it('never overlaps nodes', () => {
    const rnd = random(11);
    for (let round = 0; round < 30; round++) {
      let src = 'mindmap\n[n0]\n';
      let depth = 1;
      const count = 2 + Math.floor(rnd() * 60);
      for (let i = 1; i < count; i++) {
        depth = Math.max(1, Math.min(depth + 1, 1 + Math.floor(rnd() * (depth + 1))));
        const label = 'word '.repeat(1 + Math.floor(rnd() * 12)).trim();
        src += `${' '.repeat(depth)}n${i}[${label}]\n`;
      }
      const all = boxes(draw(src).scene);
      expect(all.length).toBe(count);
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          expect(overlaps(all[i].box, all[j].box), `${all[i].id} and ${all[j].id} in ${JSON.stringify(src)}`).toBe(false);
        }
      }
    }
  });

  it('follows Mermaid on unclear indentation', () => {
    const nodes = model('mindmap\nRoot\n    A\n        B\n      C\n   D').nodes;
    const a = nodes[1];
    expect(a.children.map((node) => node.nodeId)).toEqual(['B', 'C']);
    expect(nodes[0].children.map((node) => node.nodeId)).toEqual(['A', 'D']);
    expect(nodes.map((node) => node.level)).toEqual([0, 4, 8, 6, 3]);
  });

  it('rejects a second root with Mermaid\'s message', () => {
    const second = (): unknown => draw('mindmap\n  root\n  other');
    expect(second).toThrow(PeleError);
    expect(second).toThrow('There can be only one root. No parent could be found for ("other")');
    expect(() => draw('mindmap\n    root\n  shallower')).toThrow(/only one root/);
  });

  it('ignores a decoration that comes before any node', () => {
    expect(lines(draw('mindmap\n::icon(fa fa-book)\n:::big\nroot').scene)).toEqual(['root']);
  });

  it('draws icons and applies classes', () => {
    const src = 'mindmap\n  root\n    A\n    ::icon(fa fa-book)\n    :::urgent large\n    B';
    const plain = draw(src);
    expect(itemById(plain.scene, 'A')!.kind).toBe('pele-node pele-shape-text urgent large');
    expect(shapesOf(plain.scene, itemById(plain.scene, 'A')!)).toEqual([]);
    expect(plain.width).toBe(draw('mindmap\n  root\n    A\n    B').width);
    const drawn = draw(src, { icons: (name: string) => (name === 'fa fa-book' ? '<path d="M0,0H24"/>' : null) });
    expect(shapesOf(drawn.scene, itemById(drawn.scene, 'A')!).map((h) => h.paint)).toEqual(['var(--_fg)']);
    expect(drawn.width).toBeGreaterThan(plain.width);
  });

  it('formats markdown and breaks lines', () => {
    const { scene } = draw('mindmap\n  id1["`**Root** with\na second line`"]\n    id2[One<br/>Two]\n    id3[*emphasis*]');
    const spans = (id: string) => textsOf(scene, itemById(scene, id)!).map((t) => t.spans);
    expect(spans('id1')).toEqual([[{ text: 'Root', weight: 700, weightVar: '--_w' }, { text: ' with' }], [{ text: 'a second line' }]]);
    expect(spans('id2')).toEqual([[{ text: 'One' }], [{ text: 'Two' }]]);
    expect(spans('id3')).toEqual([[{ text: 'emphasis', italic: true }]]);
  });

  it('wraps long text at maxNodeWidth', () => {
    const body = 'mindmap\n  root[' + 'several words that go on '.repeat(4) + ']';
    const normal = draw(body);
    const narrow = draw('---\nconfig:\n  mindmap:\n    maxNodeWidth: 80\n---\n' + body);
    expect(normal.width).toBeLessThan(260);
    expect(narrow.width).toBeLessThan(normal.width);
    expect(narrow.height).toBeGreaterThan(normal.height);
  });

  it('keeps a trailing comment out of a shaped node but not out of a bare one', () => {
    expect(model('mindmap\n  root(Root) %% note\n    a').nodes[0].descr).toBe('Root');
    expect(model('mindmap\n  root %% note\n    a').nodes[0].descr).toBe('root %% note');
  });

  it('draws the front matter title', () => {
    const plain = draw('mindmap\n  root\n    A');
    const titled = draw('---\ntitle: Plans\n---\nmindmap\n  root\n    A');
    const title = titled.scene.texts.find((t) => lineOf(t) === 'Plans')!;
    expect([title.item, title.weight]).toEqual([-1, 700]);
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it('renders a mindmap with no nodes and one with only a root', () => {
    const empty = draw('mindmap\n\n').scene;
    expect([empty.items, empty.texts, empty.shapes]).toEqual([[], [], []]);
    expect(items(draw('mindmap\nroot').scene, 'pele-node')).toHaveLength(1);
  });

  it('sets the levels apart: a pill for a node that branches, plain text for one that ends a branch', () => {
    const { scene } = draw('mindmap\n  root\n    Plan\n      Research\n        Read\n        Ask\n      Build\n    Ship');
    const kind = (id: string): string => itemById(scene, id)!.kind;
    expect(kind('Plan')).toContain('pele-shape-branch');
    expect(kind('Research')).toContain('pele-shape-branch');
    for (const leaf of ['Read', 'Ask', 'Build', 'Ship']) expect(kind(leaf), leaf).toContain('pele-shape-text');
    const [fill, stroke] = shapesOf(scene, itemById(scene, 'Plan')!);
    expect([fill.opacity, fill.paint.startsWith('var(--pele-series-'), stroke.paint.startsWith('var(--pele-series-')]).toEqual([0.22, true, true]);
    expect(shapesOf(scene, itemById(scene, 'Read')!)).toEqual([]);
    // Nodes on one level start at the same place, whatever their length.
    const centre = (id: string): number => textsOf(scene, itemById(scene, id)!)[0].x;
    const side = Math.sign(centre('Read') - centre('Research'));
    expect(side).not.toBe(0);
    const near = (id: string): number => centre(id) - (side * (metricsMeasurer.width(id, 16, 0) + 12)) / 2;
    expect(near('Read')).toBeCloseTo(near('Ask'), 1);
  });

  it('is deterministic and emits only finite numbers', () => {
    const src = 'mindmap\n  root((mindmap))\n    Origins\n      Long history\n      ::icon(fa fa-book)\n    Research\n      On effectiveness<br/>and features\n    Tools\n      Pen and paper';
    const first = draw(src);
    expect(JSON.stringify(draw(src).scene)).toBe(JSON.stringify(first.scene));
    expect(sceneProblem(first)).toBeUndefined();
    expect(textOf(first.scene)).not.toMatch(/NaN|Infinity|undefined/);
  });
});
