import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports, type AgentflowModel } from '../../src/index.js';
import type { Scene, SceneItem, SceneShape } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, hasClass, itemById, items, lineOf, lines, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const fixtures = readdirSync('tests/compat/agentflow/upstream')
  .filter((name) => name.endsWith('.mmd'))
  .map((name) => readFileSync(`tests/compat/agentflow/upstream/${name}`, 'utf8'));
const corpus = [...new Set([...loadCorpus('agentflow', /agentflow-beta/), ...fixtures])];

const sceneOf = (src: string): Scene => draw(src).scene;
const modelOf = (src: string): AgentflowModel => parse(src) as AgentflowModel;
const series = (n: number): string => `var(--pele-series-${n},`;

// Where a source put a part moves with the lines the front matter and comments take; the drawing does not.
const drawn = (src: string): string => JSON.stringify(sceneOf(src), (key, value) => (['line', 'end', 'from', 'to', 'symbol'].includes(key) ? undefined : value));

// A path is op codes, each followed by its arguments: M, L, C, Q, A, Z.
const ARGS = [2, 2, 6, 4, 7, 0];
function opsOf(shape: SceneShape): number[] {
  const ops: number[] = [];
  for (let i = 0; i < shape.cmds.length; i += 1 + ARGS[shape.cmds[i]]) ops.push(shape.cmds[i]);
  return ops;
}

interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
}

const placeOf = (item: SceneItem): Place => ({ x: item.box!.x0, y: item.box!.y0, w: item.box!.x1 - item.box!.x0, h: item.box!.y1 - item.box!.y0 });
const centre = (item: SceneItem): { x: number; y: number } => ({ x: item.box!.x0 + placeOf(item).w / 2, y: item.box!.y0 + placeOf(item).h / 2 });

const nodeItem = (scene: Scene, id: string): SceneItem => {
  const item = itemById(scene, id, 'pele-node');
  if (!item) throw new Error(`no node ${id}`);
  return item;
};

// The frame drawn for an open flow.
function frame(scene: Scene, id: string): Place & { item: SceneItem; shapes: SceneShape[] } {
  const item = itemById(scene, id, 'pele-flow');
  if (!item) throw new Error(`no flow ${id}`);
  return { ...placeOf(item), item, shapes: shapesOf(scene, item) };
}

const edges = (scene: Scene): SceneItem[] => items(scene, 'pele-edge');

// The first and last point of a straight edge.
function ends(scene: Scene, edge: SceneItem): number[] {
  const line = shapesOf(scene, edge).find((s) => s.kind === 'stroke')!;
  return [line.cmds[1], line.cmds[2], line.cmds[4], line.cmds[5]];
}

const inside = (n: { x: number; y: number }, f: Place): boolean => n.x > f.x && n.x < f.x + f.w && n.y > f.y && n.y < f.y + f.h;

describe('agentflow rendering', () => {
  it('renders every corpus input that parses, as a scene a host can take', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      const json = JSON.stringify(result.scene);
      expect(json, where).not.toContain('NaN');
      expect(json, where).not.toContain('undefined');
      expect(JSON.stringify(draw(src).scene), where).toBe(json);
    }
    expect(rendered).toBeGreaterThan(150);
  });

  it('is detected, supported and typed', () => {
    const src = 'agentflow-beta TB\n  a["A"] --> b["B"]';
    expect(detectType(src)).toBe('agentflow');
    expect(supports(src)).toBe(true);
    const result = draw(src);
    expect(result.type).toBe('agentflow');
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    const model = parse(src);
    expect(model.type).toBe('agentflow');
    if (model.type === 'agentflow') expect([...model.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('lays out along the declared direction', () => {
    const tall = draw('agentflow-beta TB\n  a --> b --> c');
    const wide = draw('agentflow-beta LR\n  a --> b --> c');
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
    const up = sceneOf('agentflow-beta BT\n  a --> b');
    expect(centre(nodeItem(up, 'a')).y).toBeGreaterThan(centre(nodeItem(up, 'b')).y);
    const back = sceneOf('agentflow-beta RL\n  a --> b');
    expect(centre(nodeItem(back, 'a')).x).toBeGreaterThan(centre(nodeItem(back, 'b')).x);
    const none = sceneOf('agentflow-beta\n  a --> b');
    expect(centre(nodeItem(none, 'b')).y).toBeGreaterThan(centre(nodeItem(none, 'a')).y);
  });

  it('draws each of the six shapes, and a connector, in the color of its kind', () => {
    const scene = sceneOf(
      'agentflow-beta LR\n  t["T"]@{ shape: task }\n  o["O"]@{ shape: tool }\n  i["I"]@{ shape: input }\n  d["D"]@{ shape: decision }\n  r["R"]@{ shape: refdoc }\n  c["C"]@{ shape: action }\n  connector k["K"]\n  plain'
    );
    const expected: [string, string, string, number][] = [
      ['o', 'fr-rect', 'tool', 1],
      ['t', 'rounded', 'task', 2],
      ['plain', 'rounded', 'task', 2],
      ['d', 'diam', 'decision', 3],
      ['i', 'lean-r', 'input', 4],
      ['r', 'lin-doc', 'refdoc', 5],
      ['k', 'rounded', 'connector', 6],
      ['c', 'hex', 'action', 7],
    ];
    for (const [id, shape, kind, slot] of expected) {
      const n = nodeItem(scene, id);
      expect(n.kind, id).toBe(`pele-node pele-shape-${shape} pele-kind-${kind}`);
      const [fill, stroke] = shapesOf(scene, n);
      expect(fill, id).toMatchObject({ kind: 'fill', opacity: 0.14 });
      expect(fill.paint, id).toContain(series(slot));
      expect(stroke, id).toMatchObject({ kind: 'stroke' });
      expect(stroke.paint, id).toContain(series(slot));
    }
    // A diamond is four corners; a tool has bars beside its box.
    expect(opsOf(shapesOf(scene, nodeItem(scene, 'd'))[0])).toEqual([0, 1, 1, 1, 5]);
    expect(shapesOf(scene, nodeItem(scene, 'o')).filter((s) => s.kind === 'stroke')).toHaveLength(2);
  });

  it('writes the bracket shapes agentflow removed as plain tasks and reports them', () => {
    const src = 'agentflow-beta TB\n  a((circle)) --> b([stadium]) --> c[(db)] --> d>odd] --> e(round)';
    const scene = sceneOf(src);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(nodeItem(scene, id).kind).toBe('pele-node pele-shape-rounded pele-kind-task');
    const model = modelOf(src);
    expect(model.diagnostics.map((d) => [d.id, d.severity, d.nodeId])).toEqual([
      ['SHAPE_REMOVED', 'error', 'a'],
      ['SHAPE_REMOVED', 'error', 'b'],
      ['SHAPE_REMOVED', 'error', 'c'],
      ['SHAPE_REMOVED', 'error', 'd'],
    ]);
    expect(model.diagnostics[0].message).toBe('shape "circle" was removed in v0.8.1, using "roundedRect"');
    expect(model.diagnostics[0].position).toMatchObject({ startLine: 2, startColumn: 2, endLine: 2 });
  });

  it('warns about a shape outside the catalogue and still draws the node', () => {
    const src = 'agentflow-beta TB\n  a["A"]\n  a@{ shape: "triangle" }\n  a --> b';
    const model = modelOf(src);
    expect(model.diagnostics).toEqual([
      {
        id: 'SHAPE_UNSUPPORTED',
        severity: 'warning',
        message: 'shape "triangle" is not supported, using "roundedRect"',
        nodeId: 'a',
        position: { startLine: 2, startColumn: 2, endLine: 2, endColumn: 8, startIndex: 0, endIndex: 0 },
      },
    ]);
    expect(nodeItem(sceneOf(src), 'a').kind).toContain('pele-shape-rounded');
    // Rendering the same model again does not report it twice.
    draw(src);
    expect(modelOf(src).diagnostics).toHaveLength(1);
  });

  it('draws the three edge kinds differently', () => {
    const scene = sceneOf('agentflow-beta TB\n  a --> b\n  a --x c\n  a -.- d\n  a -- "why" --> e');
    const all = edges(scene);
    expect(all.map((e) => e.kind)).toEqual([
      'pele-edge pele-edge-sequence',
      'pele-edge pele-edge-failure',
      'pele-edge pele-edge-reference',
      'pele-edge pele-edge-sequence',
    ]);
    // An arrowhead, a cross, and a dotted line with nothing on its end.
    const [arrow, cross, dotted] = all.map((e) => shapesOf(scene, e));
    expect(arrow.map((s) => s.kind)).toEqual(['stroke', 'fill']);
    expect(opsOf(arrow[1])).toEqual([0, 1, 1, 5]);
    expect(cross.map((s) => s.kind)).toEqual(['stroke', 'stroke']);
    expect(opsOf(cross[1])).toEqual([0, 1, 0, 1]);
    expect(dotted.map((s) => [s.kind, s.dash])).toEqual([['stroke', [3, 4]]]);
    const label = itemById(scene, 'L_a_e_0', 'pele-edge-label')!;
    expect(textsOf(scene, label).map(lineOf)).toEqual(['why']);
  });

  it('fans an edge out over every pair that an ampersand names', () => {
    const scene = sceneOf('agentflow-beta TB\n  a & b --> c & d');
    expect(edges(scene).map((e) => e.id)).toEqual(['L_a_c_0', 'L_a_d_0', 'L_b_c_0', 'L_b_d_0']);
  });

  it('draws a self-loop beside its node', () => {
    const scene = sceneOf('agentflow-beta TB\n  a["Alpha"]\n  a --> a');
    const all = edges(scene);
    expect(all).toHaveLength(1);
    expect(opsOf(shapesOf(scene, all[0])[0])).toEqual([0, 2]);
    expect(all[0].box!.x0).toBeGreaterThanOrEqual(nodeItem(scene, 'a').box!.x1 - 1);
  });

  it('frames a flow around its members, with its title', () => {
    const scene = sceneOf('agentflow-beta TB\n  flow team["Content Team"]\n    a["A"] --> b["B"]\n  end\n  c["C"]\n  b --> c');
    const team = frame(scene, 'team');
    expect(inside(centre(nodeItem(scene, 'a')), team)).toBe(true);
    expect(inside(centre(nodeItem(scene, 'b')), team)).toBe(true);
    expect(inside(centre(nodeItem(scene, 'c')), team)).toBe(false);
    expect(textsOf(scene, team.item).map(lineOf)).toEqual(['Content Team']);
    const [fill, stroke] = team.shapes;
    expect(stroke.paint).toContain(series(8));
    expect(fill.opacity).toBe(0.06);
  });

  it('nests flows, and gives a flow without a bracketed title no title', () => {
    const scene = sceneOf('agentflow-beta TB\n  flow outer["Outer"]\n    flow inner\n      a --> b\n    end\n    c\n  end');
    const outer = frame(scene, 'outer');
    const inner = frame(scene, 'inner');
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.y).toBeGreaterThan(outer.y);
    expect(inner.x + inner.w).toBeLessThan(outer.x + outer.w);
    expect(inner.y + inner.h).toBeLessThan(outer.y + outer.h);
    expect(inside(centre(nodeItem(scene, 'a')), inner)).toBe(true);
    expect(inside(centre(nodeItem(scene, 'c')), inner)).toBe(false);
    expect(inside(centre(nodeItem(scene, 'c')), outer)).toBe(true);
    expect(scene.texts.filter((t) => t.item >= 0 && hasClass(scene.items[t.item], 'pele-flow')).map(lineOf)).toEqual(['Outer']);
  });

  it('lays a flow out in its own direction', () => {
    const scene = sceneOf('agentflow-beta TB\n  flow f["F"]\n    direction LR\n    a --> b\n  end\n  f --> c');
    expect(centre(nodeItem(scene, 'b')).x).toBeGreaterThan(centre(nodeItem(scene, 'a')).x);
    expect(Math.abs(centre(nodeItem(scene, 'a')).y - centre(nodeItem(scene, 'b')).y)).toBeLessThan(1);
    expect(centre(nodeItem(scene, 'c')).y).toBeGreaterThan(centre(nodeItem(scene, 'b')).y);
  });

  it("ignores a flow's direction when its nodes link outside it", () => {
    const flows = 'agentflow-beta LR\nflow S\n direction TB\n s1\n s2\nend\nflow P\n direction TB\n p1\n p2\nend\n';
    const links = 's1 --> p2\ns2 --> p1\n';
    expect(drawn(flows + links)).toBe(drawn(flows.replace(/ direction TB\n/g, '') + links));
  });

  it('keeps a global node out of the flows that mention it', () => {
    const src = 'agentflow-beta TB\n  global\n    corpus["Shared"]@{ shape: refdoc }\n  end\n  flow one["One"]\n    a -.- corpus\n  end\n  flow two["Two"]\n    b -.- corpus\n  end';
    const scene = sceneOf(src);
    const corpusNode = centre(nodeItem(scene, 'corpus'));
    expect(inside(corpusNode, frame(scene, 'one'))).toBe(false);
    expect(inside(corpusNode, frame(scene, 'two'))).toBe(false);
    expect(items(scene, 'pele-flow')).toHaveLength(2);
    expect(modelOf(src).subgraphs.map((s) => s.nodes)).toEqual([['a'], ['b']]);
  });

  it('folds a collapsed flow into one node and reconnects its edges', () => {
    const src = 'agentflow-beta TB\n  in["In"] --> v\n  flow p["Processing"]\n    v["Validate"] --> e["Enrich"]\n  end\n  p@{ view: "collapsed" }\n  e --> out["Out"]';
    const scene = sceneOf(src);
    const p = nodeItem(scene, 'p');
    expect(p.kind).toBe('pele-node pele-shape-collapsed');
    expect(textsOf(scene, p).map(lineOf)).toEqual(['Processing']);
    // Besides its box, the node carries a dashed rule and a mark.
    expect(shapesOf(scene, p).some((s) => s.kind === 'stroke' && s.dash?.join() === '3,3')).toBe(true);
    expect(shapesOf(scene, p).every((s) => s.paint.includes(series(8)))).toBe(true);
    expect(itemById(scene, 'v')).toBeUndefined();
    expect(items(scene, 'pele-cluster')).toEqual([]);
    // The edge inside the flow is gone; the two that crossed its border end at the node.
    expect(edges(scene).map((e) => e.id)).toEqual(['L_in_v_0', 'L_e_out_0']);
    expect(centre(nodeItem(scene, 'p')).y).toBeGreaterThan(centre(nodeItem(scene, 'in')).y);
    expect(centre(nodeItem(scene, 'out')).y).toBeGreaterThan(centre(nodeItem(scene, 'p')).y);
  });

  it('numbers containers in the order they were written', () => {
    // With Mermaid's twelve colors the three would differ; with eight series tokens and seven
    // kinds there is one slot left for containers, which every one of them takes.
    const scene = sceneOf('agentflow-beta TB\n  flow one\n    flow two\n      a\n    end\n  end\n  flow three\n    b\n  end\n  three@{ view: collapsed }');
    for (const flow of ['one', 'two']) expect(frame(scene, flow).shapes[1].paint).toContain(series(8));
    expect(shapesOf(scene, nodeItem(scene, 'three'))[1].paint).toContain(series(8));
  });

  it('draws a container that two flows fight over once, and reports the dropped nesting', () => {
    const src = 'agentflow-beta TB\n  flow A["Flow A"]\n    a1 --> B\n  end\n  flow B["Flow B"]\n    b1 --> A\n  end';
    const scene = sceneOf(src);
    expect(scene.items.filter((i) => i.id === 'A')).toHaveLength(1);
    expect(scene.items.filter((i) => i.id === 'B')).toHaveLength(1);
    const diagnostics = modelOf(src).diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ id: 'CONTAINMENT_VIOLATION', severity: 'warning', nodeId: 'B' });
    expect(diagnostics[0].message).toBe(
      'Container "A" cannot contain "B" because "B" already contains it. The nesting that would close the loop is dropped.'
    );
  });

  it('runs an edge between a node and its own flow to the border of the flow', () => {
    const scene = sceneOf('agentflow-beta TB\n  flow f["My Flow"]\n    a["Task A"] --> b["Task B"]\n    b --> f\n    f --> a\n  end');
    const f = frame(scene, 'f');
    const [out, back] = edges(scene).slice(1).map((e) => ends(scene, e));
    const b = centre(nodeItem(scene, 'b'));
    const a = centre(nodeItem(scene, 'a'));
    // Out of the last task, down to the bottom border; in from the top border to the first task.
    expect(out[0]).toBe(b.x);
    expect(out[1]).toBe(b.y + 24);
    expect(out[3]).toBeGreaterThan(out[1]);
    expect(out[3]).toBeLessThan(f.y + f.h);
    expect(back[1]).toBe(f.y);
    expect(back[3]).toBeLessThan(a.y - 24);
    // Sideways when another node stands in the way.
    const blocked = sceneOf('agentflow-beta TB\n  flow f["My Flow"]\n    a["Task A"] --> b["Task B"]\n    a --> f\n  end');
    const side = ends(blocked, edges(blocked)[1]);
    expect(side[1]).toBe(centre(nodeItem(blocked, 'a')).y);
    expect(side[3]).toBe(side[1]);
    expect(side[2]).toBeLessThan(side[0]);
  });

  it('draws a front matter title above the diagram', () => {
    const plain = draw('agentflow-beta TB\n  a --> b');
    const titled = draw('---\ntitle: Release pipeline\n---\nagentflow-beta TB\n  a --> b');
    expect(titled.scene.texts.find((t) => lineOf(t) === 'Release pipeline')).toMatchObject({ weight: 700, item: -1 });
    expect(titled.height).toBeGreaterThan(plain.height);
  });


  it('applies classes, styles and link styles', () => {
    const scene = sceneOf(
      'agentflow-beta TB\n  classDef hot fill:#fdd,stroke:#c00,color:#900\n  a["A"]:::hot --> b["B"]\n  style b stroke-width:3px\n  linkStyle 0 stroke:#0a0'
    );
    const a = nodeItem(scene, 'a');
    expect(a.kind).toBe('pele-node pele-shape-rounded pele-kind-task hot');
    const [fill, stroke] = shapesOf(scene, a);
    // A fill the author chose is not washed out.
    expect(fill).toMatchObject({ kind: 'fill', paint: '#fdd', opacity: 1 });
    expect(stroke).toMatchObject({ kind: 'stroke', paint: '#c00' });
    expect(textsOf(scene, a).map((t) => t.paint)).toEqual(['#900']);
    const [bFill, bStroke] = shapesOf(scene, nodeItem(scene, 'b'));
    expect(bFill.opacity).toBe(0.14);
    expect(bStroke.width).toBe(3);
    expect(shapesOf(scene, itemById(scene, 'L_a_b_0', 'pele-edge')!).map((s) => s.paint)).toEqual(['#0a0', '#0a0']);
  });

  it('picks a contrasting label color on fills a style sets', () => {
    const scene = sceneOf(
      'agentflow-beta TB\n  flow f["Flow"]\n    a["A"] --> b["B"]\n  end\n  flow p["Packed"]\n    c["C"]\n  end\n  p@{ view: "collapsed" }\n  b --> d["D"]\n  style f fill:#FFF9C4\n  style a fill:#1f3a5f\n  style b fill:#1f3a5f,color:#eee\n  style p fill:navy'
    );
    const paint = (item: SceneItem): string => textsOf(scene, item)[0].paint;
    expect(paint(frame(scene, 'f').item)).toBe('var(--pele-fg-on-light,#1f1f1f)');
    expect(paint(nodeItem(scene, 'a'))).toBe('var(--pele-fg-on-dark,#fff)');
    expect(paint(nodeItem(scene, 'b'))).toBe('#eee');
    expect(paint(nodeItem(scene, 'p'))).toBe('var(--pele-fg-on-dark,#fff)');
    expect(paint(nodeItem(scene, 'd'))).not.toContain('--pele-fg-on');
  });

  it('cases edges that cross a flow fill a style sets and inks those inside it', () => {
    const src = 'agentflow-beta TB\n  flow f["Flow"]\n    a["A"] --> b["B"]\n  end\n  b --> c["C"]\n  c --> d["D"]\n  style f fill:#FFF9C4';
    const scene = sceneOf(src);
    const all = edges(scene);
    expect(all).toHaveLength(3);
    // A casing is drawn under an edge, in the page color and belonging to no part: a line and the head's two outlines.
    const casings = scene.shapes.filter((s) => s.item === -1 && s.paint === 'var(--_bg)');
    expect(casings.map((s) => s.kind)).toEqual(['stroke', 'fill', 'stroke']);
    const crossing = all[1].box!;
    for (const casing of casings) {
      expect(casing.box.y0).toBeGreaterThanOrEqual(crossing.y0 - 3);
      expect(casing.box.y1).toBeLessThanOrEqual(crossing.y1 + 3);
    }
    const ink = all.map((e) => shapesOf(scene, e)[0].paint);
    expect(ink).toEqual(['var(--pele-fg-on-light,#1f1f1f)', 'var(--_l)', 'var(--_l)']);
    const plain = sceneOf(src.replace('\n  style f fill:#FFF9C4', ''));
    expect(plain.shapes.filter((s) => s.item === -1)).toEqual([]);
    expect(JSON.stringify(plain)).not.toContain('--pele-fg-on');
    // An edge from a flow to a node inside it starts on the flow's border and stays on its fill.
    const held = sceneOf('agentflow-beta TB\n  flow f[Flow]\n    a[A]\n  end\n  f --> a\n  style f fill:white');
    expect(shapesOf(held, edges(held)[0])[0].paint).toBe('var(--pele-fg-on-light,#1f1f1f)');
    expect(held.shapes.filter((s) => s.item === -1)).toEqual([]);
  });

  it('links a clicked node and never writes a callback', () => {
    const { scene, links } = draw('agentflow-beta TB\n  a --> b\n  click a href "https://example.com/x" "Open it" _blank\n  click b call doIt()');
    expect(links).toEqual([{ id: 'a', href: 'https://example.com/x', internal: false }]);
    expect(nodeItem(scene, 'b').kind).toContain('clickable');
    expect(JSON.stringify(scene)).not.toContain('doIt');
  });

  it('wraps long labels and honors spacing options', () => {
    const long = sceneOf('agentflow-beta TB\n  a["A fairly long label that has to wrap over several lines to fit"]');
    expect(textsOf(long, nodeItem(long, 'a')).length).toBeGreaterThan(1);
    const src = 'agentflow-beta TB\n  a --> b';
    const wide = '---\nconfig:\n  agentflow:\n    rankSpacing: 150\n---\n' + src;
    expect(draw(wide).height).toBeGreaterThan(draw(src).height + 80);
  });

  it('gives nodes with short labels a common width, except a decision', () => {
    const width = (scene: Scene, id: string): number => placeOf(nodeItem(scene, id)).w;
    const src = 'agentflow-beta TB\n  a["A"] --> b["Beta"]@{ shape: tool }\n  b --> d{"ok?"}';
    const scene = sceneOf(src);
    expect(width(scene, 'a')).toBe(156);
    expect(width(scene, 'b')).toBeGreaterThan(156);
    expect(width(scene, 'b')).toBeLessThan(180);
    expect(width(scene, 'd')).toBeLessThan(156);
    const narrow = sceneOf('---\nconfig:\n  agentflow:\n    minNodeWidth: 10\n---\n' + src);
    expect(width(narrow, 'a')).toBeLessThan(60);
  });

  it('reads metadata without drawing it', () => {
    const src = 'agentflow-beta TB\n  a["A"]@{ shape: tool, params: "city :: String", retry: 2 }\n  a e1@--> b\n  e1@{ instruction: "hand off" }';
    const text = lines(sceneOf(src)).join('\n');
    expect(text).not.toContain('String');
    expect(text).not.toContain('hand off');
    const model = modelOf(src);
    expect(model.nodes.get('a')?.metadata).toEqual({ shape: 'subroutine', params: 'city :: String', retry: 2 });
    expect(model.edges[0].metadata).toEqual({ instruction: 'hand off' });
    expect(model.semanticModel().vertices[0]).toEqual({
      id: 'a',
      label: 'A',
      shape: 'subroutine',
      vertexKind: 'tool',
      metadata: { params: 'city :: String', retry: 2 },
    });
  });

  it('skips an edge to the id Mermaid reserves and creates no node for', () => {
    const scene = sceneOf('agentflow-beta TB\n  connectors["Mine"] --> b');
    expect(itemById(scene, 'connectors')).toBeUndefined();
    expect(edges(scene)).toHaveLength(0);
    expect(nodeItem(scene, 'b').kind).toContain('pele-kind-task');
  });

  it('reports positions in the lines of the original source', () => {
    // Front matter fills lines 1 to 5 and a comment line 7, so `alpha` is on line 8.
    const src = '---\nconfig:\n  agentflow:\n    nodeSpacing: 40\n---\nagentflow-beta TB\n  %% a comment that occupies a line\n  alpha["Alpha"]\n  beta["Beta"]\n  alpha --> beta';
    const model = modelOf(src);
    const alpha = model.mappings.find((m) => m.id === 'alpha');
    expect(alpha).toEqual({
      id: 'alpha',
      type: 'vertex',
      position: { startLine: 8, startColumn: 2, endLine: 8, endColumn: 16, startIndex: 0, endIndex: 0 },
    });
    expect(model.mappings.find((m) => m.type === 'edge')?.position).toMatchObject({ startLine: 10, endLine: 10 });
    expect(itemById(sceneOf(src), 'alpha')).toBeDefined();
    expect(() => draw('---\ntitle: T\n---\nagentflow-beta TB\n  a@{ shape: rounded }  \n  b -.-> c')).toThrow(
      expect.objectContaining({ line: 6, column: 8 })
    );
    const metadata = '%%{init:\n{}\n}%%\nagentflow-beta\na["#35;"] --> b@{shape: ';
    expect(() => parse(metadata + 'bad}')).toThrow(expect.objectContaining({ code: 'semantic', line: 5, column: 16 }));
    expect(() => parse(metadata + '[bad}')).toThrow(expect.objectContaining({ code: 'syntax', line: 5, column: 16, message: expect.stringMatching(/\(5:16\)$/) }));
  });

  it('maps a flow from its keyword to its end, and a metadata block as an attachment', () => {
    const model = modelOf('agentflow-beta TB\n  flow f["F"]\n    a["A"]\n  end\n  f@{ view: collapsed }\n  connector k["K"]');
    expect(model.mappings.map((m) => [m.id, m.type, m.position.startLine, m.position.endLine])).toEqual([
      ['a', 'vertex', 3, 3],
      ['f', 'subgraph', 2, 4],
      ['f', 'attachment', 5, 5],
      // A connector's span runs through the line break that ends it, as in Mermaid.
      ['k', 'connector', 6, 7],
    ]);
  });

  it('reads comments wherever Mermaid does', () => {
    const src = '%% before the keyword\nagentflow-beta TB %% after the direction\n  a[Plain %% not part of the label\nlabel] --> b %% after a statement\n  %% a line of its own\n  b --> c';
    const model = modelOf(src);
    expect(model.nodes.get('a')?.text).toBe('Plain \nlabel');
    expect(model.edges).toHaveLength(2);
    expect(textOf(sceneOf(src))).not.toContain('not part');
  });

  it('rejects what the grammar rejects, with the line', () => {
    const fails = (src: string): PeleError => {
      try {
        draw(src);
      } catch (error) {
        expect(error).toBeInstanceOf(PeleError);
        return error as PeleError;
      }
      throw new Error('expected a failure');
    };
    const open = fails('agentflow-beta TB\n  flow orphan["Orphan"]\n    a --> b');
    expect(fails('agentflow-beta TB\n  flow f["F"]\n    a --> b\n\n%% trailing\n')).toMatchObject({ line: 3, column: 12 });
    expect(open.code).toBe('syntax');
    expect(open.message).toMatch(/^Parse error on line \d+:/);
    expect(open.message).toContain("Expecting 'end', got '$end'");
    // Jison drops the lone percent sign from Mermaid's label pattern.
    expect(fails('agentflow-beta TB\n  a[50% off]').message).toMatch(/^Lexical error on line 2/);
    expect(fails('agentflow-beta TB\n  a ==> b').message).toMatch(/^Lexical error on line 2/);
    expect(fails('agentflow-beta TB\n  a -.-> b').message).toMatch(/^Parse error on line 2/);
    expect(fails('agentflow-beta TB\n  subgraph s\n  a\n  end').message).toMatch(/^Parse error on line 2/);
    expect(fails('agentflow-beta TB\n  a@{ label: a^b }').message).toMatch(/^Lexical error on line 2/);
  });

  it('rejects an unknown shape and unreadable metadata, pointing at the block', () => {
    const fails = (src: string): PeleError => {
      try {
        parse(src);
      } catch (error) {
        return error as PeleError;
      }
      throw new Error('expected a failure');
    };
    const shape = fails('---\ntitle: T\n---\nagentflow-beta TB\n  a["A"]@{ shape: Rounded }');
    expect(shape).toBeInstanceOf(PeleError);
    expect(shape.code).toBe('semantic');
    expect(shape.message).toBe('No such shape: Rounded. Shape names should be lowercase.');
    expect([shape.line, shape.column]).toEqual([5, 9]);
    expect(fails('agentflow-beta TB\n  a@{ shape: nope }').message).toBe('No such shape: nope.');
    expect(fails('agentflow-beta TB\n  a@{ shape: 123 }').message).toBe('No such shape: 123.');

    const yaml = fails('agentflow-beta TB\n  b["B"]\n  a["A"]@{\n\tshape: rounded\n  }');
    expect(yaml).toBeInstanceOf(PeleError);
    expect(yaml.code).toBe('syntax');
    expect(yaml.message).toMatch(/^Metadata of "a" is not valid YAML\. .* \(3:9\)$/);
    expect([yaml.line, yaml.column]).toEqual([3, 9]);
  });

  it('accepts trailing commas in a multi-line metadata block', () => {
    const model = modelOf('agentflow-beta TB\n  connector gh["GitHub"]@{\n    protocol: "mcp",\n    tools: ["read",\n      "write"],\n  }');
    expect(model.connectors.get('gh')?.metadata).toEqual({ protocol: 'mcp', tools: ['read', 'write'] });
  });

  it('strips prototype-shaped keys from metadata at every depth', () => {
    const model = modelOf('agentflow-beta TB\n  a@{\n    __proto__:\n      polluted: true\n    params:\n      - constructor: x\n        name: first\n    kept: 1\n  }');
    expect(JSON.stringify(model.nodes.get('a')?.metadata)).toBe('{"params":[{"name":"first"}],"kept":1}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
