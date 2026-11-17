import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, parse, renderScene, supports, type C4Model } from '../../src/index.js';
import type { Box, Scene, SceneItem, SceneShape } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import {
  assertSafe,
  draw as drawScene,
  hasClass,
  itemById,
  items,
  lineOf,
  lines,
  options,
  paints,
  shapesOf,
  textOf,
  textsOf,
  tryDraw,
} from '../support/scene.js';

const draw = (src: string, extra: object = {}) => drawScene(src, extra);
const model = (src: string): C4Model => parse(src) as C4Model;

// Whether two scenes draw the same, whatever lines of the source their items came from.
const look = ({ items: parts, ...rest }: Scene): string => JSON.stringify([rest, parts.map(({ id, kind, role, box }) => [id, kind, role, box])]);
const same = (a: Scene, b: Scene): boolean => look(a) === look(b);

// Path commands are a flat list: an op code, then that op's numbers.
const ARGC = [2, 2, 6, 4, 7, 0];
const CURVE = 2;
const Q = 3;
const ops = (cmds: number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) out.push(cmds[i]);
  return out;
};

type Rect = { x: number; y: number; w: number; h: number };
const rect = (b: Box): Rect => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

function itemOf(scene: Scene, id: string, cls?: string): SceneItem {
  const item = itemById(scene, id, cls);
  if (!item) throw new Error(`No item ${id}`);
  return item;
}

// The box of a shape or boundary. For a person it is the body, without the head.
function box(scene: Scene, id: string): Rect {
  const item = items(scene).find((i) => i.id === id && (hasClass(i, 'pele-node') || hasClass(i, 'pele-cluster')));
  if (!item) throw new Error(`No box for ${id}`);
  return rect(hasClass(item, 'pele-node') ? shapesOf(scene, item)[0].box : item.box!);
}

const edgeOf = (scene: Scene, id: string): SceneItem => itemOf(scene, id, 'pele-edge');
const labelOf = (scene: Scene, id: string): Rect => rect(itemOf(scene, id, 'pele-edge-label').box!);
const lineShape = (scene: Scene, id: string): SceneShape => shapesOf(scene, edgeOf(scene, id)).find((s) => s.kind === 'stroke')!;
const line = (scene: Scene, id: string): number[] => lineShape(scene, id).cmds;
// The arrowheads of the relations: filled triangles that belong to an edge.
const heads = (scene: Scene): SceneShape[] =>
  scene.shapes.filter((s) => s.kind === 'fill' && s.cmds.length === 10 && s.item >= 0 && hasClass(scene.items[s.item], 'pele-edge'));
const labelX = (scene: Scene, id: string): number => labelOf(scene, id).x;
const labelY = (scene: Scene, id: string): number => labelOf(scene, id).y;
const titleOf = (scene: Scene): string[] => scene.texts.filter((t) => t.item === -1).map(lineOf);

describe('C4 rendering', () => {
  it('draws shapes, boundaries, and relations', () => {
    const result = draw(`C4Context
title System Context
Person(user, "User", "Uses the bank")
Enterprise_Boundary(bank, "Bank") {
  System(app, "Banking", "Moves money")
  SystemDb_Ext(ledger, "Ledger")
}
Rel(user, app, "Uses", "HTTPS")
BiRel(app, ledger, "Syncs")`);
    const { scene, type } = result;
    expect(type).toBe('c4');
    expect(supports('C4Context\nPerson(a, "A")')).toBe(true);
    expect(items(scene, 'pele-node').length).toBe(3);
    expect(items(scene, 'pele-cluster').length).toBe(1);
    expect(items(scene, 'pele-edge').length).toBe(2);
    expect(items(scene, 'pele-edge-label').length).toBe(2);
    expect(heads(scene).length).toBe(3);
    for (const text of ['System Context', '«person»', '«external system db»', '[HTTPS]', '[ENTERPRISE]']) expect(lines(scene), text).toContain(text);
    assertSafe(result, 'basic');
  });

  it('accepts all five diagram keywords', () => {
    for (const keyword of ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']) {
      expect(model(`${keyword}\nPerson(a, "A")`).c4Type).toBe(keyword);
      expect(itemById(draw(`${keyword}\nPerson(a, "A")`).scene, 'a')).toBeDefined();
    }
  });

  it('gives each kind of element its shape', () => {
    const { scene } = draw(`C4Container
Person(p, "P")
Person_Ext(pe, "PE")
System(s, "S")
SystemDb(sd, "SD")
SystemQueue(sq, "SQ")
Container_Ext(ce, "CE", "Go")
ContainerDb_Ext(cde, "CDE")
ComponentQueue_Ext(cqe, "CQE")`);
    const kind = (id: string): string => itemOf(scene, id).kind;
    expect(kind('p')).toContain('pele-shape-person pele-c4-person');
    // A person is a body and a head.
    expect(shapesOf(scene, itemOf(scene, 'p')).some((s) => s.cmds.length === 20)).toBe(true);
    expect(kind('pe')).toContain('pele-shape-person pele-c4-external_person pele-c4-external');
    expect(kind('s')).toContain('pele-shape-rect pele-c4-system');
    expect(kind('sd')).toContain('pele-shape-cyl pele-c4-system_db');
    expect(kind('sq')).toContain('pele-shape-h-cyl pele-c4-system_queue');
    expect(kind('cde')).toContain('pele-shape-cyl pele-c4-external_container_db pele-c4-external');
    expect(kind('cqe')).toContain('pele-shape-h-cyl pele-c4-external_component_queue pele-c4-external');
    // External elements are hollow with a dashed border; the rest are filled.
    const [ceFill, ceStroke] = shapesOf(scene, itemOf(scene, 'ce'));
    expect([ceFill.paint, ceStroke.paint, ceStroke.dash]).toEqual(['var(--_bg)', 'var(--_b)', [4, 3]]);
    const [sFill, sStroke] = shapesOf(scene, itemOf(scene, 's'));
    expect([sFill.paint, sStroke.paint, sStroke.dash ?? null]).toEqual(['var(--_s)', 'var(--_b)', null]);
  });

  it('takes a shape from $shape, $sprite or $tags, as Mermaid does', () => {
    const { scene } = draw(`C4Context
System(a, "A", $tags="v1, cylinder")
System(b, "B", $sprite="queue")
System(c, "C")
UpdateElementStyle(c, $shape="Person")
System(d, "D", $tags="constructor")`);
    expect(itemOf(scene, 'a').kind).toContain('pele-shape-cyl pele-c4-system');
    expect(itemOf(scene, 'b').kind).toContain('pele-shape-h-cyl pele-c4-system');
    expect(itemOf(scene, 'c').kind).toContain('pele-shape-person pele-c4-system');
    expect(itemOf(scene, 'd').kind).toContain('pele-shape-rect pele-c4-system');
  });

  it('writes the type, name, technology, and description of a shape', () => {
    const { scene } = draw('C4Container\nContainer(api, "API", "Node.js", "Serves <b>requests</b><br/>all day")');
    expect(lines(scene)).toContain('«container»');
    expect(scene.texts.find((t) => lineOf(t) === 'API')!.weight).toBeGreaterThan(400);
    expect(lines(scene)).toContain('[Node.js]');
    const serves = scene.texts.find((t) => lineOf(t).startsWith('Serves'))!;
    expect(serves.spans.map((s) => [s.text, (s.weight ?? 400) > 400])).toEqual([['Serves ', false], ['requests', true]]);
    expect(lines(scene)).toContain('all day');
    expect(textOf(scene)).not.toContain('<br');
  });

  it('wraps long text inside a fixed width and widens for a word that cannot wrap', () => {
    const wrapped = draw(`C4Context\nSystem(a, "A", "${'word '.repeat(40)}")`);
    expect(box(wrapped.scene, 'a').w).toBe(216);
    expect(box(wrapped.scene, 'a').h).toBeGreaterThan(150);
    const wide = draw(`C4Context\nSystem(a, "${'W'.repeat(40)}")`);
    expect(box(wide.scene, 'a').w).toBeGreaterThan(400);
  });

  it('lays shapes out in rows of four and boundaries in rows of two by default', () => {
    const { scene } = draw(`C4Context
${[1, 2, 3, 4, 5].map((i) => `System(s${i}, "S${i}")`).join('\n')}
${[1, 2, 3].map((i) => `Boundary(b${i}, "B${i}") {\n System(i${i}, "I${i}")\n}`).join('\n')}`);
    const s = [1, 2, 3, 4, 5].map((i) => box(scene, `s${i}`));
    expect(new Set(s.slice(0, 4).map((b) => b.y)).size).toBe(1);
    expect(s[1].x).toBeGreaterThan(s[0].x + s[0].w);
    expect(s[4].x).toBe(s[0].x);
    expect(s[4].y).toBeGreaterThan(s[0].y + s[0].h);
    const b = [1, 2, 3].map((i) => box(scene, `b${i}`));
    expect(b[0].y).toBeGreaterThan(s[4].y + s[4].h);
    expect(b[1].y).toBe(b[0].y);
    expect(b[1].x).toBeGreaterThan(b[0].x + b[0].w);
    expect(b[2].x).toBe(b[0].x);
    expect(b[2].y).toBeGreaterThan(b[0].y + b[0].h);
  });

  it('follows UpdateLayoutConfig', () => {
    const src = (config: string): string =>
      `C4Context\nSystem(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nBoundary(x, "X") {\n System(d, "D")\n}\nBoundary(y, "Y") {\n System(e, "E")\n}\n${config}`;
    const stacked = draw(src('UpdateLayoutConfig($c4ShapeInRow="1", $c4BoundaryInRow="1")')).scene;
    expect(box(stacked, 'b').x).toBe(box(stacked, 'a').x);
    expect(box(stacked, 'b').y).toBeGreaterThan(box(stacked, 'a').y);
    expect(box(stacked, 'y').x).toBe(box(stacked, 'x').x);
    const positional = draw(src('UpdateLayoutConfig("2", "2")')).scene;
    expect(box(positional, 'b').y).toBe(box(positional, 'a').y);
    expect(box(positional, 'c').y).toBeGreaterThan(box(positional, 'a').y);
    expect(box(positional, 'y').y).toBe(box(positional, 'x').y);
    // Values below one are ignored. The slot decides what a value sets, not its name, as in Mermaid.
    expect(model(src('UpdateLayoutConfig("0", "-3")')).shapeInRow).toBe(4);
    expect(model(src('UpdateLayoutConfig($c4BoundaryInRow="3")')).shapeInRow).toBe(3);
    expect(model(src('UpdateLayoutConfig($c4BoundaryInRow="3")')).boundaryInRow).toBe(2);
  });

  it('nests boundaries and sizes each around what it holds', () => {
    const { scene } = draw(`C4Deployment
Deployment_Node(outer, "Outer", "Linux", "A machine") {
  Node(inner, "Inner") {
    Container(app, "App")
  }
  Node_L(left, "Left") {
    Container(other, "Other")
  }
}`);
    const outer = box(scene, 'outer');
    const inner = box(scene, 'inner');
    const app = box(scene, 'app');
    const inside = (a: Rect, b: Rect): boolean => a.x > b.x && a.y > b.y && a.x + a.w < b.x + b.w && a.y + a.h < b.y + b.h;
    expect(inside(inner, outer)).toBe(true);
    expect(inside(app, inner)).toBe(true);
    expect(inside(box(scene, 'left'), outer)).toBe(true);
    for (const text of ['[Linux]', 'A machine', '[node]']) expect(lines(scene), text).toContain(text);
    // Deployment nodes have a solid border; other boundaries are dashed.
    expect(itemOf(scene, 'outer').kind).toContain('pele-c4-node');
    expect(shapesOf(scene, itemOf(scene, 'outer')).every((s) => !s.dash)).toBe(true);
    const plain = draw('C4Context\nBoundary(b, "B") {\nSystem(s, "S")\n}').scene;
    expect(itemOf(plain, 'b').kind).toContain('pele-c4-boundary');
    expect(shapesOf(plain, itemOf(plain, 'b')).find((s) => s.kind === 'stroke')!.dash).toEqual([6, 4]);
  });

  it('labels each kind of boundary with its type', () => {
    const { scene } = draw(`C4Container
Enterprise_Boundary(e, "E") {
  System_Boundary(s, "S") {
    Container_Boundary(c, "C") {
      Boundary(b, "B") {
        Boundary(t, "T", "custom") {
          System(x, "X")
        }
      }
    }
  }
}`);
    for (const type of ['ENTERPRISE', 'SYSTEM', 'CONTAINER', 'system', 'custom']) expect(lines(scene)).toContain(`[${type}]`);
  });

  it('draws an arrowhead for each end a relation points at', () => {
    const markers = (rel: string): number => heads(draw(`C4Context\nSystem(a, "A")\nSystem(b, "B")\n${rel}`).scene).length;
    for (const name of ['Rel', 'Rel_U', 'Rel_Up', 'Rel_D', 'Rel_Down', 'Rel_L', 'Rel_Left', 'Rel_R', 'Rel_Right']) {
      expect(markers(`${name}(a, b, "x")`)).toBe(1);
    }
    expect(markers('BiRel(a, b, "x")')).toBe(2);
    expect(markers('Rel_Back(a, b, "x")')).toBe(1);
    const forward = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")').scene;
    const back = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel_Back(a, b, "x")').scene;
    // The first corner of a head is its tip.
    const tip = (scene: Scene): number => heads(scene)[0].cmds[1];
    expect(tip(forward)).toBe(box(forward, 'b').x);
    expect(tip(back)).toBe(box(back, 'a').x + box(back, 'a').w);
  });

  it('ignores the index of RelIndex and a relation without a label', () => {
    const m = model('C4Dynamic\nSystem(a, "A")\nSystem(b, "B")\nRelIndex(7, a, b, "x")\nRel(b, "a")');
    expect(m.rels).toHaveLength(1);
    expect(m.rels[0]).toMatchObject({ type: 'rel', from: 'a', to: 'b', label: 'x' });
  });


  it('numbers relations in a dynamic diagram', () => {
    const src = 'System(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nRel(a, b, "first")\nRel(b, c, "second")';
    const dynamic = lines(draw('C4Dynamic\n' + src).scene);
    expect(dynamic).toContain('1: first');
    expect(dynamic).toContain('2: second');
    expect(lines(draw('C4Context\n' + src).scene)).toContain('first');
  });

  it('joins neighbours with a straight line between their borders', () => {
    const { scene } = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")');
    const a = box(scene, 'a');
    const b = box(scene, 'b');
    const d = line(scene, 'a-b');
    expect(ops(d)).toEqual([0, 1]);
    expect(d[1]).toBe(a.x + a.w);
    expect(d[2]).toBe(a.y + a.h / 2);
    expect(d[4]).toBeCloseTo(b.x - 7, 5);
    expect(d[5]).toBe(d[2]);
  });

  it('fits the label of a line between neighbours in the gap between them', () => {
    for (const args of ['"Sends a fairly long description of the relationship"', '"Makes API calls to", "JSON/HTTPS"']) {
      const { scene } = draw(`C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, ${args})`);
      const a = box(scene, 'a');
      const b = box(scene, 'b');
      const label = labelOf(scene, 'a-b');
      expect(b.y).toBe(a.y);
      expect(label.x, args).toBeGreaterThanOrEqual(a.x + a.w);
      expect(label.x + label.w, args).toBeLessThanOrEqual(b.x);
    }
  });

  it('ends a line on the outline of a person, a database, and a queue', () => {
    const { scene } = draw(`C4Context
UpdateLayoutConfig("1", "1")
Person(p, "P")
SystemDb(d, "D")
SystemQueue(q, "Q")
Rel(p, d, "x")
Rel(d, q, "y")`);
    const p = box(scene, 'p');
    const path = line(scene, 'p-d');
    expect(path[2]).toBe(p.y + p.h);
    // The top of a cylinder is the crown of its lid: where its box starts.
    expect(path[5]).toBeCloseTo(box(scene, 'd').y - 7, 5);
    // A queue is entered through the middle of its rounded end.
    const queue = line(scene, 'd-q');
    expect(queue[1]).toBe(queue[4]);
    expect(queue[5]).toBeGreaterThan(queue[2] + 50);
  });

  it('goes around the shapes between two in the same row or column', () => {
    const row = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nRel(a, c, "over")\nRel(c, a, "under")').scene;
    const a = box(row, 'a');
    const over = line(row, 'a-c');
    expect(ops(over).slice(0, 3)).toEqual([0, 1, Q]);
    expect(over[2]).toBe(a.y);
    expect(over[5]).toBeLessThan(a.y);
    const under = line(row, 'c-a');
    expect(ops(under).slice(0, 3)).toEqual([0, 1, Q]);
    expect(under[5]).toBeGreaterThan(a.y + a.h);
    const column = draw('C4Context\nUpdateLayoutConfig("1", "1")\nSystem(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nRel(a, c, "x")').scene;
    const sideways = line(column, 'a-c');
    expect(ops(sideways).slice(0, 3)).toEqual([0, 1, Q]);
    expect(sideways[2]).toBe(sideways[5]);
    // Neighbours need no detour.
    expect(itemById(row, 'a-b')).toBeUndefined();
    expect(ops(line(draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")').scene, 'a-b'))).not.toContain(Q);
  });

  // The corners of each line that is not a curve. A rounded corner is read as the corner itself.
  const corners = (scene: Scene): Map<string, number[]> => {
    const out = new Map<string, number[]>();
    for (const item of items(scene, 'pele-edge')) {
      const { cmds } = shapesOf(scene, item).find((s) => s.kind === 'stroke')!;
      if (ops(cmds).includes(CURVE)) continue;
      const points: number[] = [];
      for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) {
        if (cmds[i] === Q) points.push(cmds[i + 1], cmds[i + 2]);
        else points.push(cmds[i + ARGC[cmds[i]] - 1], cmds[i + ARGC[cmds[i]]]);
      }
      out.set(item.id, points);
    }
    return out;
  };
  const component = (JSON.parse(readFileSync('tests/corpus/c4-docs.json', 'utf8')) as string[]).find((source) => source.includes('Accounts Summary Controller'))!;

  it('keeps every line clear of the shapes it does not join', () => {
    const sources = JSON.parse(readFileSync('tests/corpus/c4-docs.json', 'utf8')) as string[];
    const behind = new Set<string>();
    for (const source of sources) {
      const rels = model(source).rels;
      for (const maxWidth of [undefined, 640, 480, 320]) {
        const { scene } = draw(source, { maxWidth });
        const shapes = items(scene, 'pele-node').map((item) => [item.id, rect(shapesOf(scene, item)[0].box)] as const);
        const drawn = [...corners(scene)];
        drawn.forEach(([id, points], index) => {
          const rel = rels.find((r) => `${r.from}-${r.to}` === id) ?? rels[index];
          for (const [name, b] of shapes) {
            if (name === rel.from || name === rel.to) continue;
            for (let i = 2; i < points.length; i += 2) {
              const [x0, y0, x1, y1] = [points[i - 2], points[i - 1], points[i], points[i + 1]];
              for (let t = 0; t <= 1; t += 0.02) {
                const x = x0 + (x1 - x0) * t,
                  y = y0 + (y1 - y0) * t;
                const inside = x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1;
                if (inside) {
                  behind.add(`${id} behind ${name} at ${maxWidth ?? 'full'} width in ${source.split('\n')[1].trim()}`);
                  break;
                }
              }
            }
          }
        });
      }
    }
    // In the full container diagram no line with two corners goes around Mobile App, so one stays behind it.
    expect([...behind]).toEqual(['backend_api-banking_system behind mobile_app at full width in title Container diagram for Internet Banking System']);
  });

  it('bends a line that would cross behind a shape through the gap between columns, apart from the others there', () => {
    const { scene } = draw(component, { maxWidth: 640 });
    const lines = corners(scene);
    const lane = (id: string): number => {
      const points = lines.get(id)!;
      for (let i = 2; i < points.length; i += 2) expect(points[i] === points[i - 2] || points[i + 1] === points[i - 1], id).toBe(true);
      return points[4];
    };
    const spa = box(scene, 'spa'),
      accounts = box(scene, 'accounts');
    for (const id of ['spa-accounts', 'ma-sign']) {
      expect(lane(id)).toBeGreaterThan(spa.x + spa.w);
      expect(lane(id)).toBeLessThan(accounts.x);
    }
    expect(Math.abs(lane('spa-accounts') - lane('ma-sign'))).toBeGreaterThanOrEqual(10);
  });

  it('takes a detour along the outside of the drawing when its column is at the edge', () => {
    const { scene } = draw(component, { maxWidth: 640 });
    const lines = corners(scene);
    const spa = box(scene, 'spa'),
      mbs = box(scene, 'mbs');
    expect(lines.get('spa-sign')![4]).toBeLessThan(spa.x);
    expect(lines.get('mbsfacade-mbs')![4]).toBeGreaterThan(mbs.x + mbs.w);
  });

  it('separates two relations that run opposite ways and puts their labels on either side', () => {
    const { scene } = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "there")\nRel(b, a, "back")');
    const y = (id: string): number => line(scene, id)[2];
    expect(Math.abs(y('a-b') - y('b-a'))).toBe(14);
    expect(labelY(scene, 'a-b')).toBeGreaterThan(y('a-b'));
    expect(labelY(scene, 'b-a') + 20).toBeLessThan(y('b-a'));
  });

  it('draws a relation from a shape to itself as a loop', () => {
    const result = draw('C4Context\nSystem(a, "A")\nRel(a, a, "again")');
    expect(ops(line(result.scene, 'a-a')).slice(0, 2)).toEqual([0, CURVE]);
    expect(labelX(result.scene, 'a-a')).toBeGreaterThan(box(result.scene, 'a').x + box(result.scene, 'a').w);
    assertSafe(result, 'loop');
  });

  it('connects a boundary as an end of a relation', () => {
    const { scene } = draw(`C4Context
System(out, "Out")
Boundary(b, "B") {
  System(in, "In")
}
Rel(out, b, "to boundary")
Rel(b, in, "into")`);
    const b = box(scene, 'b');
    expect(line(scene, 'out-b')[5]).toBeCloseTo(b.y - 7, 5);
    expect(line(scene, 'b-in')[1]).toBe(b.x);
  });

  it('rejects a relation to something that does not exist, as Mermaid does', () => {
    const attempt = (): unknown => draw('C4Context\nSystem(a, "A")\nRel(a, missing, "x")');
    expect(attempt).toThrow(PeleError);
    expect(attempt).toThrow('C4 rel "a" -> "missing" references an unknown shape or boundary');
    expect(() => draw('C4Context\nSystem(a, "A")\nRel($x="y", a, "x")')).toThrow(PeleError);
  });

  it('applies UpdateElementStyle to shapes and boundaries', () => {
    const { scene } = draw(`C4Context
Person(a, "A", "desc")
Boundary(b, "B") {
  System(c, "C")
}
UpdateElementStyle(a, $fontColor="red", $bgColor="grey", $borderColor="blue")
UpdateElementStyle(b, "#eee", "green", "orange")
UpdateElementStyle(nobody, "red")`);
    const look = (id: string): [string, string][] => shapesOf(scene, itemOf(scene, id)).map((s) => [s.kind, s.paint]);
    // The body and the head.
    expect(look('a')).toEqual([['fill', 'grey'], ['stroke', 'blue'], ['fill', 'grey'], ['stroke', 'blue']]);
    expect(textsOf(scene, itemOf(scene, 'a')).map((t) => t.paint)).toEqual(['red', 'red', 'red']);
    expect(look('b')).toEqual([['fill', '#eee'], ['stroke', 'orange']]);
    expect(textsOf(scene, itemOf(scene, 'b')).map((t) => t.paint)).toEqual(['green', 'green']);
  });

  it('picks a contrasting text color on fills a style sets', () => {
    const { scene } = draw(`C4Context
Boundary(b, "B", "Kind") {
  System(c, "C", "about c")
}
System(d, "D", "about d")
System(e, "E")
UpdateElementStyle(b, $bgColor="lightyellow")
UpdateElementStyle(c, $bgColor="navy")
UpdateElementStyle(d, $bgColor="navy", $fontColor="#ddd")`);
    const inks = (id: string): string[] => textsOf(scene, itemOf(scene, id)).map((t) => t.paint);
    expect(inks('c')).toEqual(Array(3).fill('var(--pele-fg-on-dark,#fff)'));
    expect(inks('b')).toEqual(Array(2).fill('var(--pele-fg-on-light,#1f1f1f)'));
    expect(inks('d')).toEqual(Array(3).fill('#ddd'));
    expect(inks('e').filter((p) => p.includes('--pele-fg-on'))).toEqual([]);
  });

  it('cases relations that cross a boundary fill a style sets and inks those inside it', () => {
    const src = `C4Context
Boundary(b, "B") {
  System(x, "X")
  System(y, "Y")
}
System(z, "Z")
System(w, "W")
Rel(x, y, "in")
Rel(y, z, "out")
Rel(z, w, "away")
UpdateElementStyle(b, $bgColor="lightyellow")`;
    const { scene } = draw(src);
    const casings = (s: Scene): string[] => s.shapes.filter((c) => c.kind === 'stroke' && c.item === -1 && c.paint === 'var(--_bg)').map((c) => JSON.stringify(c.cmds));
    const cased = casings(scene);
    // x --> y lies inside the boundary and takes its ink; y --> z crosses out of it.
    expect(cased).not.toContain(JSON.stringify(line(scene, 'x-y')));
    expect(shapesOf(scene, edgeOf(scene, 'x-y')).map((s) => s.paint)).toEqual(Array(2).fill('var(--pele-fg-on-light,#1f1f1f)'));
    expect(cased).toContain(JSON.stringify(line(scene, 'y-z')));
    expect(cased).not.toContain(JSON.stringify(line(scene, 'z-w')));
    const plain = draw(src.replace('UpdateElementStyle(b, $bgColor="lightyellow")', '')).scene;
    expect(casings(plain)).toEqual([]);
    expect(paints(plain).filter((p) => p.includes('--pele-fg-on'))).toEqual([]);
    const loop = draw('C4Context\nBoundary(S, "S") {\n  System(A, "A")\n}\nRel(A, A, "self")\nUpdateElementStyle(S, $bgColor="white")').scene;
    expect(shapesOf(loop, edgeOf(loop, 'A-A')).map((s) => s.paint)).toContain('var(--pele-fg-on-light,#1f1f1f)');
  });

  it('applies UpdateRelStyle colours and offsets', () => {
    const base = 'C4Context\nUpdateLayoutConfig("1", "1")\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")\n';
    const plain = draw(base).scene;
    const styled = draw(base + 'UpdateRelStyle(a, b, $textColor="red", $lineColor="blue", $offsetX="30", $offsetY="-10")').scene;
    expect(shapesOf(styled, edgeOf(styled, 'a-b')).map((s) => s.paint)).toEqual(['blue', 'blue']);
    expect(textsOf(styled, itemOf(styled, 'a-b', 'pele-edge-label')).map((t) => t.paint)).toEqual(['red']);
    expect(labelX(styled, 'a-b')).toBe(labelX(plain, 'a-b') + 30);
    expect(labelY(styled, 'a-b')).toBe(labelY(plain, 'a-b') - 10);
    const positional = draw(base + 'UpdateRelStyle(a, b, "red", "blue", "30", "-10")').scene;
    expect(same(positional, styled)).toBe(true);
    // Named in any order: Mermaid turns colours in the last two places into NaN.
    const swapped = draw(base + 'UpdateRelStyle(a, b, $offsetX="30", $offsetY="-10", $lineColor="blue", $textColor="red")').scene;
    expect(same(swapped, styled)).toBe(true);
  });

  it('keeps a label on its line when an offset would put it on a shape', () => {
    const base = 'C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")\n';
    const plain = draw(base).scene;
    expect(same(draw(base + 'UpdateRelStyle(a, b, $offsetX="-120")').scene, plain)).toBe(true);
    // The drawing grows upward to hold the label, so it is measured from the shape.
    const raised = draw(base + 'UpdateRelStyle(a, b, $offsetY="-60")').scene;
    expect(labelY(raised, 'a-b') - box(raised, 'a').y).toBe(labelY(plain, 'a-b') - box(plain, 'a').y - 60);
    expect(draw(base + 'UpdateRelStyle(a, b, $offsetX="9999999999")').width).toBeLessThan(3000);
    expect(same(draw(base + 'UpdateRelStyle(a, b, $offsetX="abc", $offsetY="x1")').scene, plain)).toBe(true);
  });

  it('reattaches manually offset labels to their arrows when the component layout compacts', () => {
    const source = component;
    const withoutOffsets = source.replace(/^\s*UpdateRelStyle\([^\n]+\)\s*$/gm, '');
    const parsed = model(source);
    const before = JSON.stringify(parsed);
    for (const maxWidth of [320, 480, 568]) {
      const compact = renderScene(parsed, { ...options, maxWidth });
      expect(same(compact.scene, draw(withoutOffsets, { maxWidth }).scene)).toBe(true);
    }
    expect(JSON.stringify(parsed)).toBe(before);
    const { scene } = renderScene(parsed, { ...options, maxWidth: 568 });
    for (const [from, to] of [['sign', 'security'], ['accounts', 'mbsfacade']]) {
      const a = box(scene, from),
        b = box(scene, to);
      const x = labelX(scene, `${from}-${to}`),
        y = labelY(scene, `${from}-${to}`);
      expect(x).toBeGreaterThan(a.x);
      expect(x).toBeLessThan(a.x + a.w);
      expect(y).toBeGreaterThan(a.y + a.h);
      expect(y + 20).toBeLessThan(b.y);
    }
    const wide = draw(source);
    expect(same(renderScene(parsed, { ...options, maxWidth: wide.width }).scene, wide.scene)).toBe(true);
    expect(same(wide.scene, draw(withoutOffsets).scene)).toBe(false);
  });

  it('moves a boundary heading out of the way of a line', () => {
    const { scene } = draw(`C4Context
System(top, "Top")
Boundary(b, "Boundary name") {
  System(in, "In")
  System(other, "Other")
}
Rel(top, in, "x")`);
    const headingX = (s: Scene): number => s.texts.find((t) => lineOf(t) === 'Boundary name')!.x;
    expect(Math.abs(headingX(scene) - line(scene, 'top-in')[1])).toBeGreaterThan(20);
    const alone = draw('C4Context\nBoundary(b, "Boundary name") {\n System(in, "In")\n System(other, "Other")\n}').scene;
    expect(headingX(alone)).toBeLessThan(headingX(scene));
  });

  it('lists the links of a shape, a boundary heading, and a relation label', () => {
    const { links } = draw(`C4Context
System(a, "A", $link="https://example.com/a")
Boundary(b, "B", $link="https://example.com/b") {
  System(c, "C", $link="javascript:alert(1)")
}
Rel(a, c, "x", $link="https://example.com/rel")`);
    expect(links).toEqual([
      { id: 'a-c', href: 'https://example.com/rel', internal: false },
      { id: 'a', href: 'https://example.com/a', internal: false },
      { id: 'b', href: 'https://example.com/b', internal: false },
    ]);
  });

  it('stores sprites, tags, and legend arguments without drawing them', () => {
    const src = 'C4Context\nSystem(a, "A", "d", "sprite", "t1,t2")\nUpdateElementStyle(a, $legendText="L", $legendSprite="S", $shadowing="true")';
    const m = model(src);
    expect(m.shapes[0]).toMatchObject({ sprite: 'sprite', tags: 't1,t2', legendText: 'L', legendSprite: 'S', shadowing: 'true' });
    const { scene } = draw(src);
    expect(textOf(scene)).not.toContain('sprite');
    expect(textOf(scene)).not.toContain('t1');
    expect(scene.skipped).toEqual({});
  });

  it('takes the title from the diagram, then from front matter', () => {
    const own = draw('C4Context\ntitle Own title\nSystem(a, "A")').scene;
    expect(titleOf(own)).toEqual(['Own title']);
    expect(own.texts.find((t) => t.item === -1)!.weight).toBeGreaterThan(400);
    expect(titleOf(draw('---\ntitle: From front matter\n---\nC4Context\nSystem(a, "A")').scene)).toEqual(['From front matter']);
    expect(titleOf(draw('---\ntitle: From front matter\n---\nC4Context\ntitle Own\nSystem(a, "A")').scene)).toEqual(['Own']);
    const wide = draw(`C4Context\ntitle ${'A long title '.repeat(8)}\nSystem(a, "A")`);
    expect(wide.width).toBeGreaterThan(600);
  });

  it('treats a bare title as no title and keeps a title after a tab', () => {
    const bare = model('C4Context\ntitle\nPerson(a, "Alice")\nPerson(b, "Bob")');
    expect(bare.title).toBeUndefined();
    expect(bare.shapes.map((shape) => shape.label)).toEqual(['Alice', 'Bob']);
    expect(model('C4Context\ntitle\tOwn\nSystem(a, "A")').title).toBe('Own');
  });

  it('treats accTitle as the title, as the grammar does, and accDescr as the description', () => {
    const { scene } = draw('C4Context\naccTitle: Shown on top\naccDescr: For screen readers\nSystem(a, "A")');
    expect(titleOf(scene)).toEqual(['Shown on top']);
    expect(textOf(scene)).not.toContain('For screen readers');
    expect(model('C4Context\naccDescr {\n  two\n  lines\n}\nSystem(a, "A")').accDescr).toBe('two\nlines');
    expect(model('C4Context\naccDescription one line\nSystem(a, "A")').accDescr).toBe('one line');
  });

  it('applies a named argument wherever it is written', () => {
    const m = model(`C4Container
Person(a, $sprite="users")
Container(b, "B", $descr="described")
Container($tags="t", "Anonymous")
Node(n, "N", "t", "d", $link="https://example.com") {
  Container(c, "C", $unknown="kept", $__proto__="safe")
}
Rel(a, b, $techn="HTTP")`);
    expect(m.shapes[0]).toMatchObject({ alias: 'a', label: '', sprite: 'users' });
    expect(m.shapes[1]).toMatchObject({ label: 'B', descr: 'described' });
    expect(m.shapes[1].techn).toBeUndefined();
    expect(m.shapes[2]).toMatchObject({ alias: '', label: 'Anonymous', tags: 't' });
    expect(m.boundaries[1]).toMatchObject({ type: 't', descr: 'd', link: 'https://example.com', nodeType: 'node' });
    expect(m.shapes[3].extra).toEqual(new Map([['unknown', 'kept'], ['__proto__', 'safe']]));
    expect(m.rels[0]).toMatchObject({ label: '', techn: 'HTTP' });
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
    expect(lines(draw('C4Context\nPerson(a, $sprite="users")\nSystem($link="https://example.com", "B")').scene)).toContain('B');
  });

  it('merges a repeated alias and keeps the first position', () => {
    const m = model(`C4Context
System(a, "First", "d1")
System(b, "B")
Boundary(x, "X") {
  Person(a, "Second")
}
Rel(a, b, "one", "t")
BiRel(a, b, "two")`);
    expect(m.shapes.map((s) => s.alias)).toEqual(['a', 'b']);
    expect(m.shapes[0]).toMatchObject({ label: 'Second', descr: 'd1', kind: 'person' });
    expect(m.shapes[0].parent?.alias).toBe('x');
    expect(m.rels).toHaveLength(1);
    expect(m.rels[0]).toMatchObject({ type: 'birel', label: 'two', techn: 't' });
  });

  it('draws a boundary named global, which Mermaid swallows', () => {
    const { scene } = draw('C4Context\nBoundary(global, "Everything") {\n System(a, "A")\n}');
    expect(itemById(scene, 'global')).toBeDefined();
    expect(itemById(scene, 'a')).toBeDefined();
  });

  it('leaves out a boundary that ends up inside itself', () => {
    const { scene } = draw(`C4Context
System(ok, "OK")
Boundary(a, "A") {
  Boundary(b, "B") {
    Boundary(a, "A again") {
      System(lost, "Lost")
    }
  }
}`);
    expect(itemById(scene, 'ok')).toBeDefined();
    expect(itemById(scene, 'lost')).toBeUndefined();
    expect(itemById(scene, 'b')).toBeUndefined();
  });

  it('reports syntax errors the way Jison words them', () => {
    const fail = (src: string): PeleError => {
      try {
        draw(src);
      } catch (error) {
        return error as PeleError;
      }
      throw new Error('Expected an error');
    };
    expect(fail('C4Context\nPerson (a, "A")').message).toMatch(/^Lexical error on line 2\. Unrecognized text\./);
    expect(fail('C4Context\nPerson(a, "A") Person(b, "B")').message).toMatch(/Parse error on line 2:[\s\S]*Expecting 'NEWLINE', 'EOF', got 'PERSON'/);
    expect(fail('C4Context\nBoundary(b, "B")\nSystem(a, "A")').message).toContain("Expecting 'LBRACE', got 'SYSTEM'");
    expect(fail('C4Context\nBoundary(b, "B") {\nSystem(a, "A")').message).toContain("got 'EOF'");
    expect(fail('C4Context\n').code).toBe('syntax');
    // An empty named value has no STR_VALUE token in the grammar.
    expect(fail('C4Context\nPerson(a, "A", $link="")').message).toContain("Expecting 'STR_VALUE'");
    expect(fail('C4Context\nPerson(a, "A"').type).toBe('c4');
  });

  it('reads an unquoted last argument through to the next comma, as Mermaid does', () => {
    const m = model('C4Context\nPerson(a, plain label)\nSystem(b, "B")');
    expect(m.shapes).toHaveLength(1);
    expect(m.shapes[0].label).toBe('plain label)\nSystem(b');
  });


  it('gives the same output every time', () => {
    for (const src of loadCorpus('c4', /C4(?:Context|Container|Component|Dynamic|Deployment)/).slice(0, 20)) {
      const first = tryDraw(src);
      if (first === undefined) continue;
      expect(JSON.stringify(draw(src).scene)).toBe(JSON.stringify(first.scene));
    }
  });

  it('renders every documentation example', () => {
    let rendered = 0;
    for (const src of JSON.parse(readFileSync('tests/corpus/c4-docs.json', 'utf8')) as string[]) {
      const result = draw(src);
      assertSafe(result, src.slice(0, 60));
      expect(result.width).toBeGreaterThan(100);
      expect(result.height).toBeGreaterThan(50);
      rendered++;
    }
    expect(rendered).toBeGreaterThanOrEqual(5);
  });

  it('scales with the font size option', () => {
    const src = 'C4Context\nSystem(a, "A", "Some description text that wraps over lines")';
    expect(draw(src, { fontSize: 24 }).height).toBeGreaterThan(draw(src).height);
  });
});
