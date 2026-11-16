import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import type { Path, Scene } from '../../src/draw/scene.js';
import { distanceForOverlap, findSpot, layoutCircles, lensArea, regionPath, type Circle } from '../../src/diagrams/venn/layout.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, itemById, items, lineOf, lines, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('venn', /venn-beta/);

const sceneOf = (src: string): Scene => draw('venn-beta\n' + src).scene;

// The circle each set is drawn as, from its outline.
function circlesOf(scene: Scene): Map<string, Circle> {
  const out = new Map<string, Circle>();
  for (const set of items(scene, 'pele-venn-set')) {
    const { box } = shapesOf(scene, set)[0];
    out.set(set.id, { id: set.id, x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, r: (box.x1 - box.x0) / 2 });
  }
  return out;
}

// Where the first line of a region is written.
function labelAt(scene: Scene, id: string): { x: number; y: number; text: string } {
  const region = itemById(scene, id, 'pele-venn-region');
  if (!region) throw new Error(`no region ${id}`);
  const [text] = textsOf(scene, region);
  return { x: text.x, y: text.y, text: lineOf(text) };
}

// The points a closed path of moves and arcs passes through, and how many arcs it has.
function corners(cmds: Path): { points: { x: number; y: number }[]; arcs: number } {
  const argc = [2, 2, 6, 4, 7, 0];
  const points: { x: number; y: number }[] = [];
  let arcs = 0;
  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i];
    const end = i + 1 + argc[op];
    if (op === 0 || op === 4) points.push({ x: cmds[end - 2], y: cmds[end - 1] });
    if (op === 4) arcs++;
    i = end;
  }
  return { points, arcs };
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const area = (c: Circle): number => Math.PI * c.r * c.r;

describe('venn diagram rendering', () => {
  it('renders every corpus input that parses, the same each time', () => {
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
    expect(rendered).toBeGreaterThan(20);
  });

  it('is detected, supported and typed', () => {
    const src = 'venn-beta\n  set A\n  set B\n  union A,B';
    expect(detectType(src)).toBe('venn');
    expect(supports(src)).toBe(true);
    expect(draw(src).type).toBe('venn');
    const model = parse(src);
    expect(model.type).toBe('venn');
    if (model.type === 'venn') {
      expect(model.subsets).toEqual([
        { sets: ['A'], size: 10, label: undefined },
        { sets: ['B'], size: 10, label: undefined },
        { sets: ['A', 'B'], size: 2.5, label: undefined },
      ]);
    }
  });

  it('draws one set as one circle with its name in the middle', () => {
    const scene = sceneOf('set Only');
    const circles = circlesOf(scene);
    expect(circles.size).toBe(1);
    const c = circles.get('Only')!;
    const label = labelAt(scene, 'Only');
    expect(label.text).toBe('Only');
    expect(label.x).toBeCloseTo(c.x, 0);
    expect(Math.abs(label.y - c.y)).toBeLessThan(8);
    const [fill, stroke] = shapesOf(scene, itemById(scene, 'Only', 'pele-venn-set')!);
    expect([fill.kind, fill.paint, fill.opacity]).toEqual(['fill', 'var(--pele-series-1,#4c78a8)', 0.2]);
    expect([stroke.kind, stroke.paint]).toEqual(['stroke', 'var(--pele-series-1,#4c78a8)']);
  });

  it('gives each set the next series color', () => {
    const scene = sceneOf('set A\nset B\nset C');
    expect(items(scene, 'pele-venn-set').map((i) => i.id)).toEqual(['A', 'B', 'C']);
    for (const [k, set] of items(scene, 'pele-venn-set').entries()) expect(shapesOf(scene, set)[0].paint).toMatch(new RegExp(`^var\\(--pele-series-${k + 1},`));
  });

  it('keeps sets that share nothing apart', () => {
    const { A, B } = Object.fromEntries(circlesOf(sceneOf('set A\nset B')));
    expect(distance(A, B)).toBeGreaterThan(A.r + B.r);
    expect(A.y).toBeCloseTo(B.y, 1);
  });

  it('sizes two circles by their sets and their overlap by the union', () => {
    for (const [a, b, shared] of [[20, 12, 3], [10, 10, 2.5], [30, 5, 1], [8, 40, 6]]) {
      const { A, B } = Object.fromEntries(circlesOf(sceneOf(`set A:${a}\nset B:${b}\nunion A,B:${shared}`)));
      expect(area(A) / area(B)).toBeCloseTo(a / b, 1);
      const overlap = lensArea(A.r, B.r, distance(A, B));
      expect(overlap / area(A)).toBeCloseTo(shared / a, 2);
    }
  });

  it('puts one circle inside the other when the overlap is the whole smaller set', () => {
    const { A, B } = Object.fromEntries(circlesOf(sceneOf('set A:30\nset B:5\nunion A,B:5')));
    expect(distance(A, B) + B.r).toBeLessThanOrEqual(A.r + 0.02);
    const tooMuch = Object.fromEntries(circlesOf(sceneOf('set A:30\nset B:5\nunion A,B:500')));
    expect(distance(tooMuch.A, tooMuch.B) + tooMuch.B.r).toBeLessThanOrEqual(tooMuch.A.r + 0.02);
  });

  it('lets an overlap of nothing only touch', () => {
    const { A, B } = Object.fromEntries(circlesOf(sceneOf('set A\nset B\nunion A,B:0')));
    expect(distance(A, B)).toBeCloseTo(A.r + B.r, 0);
  });

  it('writes each name in the part of its circle the other does not cover', () => {
    const scene = sceneOf('set A["Alpha"]\nset B["Beta"]\nunion A,B["Both"]');
    const { A, B } = Object.fromEntries(circlesOf(scene));
    const alpha = labelAt(scene, 'A');
    const beta = labelAt(scene, 'B');
    const both = labelAt(scene, 'A|B');
    expect([alpha.text, beta.text, both.text]).toEqual(['Alpha', 'Beta', 'Both']);
    expect(distance(alpha, A)).toBeLessThan(A.r);
    expect(distance(alpha, B)).toBeGreaterThan(B.r);
    expect(distance(beta, B)).toBeLessThan(B.r);
    expect(distance(beta, A)).toBeGreaterThan(A.r);
    expect(distance(both, A)).toBeLessThan(A.r);
    expect(distance(both, B)).toBeLessThan(B.r);
    // The arrangement is symmetric, and so are the labels.
    expect(alpha.y).toBeCloseTo(beta.y, 1);
    expect((alpha.x + beta.x) / 2).toBeCloseTo(both.x, 0);
  });

  it('arranges three sets in a triangle with each pair as far apart as its union asks', () => {
    const scene = sceneOf('set A:20\nset B:14\nset C:9\nunion A,B:4\nunion B,C:2\nunion A,C:3');
    const { A, B, C } = Object.fromEntries(circlesOf(scene));
    expect(lensArea(A.r, B.r, distance(A, B)) / area(A)).toBeCloseTo(4 / 20, 2);
    expect(lensArea(B.r, C.r, distance(B, C)) / area(B)).toBeCloseTo(2 / 14, 2);
    expect(lensArea(A.r, C.r, distance(A, C)) / area(A)).toBeCloseTo(3 / 20, 2);
    // The first two sit side by side and the third below them.
    expect(A.y).toBeCloseTo(B.y, 1);
    expect(A.x).toBeLessThan(B.x);
    expect(C.y).toBeGreaterThan(A.y);
    expect(C.x).toBeGreaterThan(A.x);
    expect(C.x).toBeLessThan(B.x);
  });

  it('gives the middle of three sets a region of its own, and each pair one too', () => {
    const scene = sceneOf('set X\nset Y\nset Z\nunion X,Y["xy"]\nunion Y,Z["yz"]\nunion X,Z["xz"]\nunion X,Y,Z["all"]');
    const { X, Y, Z } = Object.fromEntries(circlesOf(scene));
    const inside = (p: { x: number; y: number }, c: Circle): boolean => distance(p, c) < c.r;
    const all = labelAt(scene, 'X|Y|Z');
    expect(inside(all, X) && inside(all, Y) && inside(all, Z)).toBe(true);
    const xy = labelAt(scene, 'X|Y');
    expect(inside(xy, X) && inside(xy, Y) && !inside(xy, Z)).toBe(true);
    const yz = labelAt(scene, 'Y|Z');
    expect(inside(yz, Y) && inside(yz, Z) && !inside(yz, X)).toBe(true);
    const x = labelAt(scene, 'X');
    expect(inside(x, X) && !inside(x, Y) && !inside(x, Z)).toBe(true);
  });

  it('overlaps every pair of a three-way union that states no pairs', () => {
    const scene = sceneOf('set A\nset B\nset C\nunion A,B,C["Innovation"]');
    const { A, B, C } = Object.fromEntries(circlesOf(scene));
    for (const [p, q] of [[A, B], [B, C], [A, C]]) expect(distance(p, q)).toBeLessThan(p.r + q.r);
    const middle = labelAt(scene, 'A|B|C');
    for (const c of [A, B, C]) expect(distance(middle, c)).toBeLessThan(c.r);
    expect(middle.text).toBe('Innovation');
  });

  it('places more than three sets so that only the stated pairs overlap', () => {
    const scene = sceneOf('set A\nset B\nset C\nset D\nset E\nunion A,B\nunion C,D\nunion D,E');
    const c = Object.fromEntries(circlesOf(scene));
    const overlapping = (p: Circle, q: Circle): boolean => distance(p, q) < p.r + q.r - 0.5;
    expect(overlapping(c.A, c.B)).toBe(true);
    expect(overlapping(c.C, c.D)).toBe(true);
    expect(overlapping(c.D, c.E)).toBe(true);
    for (const [p, q] of [['A', 'C'], ['A', 'D'], ['A', 'E'], ['B', 'C'], ['B', 'D'], ['B', 'E'], ['C', 'E']]) {
      expect(overlapping(c[p], c[q]), `${p} and ${q}`).toBe(false);
    }
  });

  it('writes texts under the label of their region, smaller', () => {
    const scene = sceneOf('set A["Frontend"]\n  text A1["React"]\n  text A2\nset B\nunion A,B["Shared"]\n  text AB1["OpenAPI"]');
    const written = ['Frontend', 'React', 'A2'].map((line) => scene.texts.find((t) => lineOf(t) === line)!);
    expect(written[0].y).toBeLessThan(written[1].y);
    expect(written[1].y).toBeLessThan(written[2].y);
    const react = itemById(scene, 'A1', 'pele-venn-text')!;
    expect(textsOf(scene, react).map((t) => [lineOf(t), t.size, t.paint])).toEqual([['React', 13, 'var(--_m)']]);
    expect(itemById(scene, 'A2', 'pele-venn-text')).toBeDefined();
    // The text of the overlap lies inside both circles.
    const { A, B } = Object.fromEntries(circlesOf(scene));
    const [openapi] = textsOf(scene, itemById(scene, 'AB1', 'pele-venn-text')!);
    expect(lineOf(openapi)).toBe('OpenAPI');
    expect(distance(openapi, A)).toBeLessThan(A.r);
    expect(distance(openapi, B)).toBeLessThan(B.r);
  });

  it('leaves out a text whose sets were never stated together', () => {
    const scene = sceneOf('set A\nset B\ntext A,B orphan\ntext A kept');
    expect(lines(scene)).not.toContain('orphan');
    expect(lines(scene)).toContain('kept');
  });

  it('wraps a label that is wider than its region and keeps it inside the picture', () => {
    const result = draw('venn-beta\nset A["A very long label for a set that goes on and on"]\nset B\nunion A,B["An intersection with a long label"]');
    expect(textsOf(result.scene, itemById(result.scene, 'A', 'pele-venn-region')!).length).toBeGreaterThan(1);
    for (const text of result.scene.texts) {
      const half = metricsMeasurer.width(lineOf(text), text.size, 0) / 2;
      expect(text.x - half).toBeGreaterThanOrEqual(0);
      expect(text.x + half).toBeLessThanOrEqual(result.width);
    }
  });

  it('applies styles to a set, to an overlap and to a text', () => {
    const scene = sceneOf(
      'set A\n  text A1["React"]\nset B\nunion A,B["AB"]\nstyle A fill:#ff6b6b, stroke-width:3\nstyle A,B color:#333\nstyle A1 color:red\nstyle B fill-opacity:0.5\nstyle A stroke:black'
    );
    const [aFill, aStroke] = shapesOf(scene, itemById(scene, 'A', 'pele-venn-set')!);
    expect([aFill.paint, aFill.opacity]).toEqual(['#ff6b6b', 0.2]);
    expect([aStroke.paint, aStroke.width]).toEqual(['black', 3]);
    const [bFill, bStroke] = shapesOf(scene, itemById(scene, 'B', 'pele-venn-set')!);
    expect([bFill.opacity, bStroke.width]).toEqual([0.5, 1]);
    const paintOf = (line: string): string => scene.texts.find((t) => lineOf(t) === line)!.paint;
    expect(paintOf('AB')).toBe('#333');
    expect(paintOf('React')).toBe('red');
    // A text color on an overlap does not draw the overlap.
    expect(items(scene, 'pele-venn-overlap')).toHaveLength(0);
  });

  it('picks a contrasting text color on an overlap a style fills', () => {
    const scene = sceneOf('set A\nset B\nset C\nunion A,B["ab"]\n  text T["note"]\nunion B,C["bc"]\nstyle A,B fill:#1f3a5f\nstyle A fill:navy\nstyle B,C fill:#1f3a5f,color:#eee');
    const paintOf = (line: string): string => scene.texts.find((t) => lineOf(t) === line)!.paint;
    expect(paintOf('ab')).toBe('var(--pele-fg-on-dark,#fff)');
    expect(paintOf('note')).toBe('var(--pele-fg-on-dark,#fff)');
    expect(paintOf('bc')).toBe('#eee');
    // A set's own fill is drawn faint, so its label keeps the theme's color.
    expect(paintOf('A')).toBe('var(--_fg)');
  });

  it('reads the fill under the text from what is drawn last there', () => {
    const paintOf = (src: string, line: string): string => sceneOf(src).texts.find((t) => lineOf(t) === line)!.paint;
    expect(
      paintOf('set A: 100\nset B: 100\nset C: 100\nunion A,B,C["triple"]: 50\nunion A,B["ab"]: 70\nunion A,C["ac"]: 70\nunion B,C["bc"]: 70\nstyle A,B,C fill:black\nstyle A,B fill:white', 'triple')
    ).toBe('var(--pele-fg-on-light,#1f1f1f)');
    expect(paintOf('set A\nstyle A fill:black,fill-opacity:1', 'A')).toBe('var(--pele-fg-on-dark,#fff)');
    expect(paintOf('set A: 100\nset B: 100\nunion A,B["x"]: 5\nstyle A,B fill:black', 'x')).toBe('var(--pele-fg-on-dark,#fff)');
  });

  it('draws an overlap that is given a fill as the shape the circles share', () => {
    const scene = sceneOf('set A\nset B\nset C\nunion A,B["ab"]\nunion A,B,C["abc"]\nstyle A,B fill:gold\nstyle A,B,C fill:#333');
    const circles = [...circlesOf(scene).values()];
    const overlaps = items(scene, 'pele-venn-overlap');
    expect(overlaps.map((o) => [o.id, shapesOf(scene, o)[0].paint])).toEqual([['A|B', 'gold'], ['A|B|C', '#333']]);
    const [lens, middle] = overlaps.map((o) => corners(shapesOf(scene, o)[0].cmds));
    // A lens has two corners and two arcs; the middle of three circles has three of each.
    expect([lens.points.length, lens.arcs]).toEqual([2 + 1, 2]);
    expect([middle.points.length, middle.arcs]).toEqual([3 + 1, 3]);
    // Every corner lies on or inside every circle of its overlap.
    for (const p of lens.points) for (const c of circles.slice(0, 2)) expect(distance(p, c)).toBeLessThan(c.r + 0.1);
    for (const p of middle.points) for (const c of circles) expect(distance(p, c)).toBeLessThan(c.r + 0.1);
  });

  it('draws the title above, without the quotes it may be written in', () => {
    const title = (src: string) => draw(src).scene.texts.find((t) => t.weight === 700);
    const quoted = title('venn-beta\ntitle "Team overlap"\nset A')!;
    expect(lineOf(quoted)).toBe('Team overlap');
    expect(quoted.item).toBe(-1);
    expect(lineOf(title('---\ntitle: From the front matter\n---\nvenn-beta\nset A')!)).toBe('From the front matter');
    const both = draw('---\ntitle: Front\n---\nvenn-beta\ntitle Inside\nset A').scene;
    expect(lines(both)).toContain('Inside');
    expect(textOf(both)).not.toContain('Front');
  });

  it('keeps the character before a comment', () => {
    const model = parse('venn-beta\nset A%% note\nset B:5%% note\nunion A,B%% note');
    if (model.type !== 'venn') throw new Error('wrong type');
    expect(model.subsets.map((s) => s.sets)).toEqual([['A'], ['B'], ['A', 'B']]);
    expect(model.subsets[1].size).toBe(5);
  });

  it('treats a bare title as no title', () => {
    const model = parse('venn-beta\ntitle\nset A\nset title\ntitle Kept\nset B');
    if (model.type !== 'venn') throw new Error('wrong type');
    expect(model.title).toBe('Kept');
    expect(model.subsets.map((s) => s.sets)).toEqual([['A'], ['title'], ['B']]);
  });

  it('reads a name that starts with a keyword and a hyphen', () => {
    const model = parse(
      'venn-beta\nset set-theory\nset union-x\nunion set-theory,union-x["both"]\n  text-5\ntext set-theory text-books\nstyle set-theory fill:red,x:style-y'
    );
    if (model.type !== 'venn') throw new Error('wrong type');
    expect(model.subsets.map((s) => s.sets)).toEqual([['set-theory'], ['union-x'], ['set-theory', 'union-x']]);
    expect(model.textNodes.map((t) => t.id)).toEqual(['-5', 'text-books']);
    expect(model.styles[0].styles.get('x')).toBe('style-y');
  });

  it('uses the last statement about a set or an overlap', () => {
    const scene = sceneOf('set A["first"]:10\nset B:10\nset A["second"]:40');
    const circles = circlesOf(scene);
    expect(circles.size).toBe(2);
    expect(area(circles.get('A')!) / area(circles.get('B')!)).toBeCloseTo(4, 1);
    expect(lines(scene)).toContain('second');
    expect(lines(scene)).not.toContain('first');
  });

  it('draws sets with no size, or a negative one, small rather than not at all', () => {
    const result = draw('venn-beta\nset A:0\nset B:-5\nset C:100');
    const { A, B, C } = Object.fromEntries(circlesOf(result.scene));
    expect(A.r).toBeGreaterThan(20);
    expect(B.r).toBeGreaterThan(20);
    expect(C.r).toBeGreaterThan(A.r);
    assertSafe(result, 'sets with no size');
  });

  it('draws nothing but the frame when there are no sets', () => {
    const result = draw('venn-beta\n');
    expect(result.scene.items).toEqual([]);
    expect(result.scene.shapes).toEqual([]);
    expect(result.scene.texts).toEqual([]);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('rejects what Mermaid rejects', () => {
    const message = (src: string): string => {
      try {
        draw(src);
      } catch (error) {
        expect(error).toBeInstanceOf(PeleError);
        return (error as Error).message;
      }
      return 'no error';
    };
    expect(message('venn-beta\nunion A')).toBe('union requires multiple identifiers');
    expect(message('venn-beta\nset A\nunion A,B')).toBe('unknown set identifier: B');
    expect(message('venn-beta\nset A\nunion A,"B#35;x"')).toBe('unknown set identifier: B#35;x');
    expect(message('venn-beta\nset "B#x"\nset A\nunion A,"B#35;x"')).toBe('unknown set identifier: B#35;x');
    expect(message('venn-beta\nset A,B')).toMatch(/^Parse error on line 2:\nset A,B\n-----\^\nExpecting 'EOF', 'NEWLINE', 'TITLE', 'SET', 'UNION', 'TEXT', 'INDENT_TEXT', 'STYLE', got 'COMMA'$/);
    expect(message('venn-beta\nset A $')).toMatch(/^Lexical error on line 2\. Unrecognized text\./);
  });
});

describe('venn geometry', () => {
  it('finds the distance that gives two circles a wanted overlap', () => {
    for (const [r1, r2, wanted] of [[1, 1, 0.5], [3, 1, 2], [2, 5, 0.01], [1, 1, 3.1]]) {
      const d = distanceForOverlap(r1, r2, wanted);
      expect(lensArea(r1, r2, d)).toBeCloseTo(wanted, 6);
    }
    expect(distanceForOverlap(2, 1, 0)).toBe(3);
    expect(distanceForOverlap(2, 1, -1)).toBe(3);
    expect(distanceForOverlap(2, 1, Math.PI)).toBe(1);
    expect(distanceForOverlap(2, 1, 99)).toBe(1);
    expect(distanceForOverlap(2, 1, NaN)).toBe(3);
  });

  it('measures the lens of two circles', () => {
    expect(lensArea(1, 1, 2)).toBe(0);
    expect(lensArea(1, 1, 0)).toBeCloseTo(Math.PI, 9);
    expect(lensArea(3, 1, 1)).toBeCloseTo(Math.PI, 9);
    // Two unit circles a unit apart share 2π/3 − √3/2.
    expect(lensArea(1, 1, 1)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, 9);
  });

  it('finds the roomiest point of a region', () => {
    const circles: Circle[] = [
      { id: 'a', x: 0, y: 0, r: 10 },
      { id: 'b', x: 12, y: 0, r: 10 },
    ];
    const alone = findSpot(circles, [0], []);
    expect([alone.x, alone.y, alone.margin]).toEqual([0, 0, 10]);
    // Of a, outside b: midway between a's far side at -10 and b's near side at 2.
    const outside = findSpot(circles, [0], [1]);
    expect(outside.x).toBeCloseTo(-4, 1);
    expect(outside.y).toBeCloseTo(0, 1);
    expect(outside.margin).toBeCloseTo(6, 1);
    const lens = findSpot(circles, [0, 1], []);
    expect(lens.x).toBeCloseTo(6, 3);
    expect(lens.margin).toBeCloseTo(4, 3);
    expect(findSpot([circles[0], { id: 'c', x: 30, y: 0, r: 10 }], [0, 1], []).margin).toBeLessThan(0);
  });

  it('outlines what circles share', () => {
    const f = (v: number): string => String(Math.round(v * 100) / 100);
    const a = { id: 'a', x: 0, y: 0, r: 5 };
    expect(regionPath([a], f)).toBe('M-5,0A5,5 0 1 1 5,0A5,5 0 1 1 -5,0Z');
    expect(regionPath([a, { id: 'b', x: 6, y: 0, r: 5 }], f)).toBe('M3,-4A5,5 0 0 1 3,4A5,5 0 0 1 3,-4Z');
    expect(regionPath([a, { id: 'b', x: 20, y: 0, r: 5 }], f)).toBe('');
    // A circle inside another is the whole of what they share.
    expect(regionPath([a, { id: 'b', x: 1, y: 0, r: 2 }], f)).toBe('M-1,0A2,2 0 1 1 3,0A2,2 0 1 1 -1,0Z');
  });

  it('lays out the same circles every time', () => {
    const subsets = [
      { sets: ['A'], size: 10, label: undefined },
      { sets: ['B'], size: 20, label: undefined },
      { sets: ['C'], size: 5, label: undefined },
      { sets: ['D'], size: 5, label: undefined },
      { sets: ['A', 'B'], size: 3, label: undefined },
      { sets: ['C', 'D'], size: 1, label: undefined },
    ];
    expect(layoutCircles(subsets)).toEqual(layoutCircles(subsets));
    for (const c of layoutCircles(subsets)) expect(Number.isFinite(c.x) && Number.isFinite(c.y) && c.r > 0).toBe(true);
  });
});
