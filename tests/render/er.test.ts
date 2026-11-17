import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import { parseGenericTypes as genericTypes } from '../../src/diagrams/common/generics.js';
import type { Box, Scene, SceneItem, SceneShape, SceneText } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, itemById, items, lineOf, lines, paints, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('er', /erDiagram/);

const sceneOf = (src: string): Scene => draw(src).scene;
const same = (a: Scene, b: Scene): boolean => JSON.stringify(a) === JSON.stringify(b);

// An entity's box.
const box = (scene: Scene, name: string): Box => itemById(scene, name, 'pele-entity')!.box!;
const entity = (scene: Scene, name: string): SceneItem => itemById(scene, name, 'pele-entity')!;

const edgeItems = (scene: Scene): SceneItem[] => items(scene, 'pele-edge');

// Arguments after each path op code, as the scene's paths are written.
const ARGC = [2, 2, 6, 4, 7, 0];

// The op codes of a path: M 0, L 1, C 2, Q 3, A 4, Z 5.
function ops(cmds: number[]): string {
  let out = '';
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) out += cmds[i];
  return out;
}

const isRing = (shape: SceneShape): boolean => ops(shape.cmds) === '0445';

// The line of an edge is the first thing it draws; the markers follow.
const lineOfEdge = (scene: Scene, edge: SceneItem): number[] => shapesOf(scene, edge)[0].cmds;

// Where a line starts and ends.
function ends(cmds: number[]): [number, number, number, number] {
  return [cmds[1], cmds[2], cmds[cmds.length - 2], cmds[cmds.length - 1]];
}

// The attribute texts of an entity, in columns: the texts that start at the same x.
function columns(scene: Scene, name: string): SceneText[][] {
  const byX = new Map<number, SceneText[]>();
  for (const t of textsOf(scene, entity(scene, name))) {
    if (t.anchor !== 'start') continue;
    byX.set(t.x, [...(byX.get(t.x) ?? []), t]);
  }
  return [...byX.entries()].sort(([a], [b]) => a - b).map(([, texts]) => texts);
}

// The fills of an entity that shade its alternate rows.
const stripes = (scene: Scene, name: string): SceneShape[] =>
  shapesOf(scene, entity(scene, name)).filter((s) => s.kind === 'fill' && s.box.y1 - s.box.y0 > 1 && s.box.y0 > box(scene, name).y0 + 1);

describe('ER diagram rendering', () => {
  it('renders every corpus input that parses, as a scene a host can take', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      expect(textOf(result.scene), where).not.toMatch(/NaN|undefined/);
      expect(tryDraw(src)!.scene, where).toEqual(result.scene);
    }
    expect(rendered).toBeGreaterThan(90);
  });

  it('is detected, supported and typed', () => {
    const src = 'erDiagram\n  A ||--o{ B : has';
    expect(detectType(src)).toBe('er');
    expect(supports(src)).toBe(true);
    expect(draw(src).type).toBe('er');
    const model = parse(src);
    expect(model.type).toBe('er');
    if (model.type === 'er') expect([...model.entities.keys()]).toEqual(['A', 'B']);
  });

  it('lays out along the declared direction', () => {
    const tall = draw('erDiagram\n  A ||--o{ B : x\n  B ||--o{ C : y');
    const wide = draw('erDiagram\n  direction LR\n  A ||--o{ B : x\n  B ||--o{ C : y');
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
    const up = sceneOf('erDiagram\n  direction BT\n  A ||--o{ B : x');
    expect(box(up, 'A').y0).toBeGreaterThan(box(up, 'B').y0);
    const back = sceneOf('erDiagram\n  direction RL\n  A ||--o{ B : x');
    expect(box(back, 'A').x0).toBeGreaterThan(box(back, 'B').x0);
  });

  it('draws an entity without attributes as a plain box', () => {
    const scene = sceneOf('erDiagram\n  ISLAND');
    // Its inside and its outline, and nothing for attribute rows.
    expect(shapesOf(scene, entity(scene, 'ISLAND')).map((s) => s.kind)).toEqual(['fill', 'stroke']);
    expect(lines(scene)).toEqual(['ISLAND']);
  });

  it('draws the attribute table with aligned columns', () => {
    const scene = sceneOf(
      'erDiagram\n  CAR {\n    string registrationNumber PK "The plate"\n    int wheels\n    string(99) make FK, UK\n    float? price "In euros"\n  }'
    );
    // Texts in a column start at one x, so a column is what the texts that share an x make.
    const [type, name, keys, comment] = columns(scene, 'CAR');
    expect(columns(scene, 'CAR')).toHaveLength(4);
    expect(type.map(lineOf)).toEqual(['string', 'int', 'string(99)', 'float?']);
    expect(name.map(lineOf)).toEqual(['registrationNumber', 'wheels', 'make', 'price']);
    expect(keys.map(lineOf)).toEqual(['PK', 'FK, UK']);
    expect(comment.map(lineOf)).toEqual(['The plate', 'In euros']);
    expect(type[0].x).toBeLessThan(name[0].x);
    expect(name[0].x).toBeLessThan(keys[0].x);
    expect(keys[0].x).toBeLessThan(comment[0].x);
  });

  it('measures attribute types, names and keys in the monospace font when monospace lists attributes', () => {
    const src = 'erDiagram\n  CAR {\n    string registrationNumber PK "The plate number, as issued by the registration office of the country"\n    int wheels FK, UK\n  }';
    const plain = draw(src);
    const mono = draw(src, { monospace: ['attributes'] });
    const mono0 = columns(mono.scene, 'CAR');
    const plain0 = columns(plain.scene, 'CAR');
    const [type, name, keys, comment] = mono0;
    for (const column of [type, name, keys]) expect(column.every((t) => t.spans.every((s) => s.mono === true))).toBe(true);
    for (const t of plain.scene.texts) expect(t.spans.some((s) => s.mono)).toBe(false);
    expect(comment.every((t) => t.spans.every((s) => s.mono !== true))).toBe(true);
    // The comment wraps the same either way.
    expect(comment.map(lineOf)).toEqual(plain0[3].map(lineOf));
    expect(comment).toHaveLength(2);
    expect(box(mono.scene, 'CAR').x1 - box(mono.scene, 'CAR').x0).toBeGreaterThan(box(plain.scene, 'CAR').x1 - box(plain.scene, 'CAR').x0);
    for (const label of ['`a  b`', '`<code>a  b</code>`']) {
      const spaced = draw(`erDiagram\n  A {\n    string ${label}\n  }`, { monospace: ['attributes'] }).scene;
      const cell = spaced.texts.find((t) => lineOf(t) === 'a  b')!;
      expect(cell.spans.every((s) => s.mono === true)).toBe(true);
    }
  });

  it('ignores monospace values that do not list attributes', () => {
    const src = 'erDiagram\n  CAR {\n    string registrationNumber PK "The plate"\n  }';
    const plain = sceneOf(src);
    for (const monospace of [[], ['attribute'], ['members'], 'attributes', { attributes: true }, true, null]) {
      expect(same(draw(src, { monospace } as object).scene, plain)).toBe(true);
    }
  });

  it("keeps an entity's own font-family on its attributes when monospace lists them", () => {
    for (const rule of ['style A color:black,font-family:serif', 'classDef serif color:black,font-family:serif\n  class A serif']) {
      const src = `erDiagram\n  A {\n    string name PK\n  }\n  B {\n    string name PK\n  }\n  ${rule}`;
      const attributes = (scene: Scene, name: string): SceneText[] => textsOf(scene, entity(scene, name)).filter((t) => t.anchor === 'start');
      const scene = draw(src, { monospace: ['attributes'] }).scene;
      const own = attributes(scene, 'A');
      const plain = attributes(sceneOf(src), 'A');
      expect(own.map((t) => [lineOf(t), t.spans.some((sp) => sp.mono)])).toEqual(plain.map((t) => [lineOf(t), false]));
      own.forEach((t, i) => expect(t.x).toBeCloseTo(plain[i].x, 1));
      expect(attributes(scene, 'B').every((t) => t.spans.every((s) => s.mono === true))).toBe(true);
    }
  });

  it('shades alternate rows and rounds the last one with the box', () => {
    const three = sceneOf('erDiagram\n  A {\n int a\n int b\n int c\n }');
    // Rows one and three; the third is the last, so it is drawn as a rounded part and a square part.
    expect(stripes(three, 'A')).toHaveLength(3);
    expect(stripes(three, 'A').filter((s) => ops(s.cmds).includes('4'))).toHaveLength(1);
    const two = sceneOf('erDiagram\n  A {\n int a\n int b\n }');
    expect(stripes(two, 'A')).toHaveLength(1);
  });

  it('keeps every row inside the box and every row the same height', () => {
    const scene = sceneOf('erDiagram\n  A {\n int a\n int b\n int c\n int d\n }');
    const { y0, y1 } = box(scene, 'A');
    const ys = columns(scene, 'A')[0].map((t) => t.y);
    expect(ys).toHaveLength(4);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBe(1);
    expect(ys[0]).toBeGreaterThan(y0);
    expect(ys[3]).toBeLessThan(y1);
  });

  it('shows the alias in place of the name', () => {
    const scene = sceneOf('erDiagram\n  p[Person] {\n string name\n }\n  a["Customer Account"]\n  p ||--o| a : has');
    expect(lines(scene)).toContain('Person');
    expect(lines(scene)).toContain('Customer Account');
    expect(lines(scene)).not.toContain('p');
    expect(entity(scene, 'p')).toBeDefined();
  });

  it('draws a marker for each cardinality at the right end', () => {
    // After the line: a stroke for each bar and crow's foot, and a ring (a fill and a stroke) for each zero.
    const shapes = (src: string): string[] => {
      const scene = sceneOf(src);
      return shapesOf(scene, edgeItems(scene)[0])
        .slice(1)
        .filter((s) => s.kind === 'stroke')
        .map((s) => (isRing(s) ? 'circle' : 'path'));
    };
    expect(shapes('erDiagram\n A ||--|| B : x')).toEqual(['path', 'path']);
    expect(shapes('erDiagram\n A |o--o| B : x')).toEqual(['path', 'circle', 'path', 'circle']);
    expect(shapes('erDiagram\n A }o--o{ B : x')).toEqual(['path', 'circle', 'path', 'circle']);
    expect(shapes('erDiagram\n A }|--|{ B : x')).toEqual(['path', 'path']);
    expect(shapes('erDiagram\n A ||--o{ B : x')).toEqual(['path', 'path', 'circle']);
    expect(shapes('erDiagram\n A u--|| B : x')).toEqual(['path', 'path']);
    // The ring of "zero or more" belongs to B, the far end of the line from A.
    const scene = sceneOf('erDiagram\n A ||--o{ B : x');
    const ring = shapesOf(scene, edgeItems(scene)[0]).find((s) => s.kind === 'fill')!.box;
    const y = (ring.y0 + ring.y1) / 2;
    const a = box(scene, 'A');
    const b = box(scene, 'B');
    expect(Math.abs(y - (b.y0 + b.y1) / 2)).toBeLessThan(Math.abs(y - (a.y0 + a.y1) / 2));
  });

  it('gives the word aliases the same markers as the symbols', () => {
    const markers = (src: string): string => {
      const scene = sceneOf(src);
      return JSON.stringify(shapesOf(scene, edgeItems(scene)[0]));
    };
    expect(markers('erDiagram\n A one or zero to one or more B : x')).toBe(markers('erDiagram\n A |o--|{ B : x'));
    expect(markers('erDiagram\n A only one to zero or many B : x')).toBe(markers('erDiagram\n A ||--o{ B : x'));
    expect(markers('erDiagram\n A 1 optionally to many(1) B : x')).toBe(markers('erDiagram\n A ||..|{ B : x'));
    expect(markers('erDiagram\n A zero or one to 0+ B : x')).toBe(markers('erDiagram\n A |o--o{ B : x'));
    expect(markers('erDiagram\n A 1+ to many(0) B : x')).toBe(markers('erDiagram\n A }|--o{ B : x'));
  });

  it('draws identifying lines solid and non-identifying lines dashed', () => {
    const solid = sceneOf('erDiagram\n A ||--|| B : x');
    const dashed = sceneOf('erDiagram\n A ||..|| B : x');
    expect(items(solid, 'pele-er-identifying')).toHaveLength(1);
    expect(solid.shapes.some((s) => s.dash)).toBe(false);
    expect(items(dashed, 'pele-er-non-identifying')).toHaveLength(1);
    expect(dashed.shapes.filter((s) => s.dash)).toHaveLength(1);
  });

  it('runs each line all the way to both boxes', () => {
    for (const dir of ['TB', 'BT', 'LR', 'RL']) {
      const scene = sceneOf(`erDiagram\n direction ${dir}\n A ||--o{ B : x`);
      const [sx, sy, ex, ey] = ends(lineOfEdge(scene, edgeItems(scene)[0]));
      const onBorder = (x: number, y: number, e: Box): boolean =>
        ((Math.abs(x - e.x0) < 0.02 || Math.abs(x - e.x1) < 0.02) && y >= e.y0 - 0.02 && y <= e.y1 + 0.02) ||
        ((Math.abs(y - e.y0) < 0.02 || Math.abs(y - e.y1) < 0.02) && x >= e.x0 - 0.02 && x <= e.x1 + 0.02);
      expect(onBorder(sx, sy, box(scene, 'A')), `${dir} start`).toBe(true);
      expect(onBorder(ex, ey, box(scene, 'B')), `${dir} end`).toBe(true);
    }
  });

  it('spaces out the lines that meet one side of an entity', () => {
    const scene = sceneOf('erDiagram\n A ||--o{ B : x\n A ||--o{ C : y\n A ||--o{ D : z');
    const starts = edgeItems(scene).map((e) => ends(lineOfEdge(scene, e))[0]);
    expect(new Set(starts).size).toBe(3);
    const sorted = [...starts].sort((p, q) => p - q);
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(12);
    const a = box(scene, 'A');
    for (const x of starts) expect(x).toBeGreaterThan(a.x0);
    for (const x of starts) expect(x).toBeLessThan(a.x1);
  });

  it('labels relationships and leaves an empty label out', () => {
    const scene = sceneOf('erDiagram\n A ||--o{ B : "places an order"\n B ||--o{ C : ""');
    expect(items(scene, 'pele-edge-label')).toHaveLength(1);
    expect(lines(scene)).toContain('places an order');
    expect(edgeItems(scene)).toHaveLength(2);
  });

  it('draws a relationship from an entity to itself as a loop with both markers', () => {
    const scene = sceneOf('erDiagram\n EMPLOYEE ||--o{ EMPLOYEE : manages');
    const [edge] = edgeItems(scene);
    const [sx, sy, ex, ey] = ends(lineOfEdge(scene, edge));
    const e = box(scene, 'EMPLOYEE');
    const middle = (e.y0 + e.y1) / 2;
    expect(sx).toBeCloseTo(e.x1, 1);
    expect(ex).toBeCloseTo(e.x1, 1);
    expect(sy).toBeLessThan(middle);
    expect(ey).toBeGreaterThan(middle);
    expect(ey).toBeLessThan(e.y1);
    // The bar and the crow's foot, and the ring.
    expect(shapesOf(scene, edge).slice(1).filter((s) => s.kind === 'stroke')).toHaveLength(3);
    expect(lines(scene)).toContain('manages');
  });

  it('loops out of the bottom when ranks run across, and stacks several loops', () => {
    const scene = sceneOf('erDiagram\n direction LR\n A ||--o{ A : self\n A ||--o{ B : x');
    const loop = edgeItems(scene).find((e) => ops(lineOfEdge(scene, e)).includes('2'))!;
    const [sx, sy, ex, ey] = ends(lineOfEdge(scene, loop));
    const a = box(scene, 'A');
    expect(sy).toBeCloseTo(a.y1, 1);
    expect(ey).toBeCloseTo(a.y1, 1);
    expect(sx).toBeGreaterThan(a.x0);
    expect(ex).toBeLessThan(a.x1);

    const two = sceneOf('erDiagram\n A ||--o{ A : first\n A |o--|| A : second');
    const ys = edgeItems(two).map((e) => lineOfEdge(two, e)[2]);
    const e = box(two, 'A');
    expect(ys).toHaveLength(2);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(30);
    for (const y of ys) {
      expect(y).toBeGreaterThan(e.y0);
      expect(y).toBeLessThan(e.y1);
    }
    expect(lines(two)).toContain('first');
    expect(lines(two)).toContain('second');
  });

  it('applies style, classDef, class and the ::: shorthand', () => {
    const scene = sceneOf(
      'erDiagram\n A:::hot { int id }\n B\n C\n class B hot\n classDef hot fill:#f96,stroke:#333\n style C fill:#bbf,color:#fff\n classDef default stroke-width:2px'
    );
    expect(entity(scene, 'A').kind).toBe('pele-node pele-entity hot');
    expect(entity(scene, 'B').kind).toBe('pele-node pele-entity hot');
    for (const name of ['A', 'B']) {
      const [body, outline] = shapesOf(scene, entity(scene, name));
      expect([body.paint, outline.paint, outline.width]).toEqual(['#f96', '#333', 2]);
    }
    const [body, outline] = shapesOf(scene, entity(scene, 'C'));
    expect([body.paint, outline.width]).toEqual(['#bbf', 2]);
    expect(textsOf(scene, entity(scene, 'C')).map((t) => t.paint)).toEqual(['#fff']);
    // Shading over a chosen fill is a tint of it rather than the page background.
    expect(stripes(scene, 'A').map((s) => [s.paint, s.opacity])).toEqual([
      ['var(--pele-fg-on-dark,#fff)', 0.6],
      ['var(--pele-fg-on-dark,#fff)', 0.6],
    ]);
  });

  it('picks a contrasting text color on fills a style sets', () => {
    const scene = sceneOf(
      'erDiagram\n A { int id PK "key" }\n B { int id }\n C { int id }\n D { int id }\n subgraph G\n  E\n end\n style A fill:navy\n style B fill:#BBDEFB\n style C fill:#BBDEFB,color:#333\n style G fill:#FFF9C4'
    );
    const inks = (name: string): string[] => [...new Set(textsOf(scene, entity(scene, name)).map((t) => t.paint))];
    const tints = (name: string): string[] => stripes(scene, name).map((s) => s.paint);
    const ON_LIGHT = 'var(--pele-fg-on-light,#1f1f1f)';
    const ON_DARK = 'var(--pele-fg-on-dark,#fff)';
    expect(tints('A')).toEqual([ON_LIGHT, ON_LIGHT]);
    expect(inks('A')).toEqual([ON_DARK]);
    expect(textsOf(scene, entity(scene, 'A'))).toHaveLength(5);
    expect(inks('B')).toEqual([ON_LIGHT]);
    expect(tints('B')).toEqual([ON_DARK, ON_DARK]);
    expect(inks('C')).toEqual(['#333']);
    expect(shapesOf(scene, entity(scene, 'C')).some((s) => s.paint === ON_LIGHT)).toBe(false);
    expect(inks('D')).toEqual(['var(--_fg)', 'var(--_m)']);
    expect(tints('D')).toEqual(['var(--_bg)', 'var(--_bg)']);
    expect(textsOf(scene, items(scene, 'pele-cluster')[0]).map((t) => t.paint)).toEqual([ON_LIGHT]);
  });

  it('formats markdown and keeps unicode in names, attributes and labels', () => {
    const scene = sceneOf('erDiagram\n "This **is** _Markdown_" ||--o{ "Ünïcödé ❤ 日本語" : "**bold** label"\n T {\n string x "a *b* c"\n }');
    const spans = scene.texts.flatMap((t) => t.spans);
    expect(spans.find((s) => s.text === 'is')?.weight).toBe(700);
    expect(spans.find((s) => s.text === 'Markdown')?.italic).toBe(true);
    expect(lines(scene)).toContain('Ünïcödé ❤ 日本語');
    expect(scene.texts.find((t) => lineOf(t) === 'bold label')!.spans.map((s) => [s.text, s.weight])).toEqual([
      ['bold', 700],
      [' label', undefined],
    ]);
    expect(spans.find((s) => s.text === 'b')?.italic).toBe(true);
  });

  it('reads tildes in attribute text as generic brackets', () => {
    expect(genericTypes('List~int~')).toBe('List<int>');
    expect(genericTypes('Map~K,V~')).toBe('Map<K,V>');
    expect(genericTypes('Array~Array~string~~')).toBe('Array<Array<string>>');
    expect(genericTypes('a~b')).toBe('a~b');
    expect(genericTypes('plain')).toBe('plain');
    expect(lines(sceneOf('erDiagram\n A {\n List~string~ tags\n }'))).toContain('List<string>');
  });

  it('draws subgraphs as clusters, nested, with relationships to them', () => {
    const scene = sceneOf(
      'erDiagram\n subgraph outer [Outer title]\n  A\n  subgraph inner\n   B { int id }\n  end\n end\n subgraph "Empty One"\n end\n outer ||--o{ C : links\n C ||--|| inner : x'
    );
    expect(items(scene, 'pele-cluster')).toHaveLength(3);
    expect(itemById(scene, 'outer', 'pele-cluster')).toBeDefined();
    expect(lines(scene)).toContain('Outer title');
    expect(lines(scene)).toContain('inner');
    expect(lines(scene)).toContain('Empty One');
    expect(edgeItems(scene)).toHaveLength(2);
    const outer = itemById(scene, 'outer', 'pele-cluster')!.box!;
    const inner = itemById(scene, 'inner', 'pele-cluster')!.box!;
    expect(inner.x0).toBeGreaterThan(outer.x0);
    expect(inner.y0).toBeGreaterThan(outer.y0);
    expect(inner.x1).toBeLessThan(outer.x1);
    expect(inner.y1).toBeLessThan(outer.y1);
    const b = box(scene, 'B');
    expect(b.x0).toBeGreaterThan(inner.x0);
    expect(b.x0).toBeLessThan(inner.x1);
  });

  it('draws a subgraph fill the author sets at full opacity', () => {
    const scene = sceneOf('erDiagram\n subgraph g\n  A\n end\n subgraph h\n  B\n end\n style g fill:#fee');
    const fill = (id: string): SceneShape => shapesOf(scene, itemById(scene, id, 'pele-cluster')!)[0];
    expect([fill('g').paint, fill('g').opacity]).toEqual(['#fee', 1]);
    expect([fill('h').paint, fill('h').opacity]).toEqual(['var(--_a)', 0.5]);
  });

  it('cases relationships that cross a subgraph fill a style sets and inks those inside it', () => {
    const src = 'erDiagram\n subgraph g\n  A ||--o{ B : has\n end\n B ||--|| C : is\n C ||--|| D : of\n C ||--o{ C : self\n style g fill:#BBDEFB';
    const scene = sceneOf(src);
    // A casing is the line again in the page colour, drawn wider and under it.
    const casings = scene.shapes.filter((s) => s.item < 0 && s.kind === 'stroke' && s.paint === 'var(--_bg)' && s.width === 5);
    const edges = edgeItems(scene);
    expect(edges.map((e) => casings.some((c) => JSON.stringify(c.cmds) === JSON.stringify(lineOfEdge(scene, e))))).toEqual([false, true, false, false]);
    // A --> B lies inside the subgraph, so it takes the fill's ink instead.
    const inked = (s: SceneShape): boolean => s.kind === 'stroke' && s.paint === 'var(--pele-fg-on-light,#1f1f1f)';
    expect(edges.map((e) => shapesOf(scene, e).some(inked))).toEqual([true, false, false, false]);
    // A hollow ring keeps the fill's color inside it.
    const ring = shapesOf(scene, edges[0]).find((s) => s.kind === 'fill' && isRing(s))!;
    expect(ring.paint).toBe('#BBDEFB');
    expect(casings.some(isRing)).toBe(false);
    const plain = sceneOf(src.replace('\n style g fill:#BBDEFB', ''));
    expect(plain.shapes.filter((s) => s.item < 0 && s.kind === 'stroke')).toHaveLength(0);
    expect(paints(plain).some((p) => p.startsWith('var(--pele-fg-on'))).toBe(false);
  });

  it('connects a relationship written before its subgraph to that subgraph', () => {
    const scene = sceneOf('erDiagram\n g ||--o{ X : early\n subgraph g\n  A\n end');
    expect(edgeItems(scene)).toHaveLength(1);
    expect(itemById(scene, 'g', 'pele-cluster')).toBeDefined();
    expect(itemById(scene, 'g', 'pele-entity')).toBeUndefined();
  });

  it('styles a subgraph and lets it set its own direction', () => {
    const scene = sceneOf('erDiagram\n subgraph g\n  direction LR\n  A ||--|| B : x\n end\n style g fill:#fee\n classDef k stroke:#c33\n class g k');
    const cluster = itemById(scene, 'g', 'pele-cluster')!;
    expect(cluster.kind).toBe('pele-cluster k');
    expect(shapesOf(scene, cluster).map((s) => s.paint)).toEqual(['#fee', '#c33']);
    expect(box(scene, 'B').x0).toBeGreaterThan(box(scene, 'A').x0);
    expect(box(scene, 'B').y0).toBeCloseTo(box(scene, 'A').y0, 1);
  });

  it('writes the title', () => {
    const scene = sceneOf('---\ntitle: Order example\n---\nerDiagram\n accTitle: Orders\n accDescr: How orders relate\n A ||--o{ B : x');
    const title = scene.texts.find((t) => lineOf(t) === 'Order example')!;
    expect(title.item).toBe(-1);
    expect(title.weight).toBeGreaterThan(400);
    expect(title.y).toBeLessThan(box(scene, 'A').y0);
  });

  it('links an entity with the internal-link class', () => {
    const result = draw('erDiagram\n Note:::internal-link { string body }\n p["My page"]:::internal-link');
    expect(result.links).toEqual([
      { id: 'Note', href: 'Note', internal: true },
      { id: 'p', href: 'My page', internal: true },
    ]);
  });

  it('uses only theme aliases for its own colors', () => {
    const scene = sceneOf('erDiagram\n A ||--o{ B : x\n A { int id PK "c" }\n subgraph g\n C\n end');
    for (const paint of paints(scene)) expect(paint).toMatch(/^(?:none|var\(--_\w+\)|currentColor)$/);
  });

  it('honors spacing set in the configuration', () => {
    const tight = draw('erDiagram\n A ||--o{ B : x');
    const loose = draw('---\nconfig:\n  er:\n    rankSpacing: 200\n---\nerDiagram\n A ||--o{ B : x');
    expect(loose.height).toBeGreaterThan(tight.height + 100);
  });

  it('rejects what Mermaid rejects', () => {
    expect(() => draw('erDiagram\n A ||--o{ B')).toThrow(PeleError);
    expect(() => draw('erDiagram\n A { int }')).toThrow(/Expecting 'ATTRIBUTE_WORD'/);
    expect(() => draw('erDiagram\n style A fill:rgb(1,2,3)\n')).toThrow(/Lexical error/);
    expect(() => draw('erDiagram\n subgraph g\n A')).toThrow(PeleError);
  });
});
