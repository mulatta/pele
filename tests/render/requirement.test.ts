import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Scene, SceneItem } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, itemById, items, lineOf, lines, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('requirement', /requirementDiagram/i);

const BASIC = `requirementDiagram

requirement test_req {
id: 1
text: the test text.
risk: high
verifymethod: test
}

element test_entity {
type: simulation
docRef: reqs/test_entity
}

test_entity - satisfies -> test_req
`;

const same = (a: string, b: string): boolean => JSON.stringify(draw(a).scene) === JSON.stringify(draw(b).scene);

// A box's rules between its header, and its fields: a flat path, drawn with a stroke.
const dividers = (scene: Scene, item: SceneItem) => shapesOf(scene, item).filter((s) => s.kind === 'stroke' && s.cmds.length === 6);
const dividersIn = (scene: Scene): number => items(scene, 'pele-node').reduce((n, item) => n + dividers(scene, item).length, 0);
// The circle that marks where a containment starts.
const circleOf = (scene: Scene, edge: SceneItem) => shapesOf(scene, edge).filter((s) => s.cmds.length === 20);

describe('requirement rendering', () => {
  it('renders every documentation example as a safe scene, the same way each time', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      expect(JSON.stringify(draw(src).scene), where).toBe(JSON.stringify(result.scene));
    }
    expect(rendered).toBeGreaterThan(9);
  });

  it('draws a box per requirement and element, with a header and fields', () => {
    const { scene, type } = draw(BASIC);
    expect(type).toBe('requirement');
    expect(supports('requirementDiagram\n')).toBe(true);
    expect(items(scene, 'pele-requirement').length).toBe(1);
    expect(items(scene, 'pele-element').length).toBe(1);
    expect(itemById(scene, 'test_req')).toBeDefined();
    expect(lines(scene)).toContain('«Requirement»');
    expect(lines(scene)).toContain('«Element»');
    for (const text of ['ID', 'Text', 'Risk', 'Verification', 'Type', 'Doc Ref', '1', 'the test text.', 'High', 'Test', 'simulation', 'reqs/test_entity']) {
      expect(lines(scene), text).toContain(text);
    }
    expect(dividersIn(scene)).toBe(2);
  });

  it('names each requirement type', () => {
    const types: [string, string][] = [
      ['requirement', 'Requirement'],
      ['functionalRequirement', 'Functional Requirement'],
      ['interfaceRequirement', 'Interface Requirement'],
      ['performanceRequirement', 'Performance Requirement'],
      ['physicalRequirement', 'Physical Requirement'],
      ['designConstraint', 'Design Constraint'],
    ];
    for (const [keyword, name] of types) {
      expect(lines(draw(`requirementDiagram\n${keyword} r {\n}\n`).scene)).toContain(`«${name}»`);
    }
  });

  it('leaves out empty fields and the divider of an empty body', () => {
    const { scene } = draw('requirementDiagram\nrequirement r {\nid: 7\n}\nelement e {\n}\n');
    expect(lines(scene)).toContain('ID');
    expect(lines(scene)).not.toContain('Text');
    expect(lines(scene)).not.toContain('Type');
    expect(dividersIn(scene)).toBe(1);
  });

  it('draws contains with a circled plus at its source and the rest as dashed arrows', () => {
    const { scene } = draw('requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\na - contains -> b\n');
    const edge = items(scene, 'pele-relationship-contains')[0];
    expect(edge.id).toBe('a-b-0');
    expect(circleOf(scene, edge).length).toBe(1);
    expect(shapesOf(scene, edge).every((s) => !s.dash)).toBe(true);
    expect(lines(scene)).toContain('«contains»');
    // The mark sits under the source, which is the upper node.
    const cy = (circleOf(scene, edge)[0].box.y0 + circleOf(scene, edge)[0].box.y1) / 2;
    const a = itemById(scene, 'a')!.box!;
    const b = itemById(scene, 'b')!.box!;
    expect(a.y0).toBeLessThan(b.y0);
    expect(Math.abs(cy - a.y1)).toBeLessThan(Math.abs(cy - b.y0));

    for (const kind of ['copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces']) {
      const arrow = draw(`requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\na - ${kind} -> b\n`).scene;
      const [only] = items(arrow, 'pele-relationship-arrow');
      expect(only, kind).toBeDefined();
      expect(shapesOf(arrow, only).some((s) => s.dash?.join(' ') === '5 4'), kind).toBe(true);
      expect(lines(arrow), kind).toContain(`«${kind}»`);
      expect(circleOf(arrow, only), kind).toEqual([]);
    }
  });

  it('reads a left arrow as the same relationship written the other way round', () => {
    expect(same('requirementDiagram\nrequirement a {\n}\nelement b {\n}\na <- satisfies - b\n', 'requirementDiagram\nrequirement a {\n}\nelement b {\n}\nb - satisfies -> a\n')).toBe(true);
  });

  it('lays out along the declared direction', () => {
    const body = 'requirement a {\n}\nrequirement b {\n}\nrequirement c {\n}\na - contains -> b\nb - contains -> c\n';
    const tall = draw(`requirementDiagram\n${body}`);
    const wide = draw(`requirementDiagram\ndirection LR\n${body}`);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
    const flip = (direction: string): boolean => same(`requirementDiagram\ndirection ${direction}\n${body}`, `requirementDiagram\n${body}`);
    expect(flip('BT')).toBe(false);
    expect(same(`requirementDiagram\ndirection RL\n${body}`, `requirementDiagram\ndirection LR\n${body}`)).toBe(false);
  });

  it('draws self relationships and parallel relationships', () => {
    const { scene } = draw('requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\na - contains -> a\na - traces -> b\na - refines -> b\n');
    expect(items(scene, 'pele-edge').length).toBe(3);
    expect(items(scene, 'pele-edge-label').length).toBe(3);
    expect(itemById(scene, 'a-a-0', 'pele-edge')).toBeDefined();
  });

  it('keeps the ends of edges that share a side apart', () => {
    const { scene } = draw('requirementDiagram\nrequirement a {\n}\nrequirement b {\n}\nrequirement c {\n}\na - contains -> b\na - contains -> c\n');
    const xs = items(scene, 'pele-edge').flatMap((edge) => circleOf(scene, edge).map((s) => (s.box.x0 + s.box.x1) / 2));
    expect(xs.length).toBe(2);
    expect(Math.abs(xs[0] - xs[1])).toBeGreaterThan(12);
  });

  it('does not draw a relationship whose end is not defined', () => {
    const { scene } = draw('requirementDiagram\nrequirement a {\n}\na - contains -> missing\n');
    expect(items(scene, 'pele-edge')).toEqual([]);
    expect(textOf(scene)).not.toContain('missing');
  });

  it('applies style, classDef, class and the ::: shorthand', () => {
    const { scene } = draw(
      `requirementDiagram
requirement a:::hot {
id: 1
}
element b {
type: t
}
element c {
}
classDef hot fill:#f96,stroke:#333,stroke-width:4px
classDef cold color:blue
class b cold
c:::hot,cold
style c stroke:#0a0
`
    );
    const [a, b, c] = ['a', 'b', 'c'].map((id) => itemById(scene, id)!);
    expect(a.kind).toBe('pele-node pele-requirement hot');
    expect(shapesOf(scene, a).slice(0, 2).map((s) => [s.kind, s.paint, s.width ?? 0])).toEqual([['fill', '#f96', 0], ['stroke', '#333', 4]]);
    expect(b.kind).toBe('pele-node pele-element cold');
    expect(c.kind).toBe('pele-node pele-element hot cold');
    expect(shapesOf(scene, c).map((s) => [s.kind, s.paint, s.width ?? 0])).toEqual([['fill', '#f96', 0], ['stroke', '#0a0', 4]]);
    expect(textsOf(scene, b).every((t) => t.paint === 'blue')).toBe(true);
    // The divider takes the stroke but not the fill.
    expect(dividers(scene, a).map((s) => [s.paint, s.width])).toEqual([['#333', 4]]);
    expect(shapesOf(scene, a).filter((s) => s.kind === 'fill').map((s) => s.paint)).not.toContain('#333');
  });

  it('picks a contrasting text color on fills a style sets', () => {
    const { scene } = draw('requirementDiagram\nrequirement a {\nid: 1\ntext: words\n}\nelement b {\ntype: t\n}\nelement c {\n}\nstyle a fill:#1f3a5f\nstyle b fill:#1f3a5f,color:#eee\n');
    const paintsOf = (id: string): string[] => textsOf(scene, itemById(scene, id)!).map((t) => t.paint);
    expect(new Set(paintsOf('a'))).toEqual(new Set(['var(--pele-fg-on-dark,#fff)']));
    expect(new Set(paintsOf('b'))).toEqual(new Set(['#eee']));
    expect(paintsOf('c')).toEqual(['var(--_m)', 'var(--_fg)']);
  });

  it('reads markdown emphasis in names and text', () => {
    const { scene } = draw('requirementDiagram\nrequirement "__name__" {\ntext: "*slanted* and **heavy** words"\n}\n');
    expect(itemById(scene, '__name__')).toBeDefined();
    const [name] = scene.texts.filter((t) => lineOf(t) === 'name');
    expect(name.weight).toBeGreaterThan(400);
    const words = scene.texts.find((t) => lineOf(t) === 'slanted and heavy words')!;
    expect(words.spans.map((s) => [s.text, s.italic ?? false, (s.weight ?? 400) > 400])).toEqual([
      ['slanted', true, false],
      [' and ', false, false],
      ['heavy', false, true],
      [' words', false, false],
    ]);
    expect(textOf(scene)).not.toMatch(/[*_]/);
  });

  it('wraps long text and grows the box to hold it', () => {
    const short = draw('requirementDiagram\nrequirement a {\ntext: short\n}\n');
    const long = draw(`requirementDiagram\nrequirement a {\ntext: "${'many words in a row '.repeat(12)}"\n}\n`);
    expect(long.height).toBeGreaterThan(short.height + 60);
    expect(long.width).toBeLessThan(420);
  });

  it('draws the front matter title', () => {
    const { scene } = draw('---\ntitle: Checkout\n---\nrequirementDiagram\naccTitle: Short name\naccDescr: Longer text\nrequirement a {\n}\n');
    expect(scene.texts.filter((t) => t.item === -1).map(lineOf)).toEqual(['Checkout']);
  });

  it('exposes the model', () => {
    const model = parse(BASIC);
    expect(model.type).toBe('requirement');
    if (model.type === 'requirement') {
      expect(model.requirements.get('test_req')).toMatchObject({ type: 'Requirement', requirementId: '1', risk: 'High', verifyMethod: 'Test' });
      expect(model.elements.get('test_entity')).toMatchObject({ type: 'simulation', docRef: 'reqs/test_entity' });
      expect(model.relations).toEqual([{ type: 'satisfies', src: 'test_entity', dst: 'test_req' }]);
      expect(model.direction).toBe('TB');
    }
  });

  it('keeps Mermaid quirks: the first of two repeated fields wins, and keywords ignore case', () => {
    const model = parse('requirementDiagram\nRequirement a {\nID: first\nid: second\nRISK: HIGH\n}\n');
    if (model.type === 'requirement') {
      expect(model.requirements.get('a')).toMatchObject({ requirementId: 'first', risk: 'High' });
    }
  });

  it('rejects what Mermaid rejects', () => {
    for (const src of [
      'requirementDiagram\nrequirement a {\nid: REQ-1\n}\n',
      'requirementDiagram\nrequirement a { \n}\n',
      'requirementDiagram\nrequirement a {\ntext: test the thing\n}\n',
      'requirementDiagram\na - contains - b\n',
      'requirementDiagram\nstyle a stroke-width:1.5px\n',
      'requirementDiagram\ntitle My diagram\n',
      'requirement a {\n}\n',
    ]) {
      expect(() => draw(src), src).toThrow(PeleError);
    }
    expect(() => draw('requirementDiagram\nrequirement a {\nid: REQ-1\n}\n')).toThrow(/Expecting 'NEWLINE', got 'LINE'/);
  });

  it('refuses a diagram that copies class styles without bound', () => {
    const src = 'requirementDiagram\nrequirement a {\n}\nclassDef c ' + 'a:b,'.repeat(2000) + 'a:b\n' + 'class a c\n'.repeat(600);
    expect(() => draw(src)).toThrow(/too many style declarations/);
  });

  it('renders an empty diagram', () => {
    const { scene } = draw('requirementDiagram\n');
    expect(scene.shapes).toEqual([]);
    expect(scene.texts).toEqual([]);
  });
});
