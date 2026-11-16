import { describe, expect, it } from 'vitest';
import { detectType, supports } from '../../src/index.js';
import type { SceneResult } from '../../src/index.js';
import type { Box, Scene, SceneShape } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw as drawScene, hasClass, itemById, items, lineOf, lines, paints, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('class', /classDiagram/);
const draw = (body: string, extra: object = {}): SceneResult => drawScene('classDiagram\n' + body, extra);
const scene = (body: string, extra: object = {}): Scene => draw(body, extra).scene;
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

// The first fill of a node or group is its area; an interface, which is a ring on its line
// and a name, has only the name.
function box(s: Scene, id: string): Box {
  const item = s.items.find((i) => i.id === id && (hasClass(i, 'pele-node') || hasClass(i, 'pele-cluster')))!;
  expect(item, `item ${id}`).toBeDefined();
  return shapesOf(s, item).find((h) => h.kind === 'fill')?.box ?? item.box!;
}

const centre = (s: Scene, id: string): [number, number] => {
  const b = box(s, id);
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
};

const relation = (s: Scene, id: string): SceneShape[] => shapesOf(s, itemById(s, id, 'pele-relation')!);

// The line of a relation, and its ends: closed shapes (a filled one is drawn once, or twice
// with its outline).
const lineShape = (s: Scene, id: string): SceneShape => relation(s, id).find((h) => h.kind === 'stroke' && ops(h.cmds).at(-1) !== CLOSE)!;

interface End {
  tip: [number, number];
  circle: boolean;
  filled: boolean;
  corners: number;
}
function ends(s: Scene, id: string): End[] {
  const out = new Map<string, End>();
  for (const h of relation(s, id)) {
    const o = ops(h.cmds);
    if (o.at(-1) !== CLOSE) continue;
    const key = JSON.stringify(h.cmds);
    const seen = out.get(key);
    if (seen !== undefined) seen.filled ||= h.kind === 'fill';
    else out.set(key, { tip: [h.cmds[1], h.cmds[2]], circle: o.includes(ARC), filled: h.kind === 'fill', corners: o.filter((op) => op === MOVE || op === LINE).length });
  }
  return [...out.values()];
}

// The cardinalities sit on no item of their own.
const cardinalities = (s: Scene) => s.texts.filter((t) => t.item === -1);

// The lines drawn across a class: its compartments' dividers.
const dividers = (s: Scene, id: string): SceneShape[] =>
  shapesOf(s, itemById(s, id, 'pele-class')!).filter((h) => h.kind === 'stroke' && ops(h.cmds).every((op) => op === MOVE || op === LINE));

describe('class diagram rendering', () => {
  it('wraps disconnected class groups at maxWidth while keeping each relationship intact', () => {
    const body = 'classA <|-- classB\nclassC *-- classD\nclassE o-- classF\nclassG <-- classH\nclassI -- classJ\nclassK <.. classL\nclassM <|.. classN\nclassO .. classP';
    for (const dir of ['TB', 'BT', 'LR', 'RL']) {
      const source = `classDiagram\ndirection ${dir}\n${body}`;
      const natural = drawScene(source, { autoDirection: false });
      for (const maxWidth of [320, 600]) {
        const narrow = drawScene(source, { maxWidth, autoDirection: false });
        if (natural.width <= maxWidth) {
          expect(json(narrow)).toBe(json(natural));
          continue;
        }
        expect(narrow.width).toBeLessThanOrEqual(maxWidth);
        expect(narrow.height).toBeGreaterThan(natural.height);
        expect(items(narrow.scene, 'pele-class')).toHaveLength(16);
        expect(items(narrow.scene, 'pele-relation')).toHaveLength(8);
        for (const [a, b] of [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['I', 'J'], ['K', 'L'], ['M', 'N'], ['O', 'P']]) {
          const from = centre(narrow.scene, `class${a}`), to = centre(narrow.scene, `class${b}`);
          const oldFrom = centre(natural.scene, `class${a}`), oldTo = centre(natural.scene, `class${b}`);
          expect(to[0] - from[0]).toBeCloseTo(oldTo[0] - oldFrom[0], 2);
          expect(to[1] - from[1]).toBeCloseTo(oldTo[1] - oldFrom[1], 2);
        }
        assertSafe(narrow, source);
        expect(json(drawScene(source, { maxWidth, autoDirection: false }))).toBe(json(narrow));
      }
      expect(json(drawScene(source, { maxWidth: natural.width, autoDirection: false }))).toBe(json(natural));
    }
  });

  it('keeps connected and already fitting class diagrams unchanged', () => {
    for (const body of ['A --> B\nB --> C\nC --> A : uses', 'A --> B\nclass C', 'namespace N {\nclass A\nclass B\n}\nA --> B : calls']) {
      const natural = json(draw(body));
      for (const maxWidth of [0, -1, NaN, Infinity, 5000]) expect(json(draw(body, { maxWidth }))).toBe(natural);
      if (body.startsWith('A --> B\nB --> C') || body.startsWith('namespace')) expect(json(draw(body, { maxWidth: 1 }))).toBe(natural);
    }
  });

  it('keeps the layout when wrapping would not make it narrower', () => {
    const body = 'note "From Duck till Zebra"\nAnimal <|-- Duck\nAnimal <|-- Fish\nAnimal <|-- Zebra\nAnimal <|-- Cat\nAnimal <|-- Dog';
    expect(json(draw(body, { maxWidth: 320 }))).toBe(json(draw(body)));
  });

  it('moves namespaces, notes, relationship labels and self-links with their class groups', () => {
    const body = Array.from({ length: 4 }, (_, i) => `namespace N${i} {\nclass A${i}\nclass B${i}\n}\nA${i} "one" --> "many" B${i} : uses\nnote for A${i} "check"\nB${i} --> B${i} : retry`).join('\n');
    const natural = draw(body);
    const narrow = draw(body, { maxWidth: 600 });
    expect(json(narrow)).not.toBe(json(natural));
    expect(narrow.width).toBeLessThanOrEqual(600);
    const counts = (s: Scene): number[] => [
      ...['pele-class', 'pele-namespace', 'pele-note', 'pele-edge-label'].map((cls) => items(s, cls).length),
      cardinalities(s).length,
      s.shapes.filter((h) => ops(h.cmds).at(-1) === CLOSE && h.item >= 0 && hasClass(s.items[h.item], 'pele-relation')).length,
    ];
    expect(counts(narrow.scene)).toEqual(counts(natural.scene));
    assertSafe(narrow, body);
  });

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
    expect(rendered).toBeGreaterThan(70);
  });

  it('is detected, supported and typed for both keywords', () => {
    for (const keyword of ['classDiagram', 'classDiagram-v2']) {
      const src = `${keyword}\n  Animal <|-- Duck`;
      expect(detectType(src)).toBe('class');
      expect(supports(src)).toBe(true);
      const result = drawScene(src);
      expect(result.type).toBe('class');
      expect(result.scene.w).toBe(result.width);
      expect(result.scene.h).toBe(result.height);
    }
  });

  it('draws with theme tokens only', () => {
    const s = scene('class A {\n +x\n}\nA --> B : uses\nnote for A "n"');
    expect(paints(s).filter((p) => !/^var\(--_\w+\)$/.test(p))).toEqual([]);
    expect(s.shapes.length).toBeGreaterThan(0);
  });

  it('lays out along the declared direction', () => {
    const at = (dir: string): [number, number][] => {
      const s = scene(`direction ${dir}\nA <|-- B`);
      return [centre(s, 'A'), centre(s, 'B')];
    };
    const [tbA, tbB] = at('TB');
    expect(tbB[1]).toBeGreaterThan(tbA[1]);
    const [btA, btB] = at('BT');
    expect(btB[1]).toBeLessThan(btA[1]);
    const [lrA, lrB] = at('LR');
    expect(lrB[0]).toBeGreaterThan(lrA[0]);
    expect(lrB[1]).toBe(lrA[1]);
    const [rlA, rlB] = at('RL');
    expect(rlB[0]).toBeLessThan(rlA[0]);
  });

  it('draws a class as a box with a title, attributes and methods', () => {
    const s = scene('class Duck {\n  +String beakColor\n  -int age\n  +swim()\n  +quack() bool\n}');
    const duck = itemById(s, 'Duck', 'pele-class')!;
    expect(shapesOf(s, duck).filter((h) => h.kind === 'fill')).toHaveLength(1);
    const [title, ...members] = textsOf(s, duck);
    expect([lineOf(title), title.weight]).toEqual(['Duck', 700]);
    expect(members.map(lineOf)).toEqual(['+String beakColor', '-int age', '+swim()', '+quack() : bool']);
    const ys = members.map((t) => t.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    const [divider] = dividers(s, 'Duck');
    expect(dividers(s, 'Duck')).toHaveLength(1);
    expect(ops(divider.cmds)).toEqual([MOVE, LINE, MOVE, LINE]);
    const [above, below] = [divider.cmds[2], divider.cmds[8]];
    expect(above).toBeLessThan(ys[0]);
    expect(below).toBeGreaterThan(ys[1]);
    expect(below).toBeLessThan(ys[2]);
  });

  it('makes the box wide enough for its longest line', () => {
    const width = (body: string): number => {
      const b = box(scene(body), 'A');
      return b.x1 - b.x0;
    };
    expect(width('class A {\n  +aVeryLongMethodName(withParameter: SomeType) ReturnType\n}')).toBeGreaterThan(width('class A {\n  +x\n}') + 200);
  });

  it('sets abstract members in italics', () => {
    const s = scene('class A {\n  +count()$ int\n  +draw()*\n  +String name$\n  +plain\n}');
    const member = (text: string) => s.texts.find((t) => lineOf(t) === text)!;
    expect(member('+draw()').italic).toBe(true);
    for (const text of ['+count() : int', '+String name', '+plain']) expect(member(text).italic, text).toBe(false);
  });

  it('writes generics with angle brackets, in titles and members', () => {
    const s = scene('class Shape~T~ {\n  +List~int~ position\n  +get(List~List~T~~ x) Map~K, V~\n}\nclass Pair~K, V~');
    expect(lines(s)).toEqual(expect.arrayContaining(['Shape<T>', 'Pair<K, V>', '+List<int> position', '+get(List<List<T>> x) : Map<K, V>']));
    expect(itemById(s, 'Shape')).toBeDefined();
  });

  it('shows member text as written, without markup', () => {
    const s = scene('class A {\n  +__init__(self)\n  +op(a *b, c *d)\n  +x <b>bold</b>\n  +amp #38; #lt;tag#gt;\n}');
    expect(lines(s)).toEqual(['A', '+x <b>bold</b>', '+amp & <tag>', '+__init__(self)', '+op(a *b, c *d)']);
  });

  it('shows annotations above the title', () => {
    const s = scene('class Shape {\n  <<interface>>\n  draw()\n}\nclass Color\n<<enumeration>> Color\nclass S <<Service>>');
    const at = (id: string, line: string): number => s.texts.find((t) => t.item === s.items.indexOf(itemById(s, id)!) && lineOf(t) === line)!.y;
    expect(at('Shape', '«interface»')).toBeLessThan(at('Shape', 'Shape'));
    expect(at('Color', '«enumeration»')).toBeLessThan(at('Color', 'Color'));
    expect(at('S', '«Service»')).toBeLessThan(at('S', 'S'));
    expect(lines(s).join()).not.toContain('<<');
  });

  it('keeps empty compartments unless hideEmptyMembersBox is set', () => {
    const height = (s: Scene): number => box(s, 'A').y1 - box(s, 'A').y0;
    const shown = scene('class A');
    const hidden = drawScene('---\nconfig:\n  class:\n    hideEmptyMembersBox: true\n---\nclassDiagram\nclass A\nclass B {\n +x\n}').scene;
    expect(dividers(shown, 'A').length).toBeGreaterThan(0);
    expect(dividers(hidden, 'A')).toEqual([]);
    expect(dividers(hidden, 'B').length).toBeGreaterThan(0);
    expect(height(hidden)).toBeLessThan(height(shown));
    expect(dividers(scene('class A', { config: { class: { hideEmptyMembersBox: true } } }), 'A')).toEqual([]);
  });

  it('measures members in the monospace font when monospace lists them', () => {
    const width = (s: Scene): number => box(s, 'A').x1 - box(s, 'A').x0;
    const plain = scene('class A {\n  +title: string\n}');
    const mono = scene('class A {\n  +title: string\n}', { monospace: ['members'] });
    const [title, member] = textsOf(mono, itemById(mono, 'A')!);
    expect([title.spans[0].mono, member.spans[0].mono]).toEqual([undefined, true]);
    expect(plain.texts.some((t) => t.spans.some((p) => p.mono))).toBe(false);
    expect(width(mono)).toBeGreaterThan(width(plain));
  });

  it('ignores monospace values that do not list members', () => {
    const src = 'class A {\n  +title: string\n  +draw()*\n}';
    const plain = json(draw(src));
    for (const monospace of [[], ['member'], ['attributes'], 'members', { members: true }, true, null]) {
      expect(json(draw(src, { monospace }))).toBe(plain);
    }
    expect(json(draw(src, { config: { class: { monoMembers: true, monospace: ['members'] } } }))).toBe(plain);
    expect(json(draw(src, { monospace: ['attributes', 'members'] }))).toBe(json(draw(src, { monospace: ['members'] })));
  });

  it("keeps a class's own font-family on its members when monospace lists them", () => {
    for (const rule of ['style A color:black,font-family:serif', 'classDef serif color:black,font-family:serif\nclass A:::serif']) {
      const src = `class A {\n  +title: string\n}\nclass B {\n  +title: string\n}\n${rule}`;
      const s = scene(src, { monospace: ['members'] });
      const mono = (id: string): (boolean | undefined)[] => textsOf(s, itemById(s, id)!).map((t) => t.spans[0].mono);
      expect(mono('A')).toEqual([undefined, undefined]);
      expect(mono('B')).toEqual([undefined, true]);
    }
  });

  it('uses the label of a class in place of its name', () => {
    const s = scene('class A["A class with a label"]\nclass `Animal Class!`\nA --> `Animal Class!`');
    expect(textsOf(s, itemById(s, 'A')!).map(lineOf)).toEqual(['A class with a label']);
    expect(itemById(s, 'Animal Class!')).toBeDefined();
    expect(lines(s)).toContain('Animal Class!');
  });

  it('draws each kind of relation end', () => {
    const marks = (relationEnd: string): string[] =>
      ends(scene(`A ${relationEnd} B`), 'id_A_B_1').map((e) => (e.circle ? 'circle' : 'path') + (e.filled ? ' filled' : ''));
    expect(marks('--')).toEqual([]);
    expect(marks('..')).toEqual([]);
    expect(marks('<|--')).toEqual(['path']);
    expect(marks('--|>')).toEqual(['path']);
    expect(marks('*--')).toEqual(['path filled']);
    expect(marks('--*')).toEqual(['path filled']);
    expect(marks('o--')).toEqual(['path']);
    expect(marks('-->')).toEqual(['path filled']);
    expect(marks('<--')).toEqual(['path filled']);
    expect(marks('..>')).toEqual(['path filled']);
    expect(marks('..|>')).toEqual(['path']);
    expect(marks('<|--|>')).toEqual(['path', 'path']);
    expect(marks('*--o')).toEqual(['path filled', 'path']);
    expect(marks('<-->')).toEqual(['path filled', 'path filled']);
    expect(marks('()--()')).toEqual(['circle', 'circle']);
  });

  it('gives each marker its own outline: triangle, diamond, arrowhead', () => {
    const corners = (relationEnd: string): number => ends(scene(`A ${relationEnd} B`), 'id_A_B_1')[0].corners;
    expect(corners('--|>')).toBe(3);
    expect(corners('--*')).toBe(4);
    expect(corners('--o')).toBe(4);
    expect(corners('-->')).toBe(3);
  });

  it('puts the marker at the end the source names, pointing into that class', () => {
    const s = scene('Animal <|-- Duck');
    const [mark] = ends(s, 'id_Animal_Duck_1');
    const [ax] = centre(s, 'Animal');
    expect(mark.tip[0]).toBeCloseTo(ax, 1);
    expect(mark.tip[1]).toBeCloseTo(box(s, 'Animal').y1, 1);
    expect(centre(s, 'Duck')[1]).toBeGreaterThan(centre(s, 'Animal')[1]);
  });

  it('stops the line at the back of the marker', () => {
    const at = (relationEnd: string): [number, number] => {
      const { cmds } = lineShape(scene(`A ${relationEnd} B`), 'id_A_B_1');
      return [cmds[2], cmds[5]];
    };
    const [plainStart, plainEnd] = at('--');
    expect(at('--|>')).toEqual([plainStart, plainEnd - 12]);
    expect(at('<|--')).toEqual([plainStart + 12, plainEnd]);
    expect(at('*--o')).toEqual([plainStart + 16, plainEnd - 16]);
    expect(at('()--()')).toEqual([plainStart + 10, plainEnd - 10]);
  });

  it('dashes the line of a dotted relation only', () => {
    const dashOf = (relationEnd: string): (number[] | null | undefined)[] => relation(scene(`A ${relationEnd} B`), 'id_A_B_1').map((h) => h.dash);
    expect(dashOf('..>')[0]).toEqual([6, 4]);
    expect(dashOf('-->')[0]).toBeNull();
    expect(dashOf('..|>')).toEqual([[6, 4], null]);
  });

  it('labels relations and writes the cardinality at each end', () => {
    const s = scene('Customer "1" --> "0..*" Ticket : buys');
    expect(items(s, 'pele-relation')).toHaveLength(1);
    expect(textsOf(s, itemById(s, 'id_Customer_Ticket_1', 'pele-edge-label')!).map(lineOf)).toEqual(['buys']);
    const cards = cardinalities(s);
    expect(cards.map(lineOf)).toEqual(['1', '0..*']);
    const customerY = centre(s, 'Customer')[1];
    const ticketY = centre(s, 'Ticket')[1];
    const mid = (customerY + ticketY) / 2;
    expect(cards[0].y).toBeLessThan(mid);
    expect(cards[0].y).toBeGreaterThan(customerY);
    expect(cards[1].y).toBeGreaterThan(mid);
    expect(cards[1].y).toBeLessThan(ticketY);
  });

  it('runs an end with text straight beside the text, which sits on the side the line then bends to', () => {
    const s = scene('Hub "1" --> "a" A\nHub "2" --> "b" B');
    const x = (text: string): number => cardinalities(s).find((t) => lineOf(t) === text)!.x;
    for (const [id, own, far] of [['id_Hub_A_1', '1', 'a'], ['id_Hub_B_2', '2', 'b']]) {
      const { cmds } = lineShape(s, id);
      expect(ops(cmds).slice(0, 3)).toEqual([MOVE, LINE, CUBIC]);
      const d = [cmds[1], cmds[2], cmds[4], cmds[5], cmds.at(-2)!, cmds.at(-1)!];
      expect(d[2]).toBe(d[0]);
      expect(d[3] - d[1]).toBeGreaterThanOrEqual(20);
      const left = d[4] < d[0];
      expect(x(own) < d[0]).toBe(left);
      expect(x(far) < d[4]).toBe(!left);
    }
  });

  it('spreads the relations that share a side of a class', () => {
    const s = scene('Hub "1" --> "a" A\nHub "2" --> "b" B\nHub "3" --> "c" C');
    const starts = [1, 2, 3].map((n, i) => lineShape(s, `id_Hub_${'ABC'[i]}_${n}`).cmds[1]);
    expect(new Set(starts).size).toBe(3);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(new Set(cardinalities(s).map((t) => t.x + ',' + t.y)).size).toBe(6);
  });

  it('draws a relation from a class to itself as a loop', () => {
    const s = scene('class Node\nNode "1" --> "0..1" Node : next');
    expect(ops(lineShape(s, 'id_Node_Node_1').cmds)).toContain(CUBIC);
    expect(ends(s, 'id_Node_Node_1')).toHaveLength(1);
    expect(lines(s)).toContain('next');
    expect(cardinalities(s)).toHaveLength(2);
  });

  it('draws a lollipop interface as a ring with its name beside the class', () => {
    const s = scene('bar ()-- foo\nfoo --() baz');
    expect(itemById(s, 'interface0', 'pele-interface')).toBeDefined();
    expect(textsOf(s, itemById(s, 'interface0')!).map(lineOf)).toEqual(['bar']);
    expect(textsOf(s, itemById(s, 'interface1')!).map(lineOf)).toEqual(['baz']);
    expect(shapesOf(s, itemById(s, 'interface0')!)).toEqual([]);
    expect(ends(s, 'id_interface0_foo_1').map((e) => e.circle)).toEqual([true]);
    expect(ends(s, 'id_foo_interface1_2').map((e) => e.circle)).toEqual([true]);
    expect(items(s, 'pele-class')).toHaveLength(1);
  });

  it('draws notes, and joins a note for a class to it with a dotted line', () => {
    const s = scene('class MyClass\nnote "General<br>note"\nnote for MyClass "About **it**"');
    expect(textsOf(s, itemById(s, 'note0', 'pele-note')!).map(lineOf)).toEqual(['General', 'note']);
    const about = textsOf(s, itemById(s, 'note1', 'pele-note')!)[0];
    expect(about.spans).toEqual([{ text: 'About ' }, { text: 'it', weight: 700 }]);
    const edge = shapesOf(s, itemById(s, 'edgeNote1', 'pele-note-edge')!);
    expect(edge).toHaveLength(1);
    expect(edge[0].dash).toEqual([2, 4]);
    expect(itemById(s, 'edgeNote0')).toBeUndefined();
    expect(items(scene('note for Missing "x"'), 'pele-edge')).toEqual([]);
  });

  it('draws namespaces as nested groups around their classes', () => {
    const s = scene('namespace Outer {\n  class A\n  namespace Inner["In here"] {\n    class B\n  }\n}\nclass C\nA --> B\nB --> C');
    const inside = (id: string, b: Box): boolean => {
      const [x, y] = centre(s, id);
      return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
    };
    const outer = box(s, 'Outer');
    const inner = box(s, 'Outer.Inner');
    expect(items(s, 'pele-namespace').map((i) => i.id)).toEqual(['Outer', 'Outer.Inner']);
    expect(textsOf(s, itemById(s, 'Outer')!).map(lineOf)).toEqual(['Outer']);
    expect(textsOf(s, itemById(s, 'Outer.Inner')!).map(lineOf)).toEqual(['In here']);
    expect(inner.x0).toBeGreaterThan(outer.x0);
    expect(inner.y0).toBeGreaterThan(outer.y0);
    expect(inner.x1).toBeLessThan(outer.x1);
    expect(inner.y1).toBeLessThan(outer.y1);
    expect(inside('A', outer)).toBe(true);
    expect(inside('A', inner)).toBe(false);
    expect(inside('B', inner)).toBe(true);
    expect(inside('C', outer)).toBe(false);
    expect(s.items.indexOf(itemById(s, 'Outer.Inner')!)).toBeLessThan(s.items.indexOf(itemById(s, 'A')!));
  });

  it('makes a namespace of each part of a dotted name, or one flat namespace in compact mode', () => {
    const src = 'namespace Company.Engineering {\n  class Dev\n}';
    const nested = scene(src);
    expect(items(nested, 'pele-namespace')).toHaveLength(2);
    expect(textsOf(nested, itemById(nested, 'Company')!).map(lineOf)).toEqual(['Company']);
    expect(textsOf(nested, itemById(nested, 'Company.Engineering')!).map(lineOf)).toEqual(['Engineering']);
    const flat = scene(src, { config: { class: { hierarchicalNamespaces: false } } });
    expect(items(flat, 'pele-namespace')).toHaveLength(1);
    expect(lines(flat)).toContain('Company.Engineering');
  });

  it('keeps a lollipop interface in the namespace of its class', () => {
    const s = scene('namespace N {\n  class A\n}\nbar ()-- A');
    const n = box(s, 'N');
    const [x, y] = centre(s, 'interface0');
    expect(x).toBeGreaterThan(n.x0);
    expect(x).toBeLessThan(n.x1);
    expect(y).toBeGreaterThan(n.y0);
    expect(y).toBeLessThan(n.y1);
  });

  it('marks a linked class as clickable and reports its link', () => {
    const { scene: s, links } = drawScene(
      'classDiagram\nclass A\nclass B\nclass C\nlink A "https://example.com/a" "Tip A"\nclick B href "https://example.com/b" _self\ncallback C "fn" "Tip C"'
    );
    expect(items(s, 'clickable').map((i) => i.id)).toEqual(['A', 'B', 'C']);
    expect(links).toEqual([
      { id: 'A', href: 'https://example.com/a', internal: false },
      { id: 'B', href: 'https://example.com/b', internal: false },
    ]);
  });

  it('applies style, classDef, cssClass and the ::: shorthand', () => {
    const s = scene(
      'class A\nclass B:::hot\nclass C\nclass D {\n +x$\n}\nclassDef default stroke:#00f\nstyle A fill:#f9f,stroke:#333,stroke-width:4px\nclassDef hot fill:#fdd,color:#900\nclassDef cold fill:#ddf\ncssClass "C,D" cold\nstyle D color:#090'
    );
    const of = (id: string) => shapesOf(s, itemById(s, id)!);
    const [areaA, borderA, dividerA] = of('A');
    expect([areaA.paint, borderA.paint, borderA.width, dividerA.paint]).toEqual(['#f9f', '#333', 4, '#333']);
    expect(items(s, 'hot').map((i) => i.id)).toEqual(['B']);
    expect(of('B').map((h) => h.paint)).toEqual(['#fdd', '#00f', '#00f']);
    expect(textsOf(s, itemById(s, 'B')!)[0].paint).toBe('#900');
    expect(items(s, 'cold').map((i) => i.id)).toEqual(['C', 'D']);
    expect(of('C').map((h) => h.paint)).toEqual(['#ddf', '#00f', '#00f']);
    expect(textsOf(s, itemById(s, 'D')!).map((t) => t.paint)).toEqual(['#090', '#090']);
  });

  it('picks a contrasting text color on fills a style sets', () => {
    const s = scene(
      'class A {\n  <<interface>>\n  +id int\n  +run()\n}\nclass B {\n  +x\n}\nclass C\nclassDef dark fill:#1f3a5f\nclass A:::dark\nstyle B fill:lightyellow,color:#900'
    );
    const paintsOf = (id: string): string[] => textsOf(s, itemById(s, id)!).map((t) => t.paint);
    expect(paintsOf('A')).toEqual(Array(4).fill('var(--pele-fg-on-dark,#fff)'));
    expect(paintsOf('B')).toEqual(['#900', '#900']);
    expect(paintsOf('C')).toEqual(['var(--_fg)']);
  });

  it('lets the later of a style and a classDef win, as Mermaid does', () => {
    const fill = (body: string): string => {
      const s = scene(body);
      return shapesOf(s, itemById(s, 'A')!).find((h) => h.kind === 'fill')!.paint;
    };
    expect(fill('class A:::c\nclassDef c fill:#111\nstyle A fill:#222')).toBe('#222');
    expect(fill('class A:::c\nstyle A fill:#222\nclassDef c fill:#111')).toBe('#111');
    expect(fill('classDef c fill:#111\nclass A:::c\nstyle A fill:#222')).toBe('#222');
    expect(fill('classDef c fill:#111\nclass A:::c')).toBe('#111');
  });

  it('gives every drawn thing the id it has in the source', () => {
    const s = scene('namespace N {\n class A\n}\nA "1" --> "2" B : x\nnote for A "n"\nfoo ()-- B');
    expect(new Set(s.items.map((i) => i.id))).toEqual(new Set(['N', 'A', 'B', 'note0', 'interface0', 'edgeNote0', 'id_A_B_1', 'id_interface0_B_2']));
    for (const cls of ['pele-cluster', 'pele-edge', 'pele-edge-label', 'pele-node', 'pele-note', 'pele-interface']) expect(items(s, cls).length, cls).toBeGreaterThan(0);
  });

  it('keeps every element inside the picture', () => {
    for (const src of ['direction LR\nA "one" --> "a long cardinality" B', 'A "left" --> "right" A', 'Hub "1" --> "many many" A\nHub --> B', 'direction RL\nA "x" <|-- "y" B\nA "z" --> "w" C']) {
      const result = draw(src);
      for (const t of cardinalities(result.scene)) {
        expect(t.x).toBeGreaterThan(0);
        expect(t.x).toBeLessThan(result.width);
        expect(t.y).toBeGreaterThan(0);
        expect(t.y).toBeLessThan(result.height);
      }
    }
  });
});
