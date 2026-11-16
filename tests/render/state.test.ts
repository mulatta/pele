import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import type { StateModel } from '../../src/index.js';
import type { Scene, SceneItem, SceneShape } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw as drawSource, itemById, items, lineOf, lines, paints, shapesOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('state', /stateDiagram/);

// Path commands are a flat list: an op code, then that op's numbers.
const ARGC = [2, 2, 6, 4, 7, 0];
const Q = 3;
const ops = (cmds: number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) out.push(cmds[i]);
  return out;
};

function draw(body: string): Scene {
  return drawSource('stateDiagram-v2\n' + body).scene;
}

function model(body: string): StateModel {
  return parse('stateDiagram-v2\n' + body) as StateModel;
}

// Whether two scenes draw the same, whatever lines of the source their items came from.
const look = ({ items: parts, ...rest }: Scene): string => JSON.stringify([rest, parts.map(({ id, kind, role, box }) => [id, kind, role, box])]);
const same = (a: Scene, b: Scene): boolean => look(a) === look(b);

const curveOf = (curve: string, body: string, section = 'flowchart'): Scene =>
  drawSource(`---\nconfig:\n  ${section}:\n    curve: ${curve}\n---\nstateDiagram-v2\n${body}`).scene;

const itemOf = (scene: Scene, id: string, cls?: string): SceneItem => {
  const item = itemById(scene, id, cls);
  if (!item) throw new Error(`No item ${id}`);
  return item;
};

// The middle of an item.
function place(scene: Scene, id: string, cls?: string): { x: number; y: number } {
  const box = itemOf(scene, id, cls).box!;
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}

function sizeOf(scene: Scene, id: string): { w: number; h: number } {
  const box = itemOf(scene, id).box!;
  return { w: box.x1 - box.x0, h: box.y1 - box.y0 };
}

// What a transition draws: its line and the arrowhead at the end of it.
function transition(scene: Scene, item: SceneItem): { line: SceneShape; head: SceneShape } {
  const shapes = shapesOf(scene, item);
  return { line: shapes.find((s) => s.kind === 'stroke')!, head: shapes.find((s) => s.kind === 'fill')! };
}

const transitions = (scene: Scene): { line: SceneShape; head: SceneShape }[] => items(scene, 'pele-transition').map((item) => transition(scene, item));

// A line between regions or rows: dashed, and not part of an item.
const dividers = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'stroke' && s.item === -1 && s.dash?.join(' ') === '4 4');

// The shapes that cut the background from under a transition.
const casings = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'stroke' && s.item === -1 && s.paint === 'var(--_bg)');

const ON_LIGHT = 'var(--pele-fg-on-light,#1f1f1f)';
const ON_DARK = 'var(--pele-fg-on-dark,#fff)';

describe('state diagram rendering', () => {
  it('renders every corpus input that parses as a safe scene, the same way each time', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      expect(JSON.stringify(tryDraw(src)!.scene), where).toBe(JSON.stringify(result.scene));
    }
    expect(rendered).toBeGreaterThan(80);
  }, 120_000);

  it('detects both keywords and reports size and type', () => {
    expect(detectType('stateDiagram\n a --> b')).toBe('state');
    expect(detectType('stateDiagram-v2\n a --> b')).toBe('state');
    expect(supports('stateDiagram-v2\n a --> b')).toBe(true);
    const result = drawSource('stateDiagram-v2\n a --> b');
    expect(result.type).toBe('state');
    expect(result.height).toBeGreaterThan(result.width);
  });

  it('themes through custom properties and uses only the shared tokens', () => {
    const scene = draw('[*] --> a\n state a {\n x --> y : go\n }\n note right of a : n\n a --> [*]');
    for (const paint of paints(scene)) expect(paint).toMatch(/^(?:none|var\(--_(?:bg|fg|m|l|s|a|b|c)\))$/);
  });

  it('lays out along the declared direction', () => {
    const tall = drawSource('stateDiagram-v2\n a --> b\n b --> c');
    const wide = drawSource('stateDiagram-v2\n direction LR\n a --> b\n b --> c');
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
    const up = draw('direction BT\n a --> b');
    expect(place(up, 'a').y).toBeGreaterThan(place(up, 'b').y);
    const leftward = draw('direction RL\n a --> b');
    expect(place(leftward, 'a').x).toBeGreaterThan(place(leftward, 'b').x);
  });

  it('draws a state with its id, its description, or a title over description lines', () => {
    expect(lines(draw('s1'))).toContain('s1');
    const described = lines(draw('state "A long name" as s1\n s2 : Other'));
    expect(described).toContain('A long name');
    expect(described).toContain('Other');
    expect(described).not.toContain('s1');
    const scene = draw('s1 : Title\n s1 : first\n s1 : second');
    const own = textsOf(scene, itemOf(scene, 's1'));
    expect(own.map(lineOf)).toEqual(['Title', 'first', 'second']);
    expect(own.filter((t) => t.size < own[0].size).length).toBe(2);
    expect(sizeOf(scene, 's1').h).toBeGreaterThan(sizeOf(draw('s1 : Title'), 's1').h + 30);
  });

  it('draws [*] as a start dot or an end ring, separately in each composite', () => {
    const scene = draw('[*] --> a\n a --> [*]\n state a {\n [*] --> b\n b --> [*]\n }');
    expect(items(scene, 'pele-state-start').length).toBe(2);
    expect(items(scene, 'pele-state-end').length).toBe(2);
    for (const id of ['root_start', 'root_end', 'a_start', 'a_end']) expect(itemById(scene, id), id).toBeDefined();
    expect(items(scene, 'pele-transition').length).toBe(4);
  });

  it('keeps a transition that arrives apart from one that leaves on the same side of a state', () => {
    const scene = draw('  Still --> Moving\n  Moving --> Still');
    const tips = transitions(scene).map(({ head }) => [head.cmds[1], head.cmds[2]]);
    const starts = transitions(scene).map(({ line }) => [line.cmds[1], line.cmds[2]]);
    expect(tips).toHaveLength(2);
    expect(starts).toHaveLength(2);
    for (const [x, y] of tips) {
      const beside = starts.find((start) => Math.abs(start[1] - y) < 1);
      expect(beside).toBeDefined();
      expect(Math.abs(beside![0] - x)).toBeGreaterThanOrEqual(12);
    }
  });

  it('draws a choice as a diamond and fork and join as bars across the flow', () => {
    const body = 'state c <<choice>>\n state f <<fork>>\n state j <<join>>\n [*] --> f\n f --> x\n f --> y\n x --> j\n y --> j\n j --> c\n c --> p : yes\n c --> q : no';
    const down = draw(body);
    // A diamond is a path of four corners.
    expect(shapesOf(down, itemOf(down, 'c', 'pele-state-choice')).every((s) => ops(s.cmds).join('') === '01115')).toBe(true);
    expect(lines(down)).not.toContain('c');
    expect(sizeOf(down, 'f').w).toBeGreaterThan(sizeOf(down, 'f').h * 4);
    expect(itemById(down, 'j', 'pele-state-join')).toBeDefined();
    const across = draw('direction LR\n' + body);
    expect(sizeOf(across, 'f').h).toBeGreaterThan(sizeOf(across, 'f').w * 4);
    expect(items(draw('state f [[fork]]\n f --> x'), 'pele-state-fork').length).toBe(1);
  });

  it('draws a composite as a titled cluster around its states, to any depth', () => {
    const scene = draw('[*] --> A\n state A {\n state B {\n state "Deep name" as C {\n x --> y\n }\n }\n }');
    expect(items(scene, 'pele-state-composite').length).toBe(3);
    expect(lines(scene)).toContain('Deep name');
    const a = sizeOf(scene, 'A');
    const b = sizeOf(scene, 'B');
    const c = sizeOf(scene, 'C');
    expect(a.w).toBeGreaterThan(b.w);
    expect(b.w).toBeGreaterThan(c.w);
    expect(a.h).toBeGreaterThan(b.h);
    expect(scene.items.indexOf(itemOf(scene, 'A'))).toBeLessThan(scene.items.indexOf(itemOf(scene, 'B')));
  });

  it('draws a composite fill the author sets at full opacity', () => {
    const scene = draw('  state Busy {\n    a\n  }\n  state Idle {\n    b\n  }\n  classDef warm fill:#FFF9C4\n  class Busy warm');
    const fills = (id: string): SceneShape[] => shapesOf(scene, itemOf(scene, id)).filter((s) => s.kind === 'fill');
    expect(fills('Busy').map((s) => [s.paint, s.opacity])).toEqual([['#FFF9C4', 1]]);
    expect(fills('Idle').map((s) => [s.paint, s.opacity])).toEqual([['var(--_a)', 0.5]]);
  });

  it('picks a contrasting label color on fills a style sets', () => {
    const scene = draw(
      'direction TB\n classDef notMoving fill:white\n classDef badBadEvent fill:#f00,color:white,font-weight:bold\n [*] --> Still\n Still --> Moving\n Moving --> Crash\n class Still notMoving\n class Crash badBadEvent\n' +
        ' state "Described" as d : first line\n style d fill:#14201a\n state Busy {\n b\n }\n style Busy fill:#FFF9C4'
    );
    const inkOf = (id: string): string[] => textsOf(scene, itemOf(scene, id)).map((t) => t.paint);
    expect(inkOf('Still')).toEqual([ON_LIGHT]);
    expect(inkOf('Crash')).toEqual(['white']);
    expect(textsOf(scene, itemOf(scene, 'Crash')).map((t) => t.weight)).toEqual([700]);
    expect(inkOf('Moving')).toEqual(['var(--_fg)']);
    expect(inkOf('d')).toEqual([ON_DARK, ON_DARK]);
    expect(inkOf('Busy')).toEqual([ON_LIGHT]);
  });

  it('cases transitions that cross a composite fill a style sets and inks those inside it', () => {
    const src = 'state Busy {\n  a --> b\n}\nstate Idle {\n  c --> d\n}\nb --> e\ne --> c\nstyle Busy fill:#FFF9C4';
    const scene = draw(src);
    const edge = (id: string) => transition(scene, itemOf(scene, id, 'pele-transition'));
    const cased = casings(scene).map((s) => JSON.stringify(s.cmds));
    // a --> b inside the composite, b --> e out of it.
    expect(edge('edge0').line.paint).toBe(ON_LIGHT);
    expect(edge('edge0').head.paint).toBe(ON_LIGHT);
    expect(cased).not.toContain(JSON.stringify(edge('edge0').line.cmds));
    expect(cased).toContain(JSON.stringify(edge('edge2').line.cmds));
    expect(edge('edge2').line.paint).not.toContain('--pele-fg-on');
    expect(cased).not.toContain(JSON.stringify(edge('edge3').line.cmds));
    const plain = draw(src.replace('\nstyle Busy fill:#FFF9C4', ''));
    expect(casings(plain)).toEqual([]);
    expect(paints(plain).filter((p) => p.includes('--pele-fg-on'))).toEqual([]);
  });

  it('gives each composite its own direction', () => {
    const scene = draw('state A {\n direction LR\n a1 --> a2\n }\n state B {\n b1 --> b2\n }\n A --> B');
    expect(place(scene, 'a1').y).toBe(place(scene, 'a2').y);
    expect(place(scene, 'a1').x).toBeLessThan(place(scene, 'a2').x);
    expect(place(scene, 'b1').x).toBe(place(scene, 'b2').x);
    // As in Mermaid, a composite does not take the direction of what surrounds it.
    const around = draw('direction LR\n state A {\n a1 --> a2\n }\n A --> z');
    expect(place(around, 'a1').x).toBe(place(around, 'a2').x);
    expect(place(around, 'a1').y).toBeLessThan(place(around, 'a2').y);
    expect(place(around, 'z').y).toBeGreaterThan(place(around, 'a1').y);
    expect(place(around, 'z').y).toBeLessThan(place(around, 'a2').y);
  });

  it('splits a composite into regions with a dashed divider between them', () => {
    const body = 'state A {\n [*] --> a1\n --\n [*] --> b1\n --\n [*] --> c1\n }';
    const scene = draw(body);
    const vertical = (s: SceneShape): boolean => s.cmds[1] === s.cmds[4];
    expect(dividers(scene).length).toBe(2);
    expect(items(scene, 'pele-state-start').length).toBe(3);
    expect(place(scene, 'a1').x).toBeLessThan(place(scene, 'b1').x);
    expect(place(scene, 'b1').x).toBeLessThan(place(scene, 'c1').x);
    expect(dividers(scene).every(vertical)).toBe(true);
    // A transition from one region to the next puts them in a stack, divided the other way.
    const stacked = draw('state A {\n a1\n --\n b1\n }\n a1 --> b1');
    expect(dividers(stacked).length).toBe(1);
    expect(dividers(stacked).some(vertical)).toBe(false);
    expect(place(stacked, 'a1').y).toBeLessThan(place(stacked, 'b1').y);
    // Mermaid fails to draw a composite whose last statement is a divider.
    const trailing = draw('state A {\n x\n --\n y\n --\n }');
    expect(dividers(trailing).length).toBe(1);
    expect(place(trailing, 'x').x).toBeLessThan(place(trailing, 'y').x);
  });

  it('draws notes beside their state, joined by a dashed line', () => {
    const scene = draw('a --> b\n note right of a : on the right\n note left of b\n first line\n second line\n end note');
    expect(items(scene, 'pele-note').length).toBe(2);
    const joins = items(scene, 'pele-note-edge');
    expect(joins.length).toBe(2);
    for (const join of joins) expect(shapesOf(scene, join).some((s) => s.dash && s.dash.length > 0)).toBe(true);
    expect(lines(scene)).toContain('on the right');
    expect(lines(scene)).toContain('first line');
    expect(lines(scene)).toContain('second line');
    expect(place(scene, 'a----note-1').x).toBeGreaterThan(place(scene, 'a').x);
    expect(place(scene, 'a----note-1').y).toBe(place(scene, 'a').y);
    expect(place(scene, 'b----note-2').x).toBeLessThan(place(scene, 'b').x);
    expect(place(scene, 'a').x).toBe(place(scene, 'b').x);
    const across = draw('direction LR\n a --> b\n note right of a : below\n note left of b : above');
    expect(place(across, 'a----note-1').y).toBeGreaterThan(place(across, 'a').y);
    expect(place(across, 'b----note-2').y).toBeLessThan(place(across, 'b').y);
    const onComposite = draw('state A {\n x --> y\n }\n note right of A : about A');
    expect(lines(onComposite)).toContain('about A');
    expect(items(onComposite, 'pele-note-edge').length).toBe(1);
  });

  it('labels transitions, including those to self and across composite borders', () => {
    const scene = draw('state A {\n in1 --> in2 : inner\n in2 --> in2 : again\n }\n out --> in1 : cross\n A --> A : whole\n A --> in1 : enter\n in2 --> A : leave');
    for (const text of ['inner', 'again', 'cross', 'whole', 'enter', 'leave']) expect(lines(scene)).toContain(text);
    expect(items(scene, 'pele-edge-label').length).toBe(6);
    expect(items(scene, 'pele-transition').length).toBe(6);
    expect(transitions(scene).filter(({ head }) => head.cmds.length === 10)).toHaveLength(6);
  });

  it('uses the configured curve for transitions, including those across composite borders', () => {
    for (const dir of ['TB', 'LR']) {
      const body = `direction ${dir}\n state A {\n a --> b\n a --> c\n }\n out --> a\n A --> out`;
      const smooth = draw(body);
      expect(transitions(smooth).some(({ line }) => ops(line.cmds).includes(2))).toBe(true);
      for (const curve of ['linear', 'step', 'stepBefore', 'stepAfter']) {
        const scene = curveOf(curve, body);
        expect(same(scene, smooth)).toBe(false);
        const drawn = transitions(scene);
        expect(drawn).toHaveLength(4);
        const kinds = drawn.map(({ line }) => ops(line.cmds));
        if (curve !== 'linear') expect(kinds.some((k) => k.includes(Q))).toBe(true);
        // Straight runs, and corners rounded only where the curve steps.
        for (const k of kinds) expect(k.every((op, i) => (i === 0 ? op === 0 : curve === 'linear' ? op === 1 : op === 1 || op === Q))).toBe(true);
        // Each path stops just behind its arrowhead, including at composite borders.
        for (const { line, head } of drawn) {
          const end = line.cmds.slice(-2);
          expect(Math.hypot(head.cmds[1] - end[0], head.cmds[2] - end[1])).toBeCloseTo(7, 1);
        }
      }
    }
  });

  it('keeps stepped arrowheads pointing into their states along the flow', () => {
    for (const dir of ['TB', 'LR']) {
      for (const curve of ['step', 'stepBefore', 'stepAfter']) {
        const scene = curveOf(curve, `direction ${dir}\n A --> B\n A --> C\n A --> D\n B --> E\n C --> E\n D --> E\n E --> F : Yes\n E --> A : No`);
        const heads = transitions(scene).map(({ head }) => head.cmds);
        expect(heads).toHaveLength(8);
        // The two back corners are level, or on the same vertical for left-to-right flow.
        for (const m of heads) expect(m[dir === 'TB' ? 5 : 4]).toBeCloseTo(m[dir === 'TB' ? 8 : 7], 5);
      }
    }
  });

  it('ignores a state curve setting, which Mermaid does not have', () => {
    const body = 'a --> b\n a --> c\n b --> d\n c --> d';
    expect(same(curveOf('step', body, 'state'), draw(body))).toBe(true);
  });

  it('keeps the default curve for absent, unknown and non-string settings', () => {
    const body = 'a --> b\n a --> c\n b --> d\n c --> d';
    for (const curve of ['basis', 'unknown', 'stepUnknown', '42', 'true', 'null', '{}']) {
      expect(same(curveOf(curve, body), draw(body)), curve).toBe(true);
    }
  });

  it('keeps self-transitions curved for every curve setting', () => {
    const body = 'a --> a : again';
    for (const curve of ['linear', 'basis', 'step', 'stepBefore', 'stepAfter']) {
      const scene = curveOf(curve, body);
      expect(same(scene, draw(body)), curve).toBe(true);
      expect(transitions(scene)).toHaveLength(1);
    }
  });

  it('keeps the labels of several self-transitions apart', () => {
    const labelY = (scene: Scene, text: string): number => scene.texts.find((t) => lineOf(t) === text)!.y;
    const down = draw('a --> a : one\n a --> a : two\n a --> b');
    expect(labelY(down, 'two') - labelY(down, 'one')).toBeGreaterThanOrEqual(20);
    const across = draw('direction LR\n a --> a : one\n a --> a : two\n a --> b');
    expect(labelY(across, 'two') - labelY(across, 'one')).toBeGreaterThanOrEqual(20);
    expect(labelY(across, 'one')).toBeGreaterThan(place(across, 'a').y + 22);
  });

  it('starts the flow at the initial state even when other states are declared first', () => {
    const scene = draw('state c <<choice>>\n [*] --> a\n a --> c\n c --> b\n b --> a');
    expect(place(scene, 'root_start').y).toBeLessThan(place(scene, 'a').y);
    expect(place(scene, 'a').y).toBeLessThan(place(scene, 'c').y);
    expect(place(scene, 'c').y).toBeLessThan(place(scene, 'b').y);
  });

  it('applies classDef, class, ::: and style to states', () => {
    const scene = draw(
      'classDef hot fill:#f00,color:white,font-weight:bold\n classDef cool stroke:#00f\n a:::cool --> b\n class b hot\n style c fill:#0f0,stroke-width:4px\n b --> c\n state G {\n g1\n }\n class G cool'
    );
    const look = (id: string): [string, string, number][] => shapesOf(scene, itemOf(scene, id)).map((s) => [s.kind, s.paint, s.width ?? 0]);
    expect(itemOf(scene, 'a').kind).toBe('pele-node pele-state cool');
    expect(look('a')[1]).toEqual(['stroke', '#00f', 1]);
    expect(itemOf(scene, 'b').kind).toBe('pele-node pele-state hot');
    expect(look('b')[0]).toEqual(['fill', '#f00', 0]);
    expect(textsOf(scene, itemOf(scene, 'b')).map((t) => [t.paint, t.weight])).toEqual([['white', 700]]);
    expect(look('c')).toEqual([['fill', '#0f0', 0], ['stroke', 'var(--_b)', 4]]);
    expect(itemOf(scene, 'G').kind).toBe('pele-cluster pele-state-composite cool');
    expect(look('G')[1]).toEqual(['stroke', '#00f', 1]);
  });

  it('turns click statements into links, with the URL sanitized', () => {
    const result = drawSource(
      'stateDiagram-v2\n a --> b\n b --> c\n click a "https://example.com/x" "Go there"\n click b href "https://example.org"\n click c "javascript:alert(1)" "no"\n'
    );
    expect(result.links).toEqual([
      { id: 'a', href: 'https://example.com/x', internal: false },
      { id: 'b', href: 'https://example.org/', internal: false },
    ]);
  });

  it('accepts the statements that change nothing: hide empty description, scale, comments', () => {
    const plain = draw('a --> b');
    expect(same(draw('hide empty description\n scale 350 width\n a --> b'), plain)).toBe(true);
    expect(same(draw('%% a comment\n a --> b %% trailing'), plain)).toBe(true);
  });

  it('reads labels as markdown with entities and line breaks', () => {
    const scene = draw('a : **bold** and *italic*\n a --> b : one<br>two\n b : x #35; y');
    const spans = textsOf(scene, itemOf(scene, 'a'))[0].spans;
    expect(spans.map((s) => [s.text, (s.weight ?? 400) > 400, s.italic ?? false])).toEqual([
      ['bold', true, false],
      [' and ', false, false],
      ['italic', false, true],
    ]);
    expect(lines(scene)).toContain('one');
    expect(lines(scene)).toContain('two');
    expect(lines(scene)).toContain('x # y');
  });

  it('keeps Mermaid quirks that change what is drawn', () => {
    // A bare `state name` declares nothing in Mermaid's grammar.
    expect(lines(draw('state lonely\n a --> b'))).not.toContain('lonely');
    // A stereotype given after the state's first use is ignored.
    expect(lines(draw('a --> c\n state c <<choice>>'))).toContain('c');
    // A note's text loses its first character when no space precedes the colon.
    expect(model('note right of a:text').states.get('a')?.note?.text).toBe('ext');
    // A state belongs to the last composite that mentions it.
    const moved = model('state A {\n a1\n }\n state B {\n b1 --> a1\n }') as StateModel & { graph: { nodes: { id: string; parentId?: string }[] } };
    expect(moved.graph.nodes.find((node) => node.id === 'a1')?.parentId).toBe('B');
  });

  it('rejects what Mermaid rejects', () => {
    expect(() => draw('state two words {\n a\n }')).toThrow('Error: State name must be a single word.');
    expect(() => draw('state A {\n x\n }\n A : one\n A : two')).toThrow('Group nodes can only have label.');
    expect(() => draw('a --> b --> c')).toThrow(PeleError);
    expect(() => draw('classDef default fill:red')).toThrow(PeleError);
    expect(() => draw('state A {\n x --> y')).toThrow(/Parse error on line/);
    expect(() => draw('scale 350\n a --> b')).toThrow(/Lexical error on line 2/);
  });

  it('exposes the parsed model', () => {
    const parsed = model('direction LR\n [*] --> a\n a --> b : go\n classDef c fill:red\n class a c\n click a "https://example.com" "tip"\n');
    expect(parsed.type).toBe('state');
    expect(parsed.direction).toBe('LR');
    expect([...parsed.states.keys()]).toEqual(['root_start', 'a', 'b']);
    expect(parsed.relations).toEqual([
      { id1: 'root_start', id2: 'a', relationTitle: '' },
      { id1: 'a', id2: 'b', relationTitle: 'go' },
    ]);
    expect(parsed.states.get('a')?.classes).toEqual(['c']);
    expect(parsed.classes.get('c')?.styles).toEqual(['fill:red']);
    expect(parsed.links.get('a')).toEqual({ url: '"https://example.com"', tooltip: '"tip"' });
  });
});
