import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import type { SceneResult } from '../../src/index.js';
import type { Box, Scene, SceneShape } from '../../src/draw/scene.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw as drawScene, hasClass, itemById, items, lineOf, lines, paints, sceneProblem, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('usecase', /usecase-beta/);

const draw = (src: string, extra: object = {}): SceneResult => drawScene('usecase-beta\n' + src, extra);
const sceneOf = (src: string, extra: object = {}): Scene => draw(src, extra).scene;
const json = (result: SceneResult): string => JSON.stringify(result.scene);

// The ops of a path, one code per command.
function ops(cmds: number[]): number[] {
  const argc = [2, 2, 6, 4, 7, 0];
  const out: number[] = [];
  for (let i = 0; i < cmds.length; i += 1 + argc[cmds[i]]) out.push(cmds[i]);
  return out;
}
const MOVE = 0;
const LINE = 1;
const CUBIC = 2;
const ARC = 4;
const CLOSE = 5;

// Where a node was put: the middle of what it covers.
function at(s: Scene, id: string): { x: number; y: number } {
  const item = items(s).find((i) => i.id === id && !hasClass(i, 'pele-edge') && !hasClass(i, 'pele-edge-label'));
  if (!item) throw new Error(`no node ${id}`);
  return { x: (item.box!.x0 + item.box!.x1) / 2, y: (item.box!.y0 + item.box!.y1) / 2 };
}

// What a node or boundary covers with its first fill: an oval is its ellipse, a boundary its body.
function area(s: Scene, id: string): Box {
  const item = items(s).find((i) => i.id === id && !hasClass(i, 'pele-edge') && !hasClass(i, 'pele-edge-label'))!;
  return shapesOf(s, item).find((h) => h.kind === 'fill')!.box;
}

function ellipse(s: Scene, id: string): { x: number; y: number; rx: number; ry: number } {
  const b = area(s, id);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, rx: (b.x1 - b.x0) / 2, ry: (b.y1 - b.y0) / 2 };
}

// The line of a relationship first, then what ends it.
const edge = (s: Scene, id: string): SceneShape[] => shapesOf(s, itemById(s, id, 'pele-edge')!);
const edges = (s: Scene): string[] => items(s, 'pele-edge').map((i) => i.id);

// Where the line of a relationship starts and ends.
function ends(h: SceneShape): [number, number, number, number] {
  return [h.cmds[1], h.cmds[2], h.cmds.at(-2)!, h.cmds.at(-1)!];
}

// What the edges drawn under the others, to set them off from a fill, are drawn with.
const casings = (s: Scene): SceneShape[] => s.shapes.filter((h) => h.item === -1 && h.kind === 'stroke' && h.width === 5);

describe('use case diagram rendering', () => {
  it('renders every corpus input that parses, as a scene a host can take', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      expect(textOf(result.scene), where).not.toContain('undefined');
      expect(json(tryDraw(src)!), where).toBe(json(result));
    }
    expect(rendered).toBeGreaterThan(60);
  });

  it('is detected, supported and typed', () => {
    const src = 'usecase-beta\nactor User\nUser --> Login';
    expect(detectType(src)).toBe('usecase');
    expect(supports(src)).toBe(true);
    const result = drawScene(src);
    expect(result.type).toBe('usecase');
    expect([result.scene.w, result.scene.h]).toEqual([result.width, result.height]);
    expect(result.links).toEqual([]);
    const model = parse(src);
    expect(model.type).toBe('usecase');
    if (model.type === 'usecase') {
      expect([...model.actors.keys()]).toEqual(['User']);
      expect([...model.useCases.keys()]).toEqual(['Login']);
      expect(model.statements.map((s) => s.kind)).toEqual(['node', 'edge']);
    }
  });

  it('runs left to right unless told otherwise', () => {
    const chain = 'actor A\nA --> B\nB --> C';
    const wide = draw(chain);
    expect(wide.width).toBeGreaterThan(wide.height);
    expect(at(wide.scene, 'A').x).toBeLessThan(at(wide.scene, 'B').x);
    const tall = draw('direction TB\n' + chain);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(at(tall.scene, 'A').y).toBeLessThan(at(tall.scene, 'B').y);
    expect(json(draw('direction TD\n' + chain))).toBe(json(tall));
    const up = sceneOf('direction BT\n' + chain);
    expect(at(up, 'A').y).toBeGreaterThan(at(up, 'B').y);
    const back = sceneOf('direction RL\n' + chain);
    expect(at(back, 'A').x).toBeGreaterThan(at(back, 'B').x);
  });

  it('draws each kind of actor as a figure with its name below', () => {
    const s = sceneOf('actor N("Normal one")\nactor H@{ type: hollow }\nactor W@{ type: awesome }\nactor I@{ icon: "fa:user" }');
    const normal = itemById(s, 'N')!;
    expect(normal.kind).toContain('usecase-actor-normal');
    const [head, outline, body] = shapesOf(s, normal);
    expect(ops(head.cmds)).toContain(ARC);
    expect(body.cmds).toEqual(expect.arrayContaining([MOVE, LINE]));
    expect(textsOf(s, normal).map(lineOf)).toEqual(['Normal one']);
    expect(outline.kind).toBe('stroke');
    expect(textsOf(s, normal)[0].y).toBeGreaterThan(body.box.y1);

    const hollow = itemById(s, 'H')!;
    expect(hollow.kind).toContain('usecase-actor-hollow');
    expect(shapesOf(s, hollow).filter((h) => h.paint === 'var(--_bg)')).toHaveLength(2);
    const awesome = shapesOf(s, itemById(s, 'W')!);
    expect(awesome.map((h) => [h.kind, h.paint])).toEqual([['fill', 'var(--_b)']]);
    const icon = shapesOf(s, itemById(s, 'I')!);
    expect(icon.map((h) => h.kind)).toEqual(['fill', 'stroke']);
    expect(icon[0].box.x1 - icon[0].box.x0).toBeCloseTo(44, 5);
    expect(icon[0].box.y1 - icon[0].box.y0).toBeCloseTo(44, 5);
  });

  it('fills an icon actor from the icon resolver', () => {
    const s = sceneOf('actor I@{ icon: "fa:user" }', { icons: (name: string) => (name === 'fa:user' ? '<path d="M1,1"/>' : null) });
    expect(shapesOf(s, itemById(s, 'I')!).map((h) => h.paint)).toEqual(['var(--_s)', 'var(--_b)', 'var(--_fg)']);
  });

  it('marks business actors and business use cases with a slash', () => {
    const s = sceneOf('actor A@{ business: true }\nactor B@{ type: hollow, business: true }\nU(Use)@{ business: true }\nV(Plain)');
    expect(items(s, 'usecase-business').map((i) => i.id)).toEqual(['A', 'B', 'U']);
    const slash = (id: string): SceneShape | undefined => {
      const last = shapesOf(s, itemById(s, id)!).at(-1)!;
      return JSON.stringify(ops(last.cmds)) === JSON.stringify([MOVE, LINE]) ? last : undefined;
    };
    expect(slash('A')).toBeDefined();
    expect(slash('B')).toBeDefined();
    expect(slash('V')).toBeUndefined();
    // The slash of a use case runs between two points on its oval.
    const { x, y, rx, ry } = ellipse(s, 'U');
    const [x1, y1, x2, y2] = ends(slash('U')!);
    for (const [px, py] of [[x1, y1], [x2, y2]]) expect(((px - x) / rx) ** 2 + ((py - y) / ry) ** 2).toBeCloseTo(1, 1);
    expect(y1).toBeGreaterThan(y);
    expect(y2).toBeLessThan(y);
  });

  it('draws use cases as ovals, and as boxes when written with brackets', () => {
    const s = sceneOf('Login("Sign in")\nReport[Generate report]\n"Reset password"');
    expect(itemById(s, 'Login')!.kind).toBe('pele-node pele-usecase usecase-element usecase-ellipse');
    expect(textsOf(s, itemById(s, 'Login')!).map(lineOf)).toEqual(['Sign in']);
    const box = itemById(s, 'Report')!;
    expect(box.kind).toContain('usecase-rect');
    expect(shapesOf(s, box).map((h) => ops(h.cmds).includes(ARC))).toEqual([true, true]);
    expect(textsOf(s, itemById(s, 'Reset_password')!).map(lineOf)).toEqual(['Reset password']);
    // The oval is wider than its text by more than the box is.
    const { rx } = ellipse(s, 'Login');
    expect(rx * 2).toBeGreaterThan(metricsMeasurer.width('Sign in', 16, 0) + 30);
  });

  it('shows a stereotype above the name of a use case and between figure and name of an actor', () => {
    const s = sceneOf('actor A <<Human>>\nU(Use) <<Core>>');
    const y = (id: string, line: string): number => textsOf(s, itemById(s, id)!).find((t) => lineOf(t) === line)!.y;
    expect(y('U', '«Core»')).toBeLessThan(y('U', 'Use'));
    expect(y('A', '«Human»')).toBeLessThan(y('A', 'A'));
    expect(y('A', '«Human»')).toBeGreaterThan(Math.max(...shapesOf(s, itemById(s, 'A')!).map((h) => h.box.y1)));
  });

  it('draws a boundary around its members and leaves the rest outside', () => {
    const s = sceneOf('actor User\nsystemBoundary Shop["The shop"]\n  Browse\n  actor Clerk\nend\nUser --> Browse');
    const box = area(s, 'Shop');
    expect(itemById(s, 'Shop')!.kind).toBe('pele-cluster pele-boundary system-boundary system-boundary-rect');
    expect(textsOf(s, itemById(s, 'Shop')!).map(lineOf)).toEqual(['The shop']);
    const inside = (id: string): boolean => {
      const p = at(s, id);
      return p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1;
    };
    expect(inside('Browse')).toBe(true);
    expect(inside('Clerk')).toBe(true);
    expect(inside('User')).toBe(false);
    // The actor outside comes before the boundary, on the side its relationship starts from.
    expect(at(s, 'User').x).toBeLessThan(box.x0);
  });

  it('draws a boundary fill the author sets at full opacity', () => {
    const s = sceneOf('systemBoundary S\n  U\nend\nsystemBoundary T\n  V\nend\nstyle S fill:#fee');
    const body = (id: string): SceneShape => shapesOf(s, itemById(s, id)!).find((h) => h.kind === 'fill')!;
    expect([body('S').paint, body('S').opacity]).toEqual(['#fee', 1]);
    expect([body('T').paint, body('T').opacity]).toEqual(['var(--_a)', 0.5]);
  });

  it('picks a contrasting text color on fills a style sets', () => {
    const s = sceneOf(
      'actor A <<Human>>\nU(Use) <<Core>>\nW(Own)\nX(Plain)\njson J@{ "k": "v" }\nsystemBoundary S\n  V\nend\nstyle U fill:#1f3a5f\nstyle A fill:#1f3a5f\nstyle W fill:#1f3a5f,color:#eee\nstyle J fill:navy\nstyle S fill:#FFF9C4'
    );
    const dark = 'var(--pele-fg-on-dark,#fff)';
    const colors = (id: string): string[] => textsOf(s, itemById(s, id)!).map((t) => t.paint);
    expect(colors('U')).toEqual([dark, dark]);
    expect(colors('A')).toEqual(['var(--_m)', 'var(--_fg)']);
    expect(colors('W')).toEqual(['#eee']);
    expect(colors('J')).toEqual([dark, dark, dark]);
    expect(colors('S')).toEqual(['var(--pele-fg-on-light,#1f1f1f)']);
    expect(colors('X')).toEqual(['var(--_fg)']);
  });

  it('cases edges that cross a boundary fill a style sets and inks those inside it', () => {
    const src = 'actor User\nsystemBoundary S\n  Pay\n  Ship\nend\nPay --> Ship\nUser --> Pay\nUser --> Other\nstyle S fill:#BBDEFB';
    const s = sceneOf(src);
    expect(edges(s)).toHaveLength(3);
    // Pay --> Ship lies inside the boundary and takes its ink; User --> Pay crosses into it.
    expect(edges(s).map((id) => edge(s, id)[0].paint)).toEqual(['var(--pele-fg-on-light,#1f1f1f)', 'var(--_l)', 'var(--_l)']);
    // The line and its arrowhead each have one.
    expect(casings(s)).toHaveLength(2);
    expect(casings(s)[0].cmds).toEqual(edge(s, 'edge-1')[0].cmds);
    const plain = sceneOf(src.replace('\nstyle S fill:#BBDEFB', ''));
    expect(casings(plain)).toEqual([]);
    expect(paints(plain).filter((p) => p.includes('--pele-fg-on'))).toEqual([]);
    // A hollow triangle keeps the fill's color inside it.
    const hollow = sceneOf('systemBoundary S\n  Pay\n  Ship\nend\nPay --|> Ship\nstyle S fill:black');
    const [, mark] = edge(hollow, 'edge-0');
    expect([mark.kind, mark.paint]).toEqual(['fill', 'black']);
    expect(edge(hollow, 'edge-0')[2].paint).toBe('var(--pele-fg-on-dark,#fff)');
  });

  it('puts an actor that is pointed at on the far side of the boundary', () => {
    const s = sceneOf('actor User\nactor Bank\nsystemBoundary Shop\n  Pay\nend\nUser --> Pay\nPay --> Bank');
    const box = area(s, 'Shop');
    expect(at(s, 'User').x).toBeLessThan(box.x0);
    expect(at(s, 'Bank').x).toBeGreaterThan(box.x1);
  });

  it('gives a package boundary a tab that holds its title', () => {
    const s = sceneOf('systemBoundary P["Payments"]@{ type: package }\n  Pay\nend');
    const [tab, , body] = shapesOf(s, itemById(s, 'P')!).map((h) => h.box);
    expect(itemById(s, 'P')!.kind).toContain('system-boundary-package');
    expect(tab.x0).toBe(body.x0);
    expect(tab.y1).toBeCloseTo(body.y0, 1);
    expect(tab.x1 - tab.x0).toBeLessThan(body.x1 - body.x0);
    const title = textsOf(s, itemById(s, 'P')!)[0];
    expect(title.x).toBeGreaterThan(tab.x0);
    expect(title.x).toBeLessThan(tab.x1);
    expect(title.y).toBeLessThan(body.y0);
    expect(at(s, 'Pay').y).toBeGreaterThan(body.y0);
  });

  it('draws the marker each association asks for', () => {
    const s = sceneOf('A a@--> B\nA b@<-- B\nA c@-- B\nA d@--o B\nA e@o-- B\nA f@--x B\nA g@x-- B');
    const kinds = (id: string): string[] => edge(s, id).slice(1).map((h) => (ops(h.cmds).includes(ARC) ? 'circle' : 'path'));
    expect(kinds('a')).toEqual(['path']);
    expect(kinds('b')).toEqual(['path']);
    expect(kinds('c')).toEqual([]);
    expect(kinds('d')).toEqual(['circle']);
    expect(kinds('e')).toEqual(['circle']);
    expect(kinds('f')).toEqual(['path']);
    expect(kinds('g')).toEqual(['path']);
    expect(edge(s, 'a')[1].kind).toBe('fill');
    // A cross is two strokes, not a filled head.
    expect(edge(s, 'f')[1].kind).toBe('stroke');
    for (const id of edges(s)) for (const h of edge(s, id)) expect(h.dash ?? null, id).toBeNull();
  });

  it('puts a forward marker at the target and a backward one at the source', () => {
    const s = sceneOf('A a@--> B\nC b@<-- D');
    const tip = (id: string): number => edge(s, id)[1].cmds[1];
    expect(Math.abs(tip('a') - at(s, 'B').x)).toBeLessThan(Math.abs(tip('a') - at(s, 'A').x));
    expect(Math.abs(tip('b') - at(s, 'C').x)).toBeLessThan(Math.abs(tip('b') - at(s, 'D').x));
  });

  it('draws include and extend dashed, with an arrow and their name in guillemets', () => {
    const s = sceneOf('A i@..> : include B\nC e@..> : EXTEND D');
    expect(itemById(s, 'i', 'pele-include')).toBeDefined();
    expect(itemById(s, 'e', 'pele-extend')).toBeDefined();
    for (const id of ['i', 'e']) {
      expect(edge(s, id)[0].dash).toEqual([5, 4]);
      expect(edge(s, id)).toHaveLength(2);
    }
    expect(lines(s)).toEqual(expect.arrayContaining(['«include»', '«extend»']));
    expect(items(s, 'pele-edge-label')).toHaveLength(2);
  });

  it('draws a generalization as a solid line with a hollow triangle', () => {
    const s = sceneOf('actor Admin\nactor Person\nAdmin --|> Person');
    const [line, fill, outline] = edge(s, 'edge-0');
    expect(itemById(s, 'edge-0', 'pele-generalization')).toBeDefined();
    expect(line.dash ?? null).toBeNull();
    expect([fill.kind, fill.paint, outline.kind, outline.paint]).toEqual(['fill', 'var(--_bg)', 'stroke', 'var(--_l)']);
    expect(ops(fill.cmds)).toEqual([MOVE, LINE, LINE, CLOSE]);
    // The line stops at the base of the triangle, not at its tip.
    const [, , ex] = ends(line);
    expect(fill.cmds[1] - ex).toBeCloseTo(12, 0);
  });

  it('labels an association and keeps the label off the nodes', () => {
    const s = sceneOf('actor User\nUser -- "starts a session" --> Login');
    const label = itemById(s, 'edge-0', 'pele-edge-label')!;
    expect(textsOf(s, label).map(lineOf)).toEqual(['starts a session']);
    const { x0, x1 } = shapesOf(s, label)[0].box;
    const login = ellipse(s, 'Login');
    expect(x0).toBeGreaterThan(at(s, 'User').x + 20);
    expect(x1).toBeLessThan(login.x - login.rx);
  });

  it('ends relationships on the outline of an oval and beside the figure of an actor', () => {
    const s = sceneOf('actor User\nUser --> Login\nUser --> Logout\nOther -- Login');
    for (const id of edges(s)) {
      const [sx, sy, ex, ey] = ends(edge(s, id)[0]);
      const target = id === 'edge-1' ? 'Logout' : 'Login';
      const { x, y, rx, ry } = ellipse(s, target);
      // An arrowhead takes up the last 7 units before the outline.
      const reach = id === 'edge-2' ? 0 : 7;
      const onOutline = ((ex + reach - x) / rx) ** 2 + ((ey - y) / ry) ** 2;
      expect(onOutline, id).toBeGreaterThan(0.85);
      expect(onOutline, id).toBeLessThan(1.15);
      if (id !== 'edge-2') {
        const user = at(s, 'User');
        expect(sx - user.x).toBeCloseTo(23, 0);
        // At the height of the figure, above the middle of figure and name together.
        expect(sy).toBeLessThan(user.y);
      }
    }
  });

  it('spreads the relationships that meet on one side of a use case', () => {
    const s = sceneOf('actor A\nactor B\nactor C\nA --> U\nB --> U\nC --> U');
    const ys = edges(s).map((id) => ends(edge(s, id)[0])[3]);
    expect(new Set(ys.map((y) => Math.round(y))).size).toBe(3);
    const sorted = [...ys].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeGreaterThan(6);
  });

  it('gives longer operators more ranks', () => {
    const near = sceneOf('A --> B');
    const far = sceneOf('A ----> B');
    expect(at(far, 'B').x - at(far, 'A').x).toBeGreaterThan(at(near, 'B').x - at(near, 'A').x + 100);
  });

  it('draws a relationship from a use case to itself as a loop with its label beside it', () => {
    for (const dir of ['LR', 'TB']) {
      const s = sceneOf(`direction ${dir}\nLogin loop@..> : include Login`);
      expect(ops(edge(s, 'loop')[0].cmds)).toEqual([MOVE, CUBIC]);
      const { x, y, rx, ry } = ellipse(s, 'Login');
      const label = shapesOf(s, itemById(s, 'loop', 'pele-edge-label')!)[0].box;
      if (dir === 'LR') expect(label.y0).toBeGreaterThan(y + ry);
      else expect(label.x0).toBeGreaterThan(x + rx);
      expect(sceneProblem(draw(`direction ${dir}\nLogin loop@..> : include Login`))).toBeUndefined();
    }
  });

  it('attaches a note to its target with a dotted line and no marker', () => {
    const s = sceneOf('actor User\nnote for User "Starts the workflow"\nnote for Login "`Needs a **session**`"\nUser --> Login');
    expect(items(s, 'usecase-note')).toHaveLength(2);
    expect(lines(s)).toEqual(expect.arrayContaining(['Starts the workflow', 'Needs a session']));
    expect(textsOf(s, itemById(s, 'note-1')!)[0].spans).toEqual([{ text: 'Needs a ' }, { text: 'session', weight: 700, weightVar: '--_w' }]);
    const connectors = items(s, 'pele-note').filter((i) => hasClass(i, 'pele-edge'));
    expect(connectors.map((i) => i.id)).toEqual(['note-0-edge', 'note-1-edge']);
    for (const connector of connectors) {
      const shapes = shapesOf(s, connector);
      expect(shapes).toHaveLength(1);
      expect(shapes[0].dash).toEqual([2, 3]);
    }
  });

  it('draws a JSON node as a table of its leaves in written order', () => {
    const s = sceneOf('json Payload@{\n  "2": "second",\n  "1": "first",\n  "colors": ["Red", "Green"],\n  "address": { "city": "Oslo" },\n  "none": null,\n  "empty": {}\n}');
    const table = itemById(s, 'Payload', 'usecase-json-table')!;
    const [title, ...cells] = textsOf(s, table);
    expect([lineOf(title), title.weight]).toEqual(['Payload', 700]);
    const keyCells = cells.filter((t) => t.paint === 'var(--_m)');
    const valueCells = cells.filter((t) => t.paint === 'var(--_fg)');
    // The second value of an array has no key of its own.
    expect(keyCells.map(lineOf)).toEqual(['2', '1', 'colors', 'address.city', 'none', 'empty']);
    expect(valueCells.map(lineOf)).toEqual(['second', 'first', 'Red', 'Green', 'Oslo', 'null', '{}']);
    // Keys line up in one column and values in another.
    const lefts = valueCells.map((t) => t.x - metricsMeasurer.width(lineOf(t), 14, 0) / 2);
    for (const left of lefts) expect(left).toBeCloseTo(lefts[0], 1);
  });

  it('shows plain labels as written and formats markdown labels', () => {
    const s = sceneOf('A("*n* <b>x</b> \\n &amp;")\nQ("a #quot;q#quot; #40;b#41;")\nB("`**bold** and *italic*`")\nC(*literal*)');
    const label = (id: string) => textsOf(s, itemById(s, id)!);
    expect(label('A').map(lineOf)).toEqual(['*n* <b>x</b> \\n &amp;']);
    expect(label('Q').map(lineOf)).toEqual(['a "q" (b)']);
    expect(label('B')[0].spans).toEqual([{ text: 'bold', weight: 700, weightVar: '--_w' }, { text: ' and ' }, { text: 'italic', italic: true }]);
    expect(label('C').map(lineOf)).toEqual(['*literal*']);
  });

  it('breaks a markdown label where the source breaks', () => {
    const s = sceneOf('A("`first\nsecond`")');
    expect(textsOf(s, itemById(s, 'A')!).map(lineOf)).toEqual(['first', 'second']);
  });

  it('applies classes and styles to nodes, boundaries and explicit edges', () => {
    const s = sceneOf(
      'actor A:::hot\nU(Use)\nsystemBoundary S\n  V\nend\nA e@--> U\nclassDef hot fill:#fee,stroke:#c33,color:#900\nclassDef default stroke-width:2px\nclass U,S,e hot\nstyle U stroke:#06c\nstyle e stroke-width:4px'
    );
    const drawn = (id: string) => shapesOf(s, itemById(s, id)!).map((h) => [h.kind, h.paint, h.width]);
    expect(itemById(s, 'A')!.kind).toContain('usecase-actor-normal hot');
    expect(drawn('A')).toEqual([['fill', '#fee', undefined], ['stroke', '#c33', 2], ['stroke', '#c33', 2]]);
    expect(textsOf(s, itemById(s, 'A')!)[0].paint).toBe('#900');
    // A direct style beats the class, which beats the default class.
    expect(drawn('U')).toEqual([['fill', '#fee', undefined], ['stroke', '#06c', 2]]);
    expect(itemById(s, 'S')!.kind).toBe('pele-cluster pele-boundary system-boundary system-boundary-rect hot');
    expect(drawn('S')).toEqual([['fill', '#fee', undefined], ['stroke', '#c33', 2]]);
    expect(itemById(s, 'e', 'pele-association')!.kind).toContain('hot');
    expect(edge(s, 'e').map((h) => [h.kind, h.paint, h.width])).toEqual([['stroke', '#c33', 4], ['fill', '#c33', undefined]]);
    expect(drawn('V')[1]).toEqual(['stroke', 'var(--_b)', 2]);
  });

  it('keeps the dashes of an animated relationship, without motion', () => {
    const s = sceneOf('A e@--> B\ne@{ animation: slow }\nA f@--> B\nf@{ animate: false }');
    expect(itemById(s, 'e', 'pele-edge')!.kind).toBe('pele-edge pele-association edge-animation-slow');
    expect(edge(s, 'e')[0].dash).toEqual([9, 5]);
    expect(edge(s, 'f')[0].dash ?? null).toBeNull();
  });

  it('draws the front matter title', () => {
    const { scene } = drawScene('---\ntitle: Ordering\n---\nusecase-beta\naccTitle: Online ordering\naccDescr {\n  A customer orders.\n   Staff review.\n}\nactor A');
    const title = scene.texts.find((t) => lineOf(t) === 'Ordering')!;
    expect([title.item, title.weight]).toEqual([-1, 700]);
  });

  it('draws nothing but the frame for a diagram with no statements', () => {
    const result = drawScene('usecase-beta');
    expect([result.scene.items, result.scene.texts, result.scene.shapes]).toEqual([[], [], []]);
    expect(result.width).toBeGreaterThan(0);
  });

  it('reports syntax, lexer and semantic errors as Mermaid words them', () => {
    const message = (src: string): string => {
      try {
        drawScene(src);
      } catch (error) {
        expect(error).toBeInstanceOf(PeleError);
        return (error as PeleError).code + ': ' + (error as Error).message;
      }
      return 'no error';
    };
    expect(message('usecase-beta\nactor A actor B')).toBe(
      "syntax: Error parsing usecase diagram: Expecting: one of these possible Token sequences:\n  1. [NEWLINE]\n  2. [EOF]\nbut found: 'actor' at line 2, column 9 [21,26)"
    );
    expect(message('usecase-beta\nsystemBoundary S\nA --> B\nend')).toBe(
      "syntax: Error parsing usecase diagram: Expecting: one of these possible Token sequences:\n  1. [NEWLINE]\n  2. [EOF]\nbut found: '-->' at line 3, column 3 [32,35)"
    );
    expect(message('usecase-beta\nsystemBoundary S\nA')).toBe(
      "syntax: Error parsing usecase diagram: Expecting token of type --> END <-- but found --> '' <-- at line 4, column 1 [32,32)"
    );
    expect(message('usecase-beta\nA "b')).toBe(
      'syntax: Error lexing usecase diagram: unexpected character: ->"<- at offset: 15, skipped 1 characters. at line 2, column 3 [15,16)'
    );
    expect(message('usecase-beta\nnote for Ghost "x"')).toBe(
      "semantic: Note target 'Ghost' is unresolved at line 2, column 10 [22,27)"
    );
    expect(message('usecase-beta\njson P@{"a":}')).toMatch(/^syntax: Invalid JSON: .* \(line 2, column \d+\)$/);
    expect(() => drawScene('usecase-beta\njson P@{"a":"#35;", "b":}')).toThrow(
      expect.objectContaining({ line: 2, column: 25, message: expect.not.stringMatching(/[ﬂ°¶ß]/) })
    );
    const located = (() => {
      try {
        drawScene('usecase-beta\nactor A\nA --> B\nstyle Z fill:red');
      } catch (error) {
        return error as PeleError;
      }
      return undefined;
    })();
    expect(located).toMatchObject({ code: 'semantic', type: 'usecase', line: 4, column: 7 });
  });
});
