import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Box, Scene } from '../../src/draw/scene.js';
import { random } from '../support/corpus.js';
import { draw, items, itemById, lines, overlaps, sceneProblem, shapesOf } from '../support/scene.js';

const docs = JSON.parse(readFileSync('tests/corpus/architecture-docs.json', 'utf8')) as string[];

// What the first fill of each item with a class draws, by id: the icon squares of the services
// and junctions, the areas of the groups.
function fills(scene: Scene, cls: string): Map<string, Box> {
  return new Map(items(scene, cls).map((i) => [i.id, shapesOf(scene, i).find((h) => h.kind === 'fill')!.box]));
}

const nodeBoxes = (scene: Scene): Map<string, Box> => fills(scene, 'pele-node');
const clusterBoxes = (scene: Scene): Map<string, Box> => fills(scene, 'pele-cluster');

const inside = (a: Box, b: Box): boolean => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
const apart = (a: Box, b: Box): boolean => !overlaps(a, b);

// The ops of a path, one code per command.
function ops(cmds: number[]): number[] {
  const argc = [2, 2, 6, 4, 7, 0];
  const out: number[] = [];
  for (let i = 0; i < cmds.length; i += 1 + argc[cmds[i]]) out.push(cmds[i]);
  return out;
}

const QUADRATIC = 3;
const edgePath = (scene: Scene): number[] => shapesOf(scene, items(scene, 'pele-edge')[0]).find((h) => h.kind === 'stroke')!.cmds;

function layout(body: string): Map<string, Box> {
  return nodeBoxes(draw('architecture-beta\n' + body).scene);
}

describe('architecture rendering', () => {
  it('draws every service, group, and edge of the documentation example', () => {
    const { scene, type, width, height } = draw(docs[0]);
    expect(type).toBe('architecture');
    expect(supports(docs[0])).toBe(true);
    expect(items(scene, 'pele-service')).toHaveLength(4);
    expect(items(scene, 'pele-cluster')).toHaveLength(1);
    expect(items(scene, 'pele-edge')).toHaveLength(3);
    expect(lines(scene)).toContain('Database');
    expect(shapesOf(scene, itemById(scene, 'db')!)).toHaveLength(3);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(100);
  });

  it('renders every documentation example', () => {
    for (const src of docs) {
      const result = draw(src);
      expect(result.type, src).toBe('architecture');
      expect(sceneProblem(result), src).toBeUndefined();
    }
  });

  it('places a node on the side its edge names', () => {
    const facing = layout('service a\nservice b\nservice c\nservice d\nservice e\na:R -- L:b\na:L -- R:c\na:T -- B:d\na:B -- T:e');
    const a = facing.get('a')!;
    expect(facing.get('b')!.x0).toBeGreaterThan(a.x0);
    expect(facing.get('b')!.y0).toBe(a.y0);
    expect(facing.get('c')!.x0).toBeLessThan(a.x0);
    expect(facing.get('c')!.y0).toBe(a.y0);
    expect(facing.get('d')!.y0).toBeLessThan(a.y0);
    expect(facing.get('d')!.x0).toBe(a.x0);
    expect(facing.get('e')!.y0).toBeGreaterThan(a.y0);
    expect(facing.get('e')!.x0).toBe(a.x0);
  });

  it('places a node diagonally when the sides are perpendicular', () => {
    const bent = layout('service a\nservice b\nservice c\na:R -- T:b\na:T -- R:c');
    const a = bent.get('a')!;
    expect(bent.get('b')!.x0).toBeGreaterThan(a.x0);
    expect(bent.get('b')!.y0).toBeGreaterThan(a.y0);
    expect(bent.get('c')!.x0).toBeLessThan(a.x0);
    expect(bent.get('c')!.y0).toBeLessThan(a.y0);
    const reversed = layout('service a\nservice b\nb:T -- R:a');
    expect(reversed.get('b')!.x0).toBeGreaterThan(reversed.get('a')!.x0);
    expect(reversed.get('b')!.y0).toBeGreaterThan(reversed.get('a')!.y0);
  });

  it('gives every node its own cell when edges ask for the same one', () => {
    const boxes = [...layout('service hub\n' + Array.from({ length: 9 }, (_, i) => `service n${i}\nhub:R -- L:n${i}`).join('\n')).values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(apart(boxes[i], boxes[j])).toBe(true);
    const hub = boxes[0];
    for (const box of boxes.slice(1)) expect(box.x0).toBeGreaterThan(hub.x0);
  });

  it('keeps unconnected parts apart', () => {
    const boxes = [...layout('service a\nservice b\nservice c\nservice d\nservice e\njunction j\na:R -- L:b').values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(apart(boxes[i], boxes[j])).toBe(true);
  });

  it('draws a group around its members and nothing else', () => {
    const src =
      'architecture-beta\ngroup fe[Frontend]\ngroup be[Backend]\ngroup inner[Inner] in be\nservice web in fe\nservice gw in be\n' +
      'service auth in inner\nservice out\nservice mid\nweb:R -- L:mid\nmid:R -- L:gw\ngw:B -- T:auth\nauth:R -- L:out\nweb:B -- T:out';
    const { scene } = draw(src);
    const nodes = nodeBoxes(scene);
    const clusters = clusterBoxes(scene);
    const fe = clusters.get('fe')!;
    const be = clusters.get('be')!;
    const inner = clusters.get('inner')!;
    expect(inside(nodes.get('web')!, fe)).toBe(true);
    expect(inside(nodes.get('gw')!, be)).toBe(true);
    expect(inside(nodes.get('auth')!, inner)).toBe(true);
    expect(inside(inner, be)).toBe(true);
    expect(apart(fe, be)).toBe(true);
    expect(inside(nodes.get('gw')!, inner)).toBe(false);
    for (const id of ['out', 'mid']) for (const box of [fe, be, inner]) expect(apart(nodes.get(id)!, box)).toBe(true);
  });

  it('keeps random diagrams free of overlaps, with every group around exactly its members', () => {
    const rnd = random(11);
    const pick = (n: number): number => Math.floor(rnd() * n);
    const sides = ['L', 'R', 'T', 'B'];
    for (let round = 0; round < 300; round++) {
      const groupCount = pick(6);
      const nodeCount = 1 + pick(14);
      const groupParent: number[] = [];
      const nodeParent: number[] = [];
      let src = 'architecture-beta\n';
      for (let g = 0; g < groupCount; g++) {
        groupParent.push(g > 0 && rnd() < 0.5 ? pick(g) : -1);
        src += `group g${g}${rnd() < 0.5 ? '[Group title]' : ''}${groupParent[g] >= 0 ? ` in g${groupParent[g]}` : ''}\n`;
      }
      for (let i = 0; i < nodeCount; i++) {
        nodeParent.push(groupCount > 0 && rnd() < 0.7 ? pick(groupCount) : -1);
        const where = nodeParent[i] >= 0 ? ` in g${nodeParent[i]}` : '';
        src += rnd() < 0.15 ? `junction n${i}${where}\n` : `service n${i}${rnd() < 0.5 ? '[Name]' : ''}${where}\n`;
      }
      for (let k = pick(nodeCount * 2); k > 0; k--) {
        src += `n${pick(nodeCount)}:${sides[pick(4)]} -${rnd() < 0.2 ? '[label]-' : '-'}${rnd() < 0.5 ? '>' : ''} ${sides[pick(4)]}:n${pick(nodeCount)}\n`;
      }
      if (nodeCount > 2 && rnd() < 0.3) src += `align ${rnd() < 0.5 ? 'row' : 'column'} n0 n1 n2\n`;

      const { scene } = draw(src);
      const nodes = nodeBoxes(scene);
      const clusters = clusterBoxes(scene);
      expect(nodes.size, src).toBe(nodeCount);
      expect(clusters.size, src).toBe(groupCount);
      const within = (g: number, ancestor: number): boolean => {
        for (let p = g; p >= 0; p = groupParent[p]) if (p === ancestor) return true;
        return false;
      };
      for (let i = 0; i < nodeCount; i++) {
        const box = nodes.get(`n${i}`)!;
        for (let j = i + 1; j < nodeCount; j++) expect(apart(box, nodes.get(`n${j}`)!), src).toBe(true);
        for (let g = 0; g < groupCount; g++) {
          const member = within(nodeParent[i], g);
          expect(member ? inside(box, clusters.get(`g${g}`)!) : apart(box, clusters.get(`g${g}`)!), `n${i} and g${g} in ${src}`).toBe(true);
        }
      }
      for (let g = 0; g < groupCount; g++) {
        for (let k = 0; k < groupCount; k++) {
          if (g === k) continue;
          const a = clusters.get(`g${g}`)!;
          const b = clusters.get(`g${k}`)!;
          if (within(g, k)) expect(inside(a, b), `g${g} in g${k} in ${src}`).toBe(true);
          else if (!within(k, g)) expect(apart(a, b), `g${g} and g${k} in ${src}`).toBe(true);
        }
      }
    }
  });

  it('follows align directives ahead of edges', () => {
    const row = layout('service a\nservice b\nservice c\nservice p\na:B -- T:p\nb:B -- T:p\nc:B -- T:p\nalign row a b c');
    expect(row.get('a')!.y0).toBe(row.get('b')!.y0);
    expect(row.get('b')!.y0).toBe(row.get('c')!.y0);
    expect(row.get('a')!.x0).toBeLessThan(row.get('b')!.x0);
    expect(row.get('b')!.x0).toBeLessThan(row.get('c')!.x0);
    const column = layout('service a\nservice b\nservice c\nalign column c a b');
    expect(column.get('c')!.x0).toBe(column.get('a')!.x0);
    expect(column.get('c')!.y0).toBeLessThan(column.get('a')!.y0);
    expect(column.get('a')!.y0).toBeLessThan(column.get('b')!.y0);
  });

  it('draws arrowheads only where the edge has them', () => {
    const count = (edge: string): number => {
      const { scene } = draw(`architecture-beta\nservice a\nservice b\n${edge}`);
      return shapesOf(scene, items(scene, 'pele-edge')[0]).filter((h) => h.kind === 'fill').length;
    };
    expect(count('a:R -- L:b')).toBe(0);
    expect(count('a:R --> L:b')).toBe(1);
    expect(count('a:R <-- L:b')).toBe(1);
    expect(count('a:R <--> L:b')).toBe(2);
  });

  it('draws straight, bent, and looping edges as orthogonal paths', () => {
    const path = (body: string): number[] => ops(edgePath(draw('architecture-beta\n' + body).scene));
    const bends = (body: string): number => path(body).filter((op) => op === QUADRATIC).length;
    expect(path('service a\nservice b\na:R -- L:b')).toEqual([0, 1]);
    expect(bends('service a\nservice b\na:R -- T:b')).toBe(1);
    expect(bends('service a\nservice b\na:R -- R:b')).toBe(2);
    expect(bends('service a\na:R -- L:a')).toBe(4);
  });

  it('draws edge labels, junctions, and titles', () => {
    const { scene } = draw('architecture-beta\ntitle Platform\nservice a[Alpha]\nservice b[Beta]\njunction j\na:R -[calls]- L:j\nj:R --> L:b');
    expect(items(scene, 'pele-edge-label')).toHaveLength(1);
    expect(lines(scene)).toContain('calls');
    expect(items(scene, 'pele-junction').map((i) => i.id)).toEqual(['j']);
    expect(lines(scene)).toContain('Platform');
    expect(lines(draw('---\ntitle: From front matter\n---\narchitecture-beta\nservice a').scene)).toContain('From front matter');
    const own = lines(draw('---\ntitle: From front matter\n---\narchitecture-beta\ntitle Own\nservice a').scene);
    expect(own).toContain('Own');
    expect(own).not.toContain('From front matter');
  });

  it('starts a group edge at the border of the group', () => {
    const src = 'architecture-beta\ngroup one\ngroup two\nservice a in one\nservice b in two\na{group}:B --> T:b{group}';
    const { scene } = draw(src);
    const clusters = clusterBoxes(scene);
    const one = clusters.get('one')!;
    const two = clusters.get('two')!;
    const path = edgePath(scene);
    // M x y L x y: the second pair is where the arrowhead's tip is.
    expect(path[2]).toBeCloseTo(one.y1, 1);
    expect(path[5]).toBeCloseTo(two.y0 - 7, 1);
  });

  it('carries a group edge on to a junction inside the group', () => {
    const src = 'architecture-beta\ngroup one\ngroup two\njunction a in one\njunction b in two\na{group}:R --> L:b{group}';
    const { scene } = draw(src);
    const nodes = nodeBoxes(scene);
    const path = edgePath(scene);
    const centre = (box: Box): number => (box.x0 + box.x1) / 2;
    expect(path[1]).toBeCloseTo(centre(nodes.get('a')!), 1);
    expect(path[4]).toBeCloseTo(centre(nodes.get('b')!), 1);
    expect(shapesOf(scene, items(scene, 'pele-edge')[0]).filter((h) => h.kind === 'fill')).toHaveLength(1);
  });

  it('fills icon slots from the resolver, then from the built-in outlines', () => {
    const src = 'architecture-beta\ngroup g(cloud)[G]\nservice a(database)[A] in g\nservice b(logos:aws-lambda)[B] in g\nservice c "S3"[C]\nservice d';
    // A node's own two shapes (square and outline) come first; an icon adds to them.
    const drawn = (scene: Scene, id: string): number => shapesOf(scene, itemById(scene, id)!).length;
    const plain = draw(src).scene;
    expect([drawn(plain, 'g'), drawn(plain, 'a'), drawn(plain, 'b'), drawn(plain, 'c'), drawn(plain, 'd')]).toEqual([3, 3, 2, 2, 2]);
    expect(lines(plain)).toContain('S3');
    const resolved = draw(src, { icons: (name) => (name === 'logos:aws-lambda' ? '<circle r="4"/>' : null) }).scene;
    expect(drawn(resolved, 'b')).toBe(3);
    expect(drawn(resolved, 'a')).toBe(3);
  });

  it('honours iconSize, fontSize, and padding', () => {
    const body = 'architecture-beta\ngroup g[G]\nservice a[A] in g\nservice b[B] in g\na:R -- L:b';
    const config = (text: string): string => `---\nconfig:\n  architecture:\n    ${text}\n---\n${body}`;
    const plain = draw(body);
    const big = draw(config('iconSize: 96'));
    expect(big.width).toBeGreaterThan(plain.width);
    const square = nodeBoxes(big.scene).get('a')!;
    expect([square.x1 - square.x0, square.y1 - square.y0]).toEqual([96, 96]);
    expect(draw(config('padding: 60')).width).toBe(plain.width + 80);
    expect(draw(config('fontSize: 24')).scene.texts.map((t) => t.size)).toEqual([24, 24, 24]);
    expect(sceneProblem(draw(config('iconSize: -5')))).toBeUndefined();
  });

  it('is deterministic', () => {
    for (const src of docs) expect(JSON.stringify(draw(src).scene)).toBe(JSON.stringify(draw(src).scene));
  });

  it('rejects what Mermaid rejects, with its messages', () => {
    const fails = (body: string, message: RegExp | string): void => {
      expect(() => draw('architecture-beta\n' + body)).toThrow(message);
      expect(() => draw('architecture-beta\n' + body)).toThrow(PeleError);
    };
    fails('service a\nservice a', 'The service id [a] is already in use by another node');
    fails('group a\njunction a', 'The junction id [a] is already in use by another group');
    fails('service a in g', "The service [a]'s parent does not exist. Please make sure the parent is created before this service");
    fails('group g in g', 'The group [g] cannot be placed within itself');
    fails('service a\nservice b in a', "The service [b]'s parent is not a group");
    fails('service a\na:R -- L:b', 'The right-hand id [b] does not yet exist. Please create the service/group before declaring an edge to it.');
    fails('group g\nservice a in g\nservice b in g\na{group}:R -- L:b', 'is modified to traverse the group boundary');
    fails('service a\nservice b\nalign row a b c', 'align row references [c], which is not a service or junction');
    fails('service a\nservice b\nalign column a a', 'align column lists [a] more than once');
  });

  it('rejects an edge that names a group, where Mermaid fails with a TypeError', () => {
    expect(() => draw('architecture-beta\ngroup g\nservice a\na:R -- L:g')).toThrow('The right-hand id [g] is a group');
  });

  it('reads the header and ids the way Mermaid 12.1 does', () => {
    expect(() => draw('architecture\nservice a')).toThrow(PeleError);
    // Mermaid lexes a leading L, R, T or B as an edge direction, so such ids do not parse.
    expect(() => draw('architecture-beta\nservice Lambda')).toThrow(PeleError);
    expect(items(draw('architecture-beta\nservice lambda').scene).map((i) => i.id)).toEqual(['lambda']);
  });

  it('reads ids that start with title', () => {
    const model = parse('architecture-beta\ngroup titles(cloud)[G]\nservice title-db(database)[DB] in titles\nservice title_2 in titles\ntitle-db:R -- L:title_2');
    expect(model.type).toBe('architecture');
    if (model.type === 'architecture') {
      expect(model.title).toBeUndefined();
      expect([...model.groups.keys()]).toEqual(['titles']);
      expect([...model.nodes.keys()]).toEqual(['title-db', 'title_2']);
      expect(model.edges.map((e) => [e.lhsId, e.rhsId])).toEqual([['title-db', 'title_2']]);
    }
  });

  it('exposes the model', () => {
    const model = parse('architecture-beta\ntitle T\ngroup g(cloud)[G]\nservice a(server)[A] in g\njunction j\na:R -[x]-> L:j\nalign row a j');
    expect(model.type).toBe('architecture');
    if (model.type === 'architecture') {
      expect(model.title).toBe('T');
      expect([...model.groups.values()]).toEqual([{ id: 'g', icon: 'cloud', title: 'G', in: undefined }]);
      expect([...model.nodes.keys()]).toEqual(['a', 'j']);
      expect(model.edges).toEqual([
        { lhsId: 'a', lhsDir: 'R', lhsInto: false, lhsGroup: false, rhsId: 'j', rhsDir: 'L', rhsInto: true, rhsGroup: false, title: 'x' },
      ]);
      expect(model.layoutHints).toEqual([{ direction: 'row', members: ['a', 'j'] }]);
    }
  });

  it('draws an empty diagram and an empty group', () => {
    const empty = draw('architecture-beta').scene;
    expect([empty.items, empty.texts, empty.shapes]).toEqual([[], [], []]);
    const { scene } = draw('architecture-beta\ngroup g[Nothing here]\ngroup h in g');
    const clusters = clusterBoxes(scene);
    expect(inside(clusters.get('h')!, clusters.get('g')!)).toBe(true);
  });
});
