import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scene } from '../../src/draw/scene.js';
import { assertSafe, draw as render, items } from '../support/scene.js';

const options = { now: 0 };
// Whether two drawings are the same, whatever lines of the source their items came from.
const look = ({ items: parts, ...rest }: Scene): string => JSON.stringify([rest, parts.map(({ id, kind, role, box }) => [id, kind, role, box])]);
const same = (a: Scene, b: Scene): boolean => look(a) === look(b);
const sizes = (scene: Scene): number[] => [...new Set(scene.texts.map((t) => t.size))].sort((a, b) => a - b);
const corpora = readdirSync('tests/corpus')
  .filter((file) => file.endsWith('-docs.json'))
  .sort()
  .map((file) => ({ name: file.replace('-docs.json', ''), sources: JSON.parse(readFileSync(`tests/corpus/${file}`, 'utf8')) as string[] }));
const examples = (name: string): string[] => corpora.find((corpus) => corpus.name === name)!.sources;

const PHONE = 320;

describe('the maxWidth option', () => {
  it('never makes a diagram wider, and leaves one that fits as it was', { timeout: 120000 }, () => {
    for (const { name, sources } of corpora) {
      for (const source of sources) {
        const natural = render(source, options);
        const narrow = render(source, { ...options, maxWidth: PHONE });
        expect(narrow.width, name).toBeLessThanOrEqual(natural.width);
        assertSafe(narrow, name);
        expect(same(render(source, { ...options, maxWidth: natural.width }).scene, natural.scene), name).toBe(true);
      }
    }
  });

  it('draws charts at the width there is, with text at its own size', () => {
    for (const name of ['xychart', 'radar', 'pie']) {
      for (const source of examples(name)) {
        const natural = render(source, options);
        const narrow = render(source, { ...options, maxWidth: PHONE });
        expect(natural.width, name).toBeGreaterThan(PHONE);
        expect(narrow.width, name).toBeLessThanOrEqual(PHONE);
        // Nothing is drawn smaller or larger to fit, though a narrow drawing may leave a size out.
        for (const size of sizes(narrow.scene)) expect(sizes(natural.scene), name).toContain(size);
      }
    }
  });

  it('draws these types narrower than they are by default', () => {
    for (const name of ['sankey', 'treemap', 'gantt', 'wardley', 'quadrant']) {
      const narrower = examples(name).filter((source) => render(source, { ...options, maxWidth: PHONE }).width < render(source, options).width);
      expect(narrower.length, name).toBeGreaterThan(examples(name).length / 2);
    }
  });

  it('puts a legend below a chart that has no room beside it', () => {
    const pie = 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15';
    const wide = render(pie, options);
    const narrow = render(pie, { ...options, maxWidth: PHONE });
    expect(narrow.width).toBeLessThan(wide.width);
    expect(narrow.height).toBeGreaterThan(wide.height);
    // A legend the author placed is left where it is.
    const placed = `---\nconfig:\n  pie:\n    legendPosition: bottom\n---\n${pie}`;
    expect(same(render(placed, { ...options, maxWidth: PHONE }).scene, render(placed, options).scene)).toBe(true);
  });

  it('runs a timeline or a git graph downward when it does not fit across', () => {
    const timeline = 'timeline\n  title History\n  section One\n    2001 : First thing\n    2002 : Second thing\n    2003 : Third thing\n  section Two\n    2004 : Fourth thing\n    2005 : Fifth thing';
    const across = render(timeline, options);
    const down = render(timeline, { ...options, maxWidth: PHONE });
    expect(across.width).toBeGreaterThan(PHONE);
    expect(down.width).toBeLessThanOrEqual(PHONE);
    expect(down.height).toBeGreaterThan(across.height);
    // The same drawing as a timeline written to run down, at that width.
    expect(same(down.scene, render(timeline.replace('timeline', 'timeline TD'), { ...options, maxWidth: PHONE }).scene)).toBe(true);
    expect(same(render(timeline, { ...options, maxWidth: across.width }).scene, across.scene)).toBe(true);

    const git = 'gitGraph\n  commit\n  commit\n  branch develop\n  commit\n  commit\n  checkout main\n  merge develop\n  commit\n  commit\n  commit';
    const wide = render(git, options);
    expect(wide.width).toBeGreaterThan(PHONE);
    expect(same(render(git, { ...options, maxWidth: PHONE }).scene, render(git.replace('gitGraph', 'gitGraph TB:'), options).scene)).toBe(true);
    // A direction the author chose is kept.
    const upward = git.replace('gitGraph', 'gitGraph BT:');
    expect(same(render(upward, { ...options, maxWidth: 100 }).scene, render(upward, options).scene)).toBe(true);
  });

  it('draws a mindmap as an outline when it does not fit', () => {
    const map = 'mindmap\n  root((Plan))\n    Research\n      Read the papers on the subject\n      Interview people\n    Build\n      Prototype\n        First version of the layout\n      Test\n    Ship\n      Write the announcement';
    const across = render(map, options);
    const outline = render(map, { ...options, maxWidth: PHONE });
    expect(across.width).toBeGreaterThan(PHONE);
    expect(outline.width).toBeLessThanOrEqual(PHONE);
    expect(outline.height).toBeGreaterThan(across.height);
    expect(items(outline.scene, 'pele-node').length).toBe(items(across.scene, 'pele-node').length);
    // Links between nodes are lines of their own.
    const links = (scene: Scene): number => scene.shapes.filter((s) => s.kind === 'stroke' && s.item === -1).length;
    expect(links(outline.scene)).toBe(links(across.scene));
    expect(items(outline.scene, 'pele-node').length).toBeGreaterThan(5);
    expect(same(render(map, { ...options, maxWidth: PHONE, autoDirection: false }).scene, across.scene)).toBe(true);
    expect(same(render(map, { ...options, maxWidth: 700 }).scene, across.scene)).toBe(true);
    assertSafe(outline, 'mindmap');
    // The root heads the outline as a pill, whatever round shape the source gave it. A box stays a box.
    const rootKind = (result: ReturnType<typeof render>): string => items(result.scene, 'pele-root')[0].kind;
    expect(rootKind(across)).toContain('pele-shape-circle');
    expect(rootKind(outline)).toContain('pele-shape-stadium');
    expect(rootKind(render(map.replace('root((Plan))', 'root)Plan('), { ...options, maxWidth: PHONE }))).toContain('pele-shape-stadium');
    expect(rootKind(render(map.replace('root((Plan))', 'root[Plan]'), { ...options, maxWidth: PHONE }))).toContain('pele-shape-rect');
    // A deep map keeps to the width by wrapping its labels.
    const deep = 'mindmap\n  root\n' + Array.from({ length: 7 }, (_, i) => `${' '.repeat(4 + 2 * i)}Level ${i} with a fairly long label to wrap`).join('\n');
    expect(render(deep, { ...options, maxWidth: PHONE }).width).toBeLessThanOrEqual(PHONE + 40);
  });

  it('folds a kanban board into rows of columns', () => {
    const board = 'kanban\n' + ['Todo', 'Doing', 'Review', 'Done'].map((name, i) => `  c${i}[${name}]\n    t${i}[Task ${i}]`).join('\n');
    const wide = render(board, options);
    const tops = (scene: Scene): number[] => items(scene, 'pele-column').map((column) => column.box!.y0);
    expect(new Set(tops(wide.scene)).size).toBe(1);
    const phone = render(board, { ...options, maxWidth: PHONE });
    expect(phone.width).toBeLessThanOrEqual(PHONE);
    expect(new Set(tops(phone.scene)).size).toBe(4);
    const tablet = render(board, { ...options, maxWidth: 480 });
    expect(tablet.width).toBeLessThanOrEqual(480);
    expect(new Set(tops(tablet.scene)).size).toBe(2);
  });

  const ACROSS: [string, string, string][] = [
    ['flowchart', 'flowchart LR\n  A[First step] --> B[Second step] --> C[Third step] --> D[Fourth step] --> E[Fifth step]', 'flowchart TB'],
    ['flowchart RL', 'flowchart RL\n  A[First step] --> B[Second step] --> C[Third step] --> D[Fourth step] --> E[Fifth step]', 'flowchart TB'],
    ['state', 'stateDiagram-v2\n  direction LR\n  [*] --> Drafting\n  Drafting --> Reviewing\n  Reviewing --> Publishing\n  Publishing --> Archiving\n  Archiving --> [*]', 'direction TB'],
    ['class', 'classDiagram\n  direction LR\n  Animal <|-- Mammal\n  Mammal <|-- Primate\n  Primate <|-- Hominid\n  Hominid <|-- Human', 'direction TB'],
    ['er', 'erDiagram\n  direction LR\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  LINE_ITEM }|--|| PRODUCT : is', 'direction TB'],
  ];

  it('turns a diagram that runs across to run down when it does not fit a narrow width', () => {
    for (const [name, source, down] of ACROSS) {
      const across = render(source, options);
      expect(across.width, name).toBeGreaterThan(PHONE);
      const turned = render(source, { ...options, maxWidth: PHONE });
      expect(turned.width, name).toBeLessThan(across.width);
      expect(turned.height, name).toBeGreaterThan(across.height);
      // The same drawing as the diagram written to run down.
      expect(same(turned.scene, render(source.replace(/flowchart (?:LR|RL)|direction LR/, down), options).scene), name).toBe(true);
    }
  });

  it('keeps the direction when told to, at a width over the breakpoint, and when across fits', () => {
    for (const [name, source] of ACROSS) {
      const across = render(source, options);
      // Still running across: no taller than it was. It may be set closer together to fit.
      const stays = (extra: object): void => {
        const drawn = render(source, { ...options, ...extra });
        expect(drawn.height, name).toBeLessThanOrEqual(across.height);
        expect(drawn.width, name).toBeLessThanOrEqual(across.width);
      };
      stays({ maxWidth: PHONE, autoDirection: false });
      stays({ maxWidth: 640 });
      stays({ maxWidth: PHONE, directionBreakpoint: 300 });
      // With the breakpoint raised, a diagram too wide for a wide container turns too.
      const raised = render(source, { ...options, maxWidth: Math.round(across.width / 2), directionBreakpoint: across.width });
      expect(raised.height, name).toBeGreaterThan(across.height);
    }
    const small = 'flowchart LR\n  A --> B';
    expect(same(render(small, { ...options, maxWidth: PHONE }).scene, render(small, options).scene)).toBe(true);
    const lanes = 'swimlane-beta LR\n  subgraph One\n    A[First step] --> B[Second step]\n  end\n  subgraph Two\n    C[Third step] --> D[Fourth step]\n  end\n  B --> C';
    const compact = render(lanes, { ...options, maxWidth: 100, autoDirection: false });
    expect(compact.width).toBeLessThan(render(lanes, options).width);
    const laneTops = items(compact.scene, 'pele-lane').map((lane) => lane.box!.y0);
    expect(new Set(laneTops).size).toBe(2);
    expect(compact.scene.texts.some((t) => t.angle === -90)).toBe(true);
  });

  it('gives up spare room in a class diagram or flowchart that does not fit', () => {
    const namespaces =
      '---\nconfig:\n  class:\n    hierarchicalNamespaces: false\n---\nclassDiagram\n  namespace Company.Engineering.Backend {\n    class Developer\n  }\n  namespace Company.Engineering.Frontend {\n    class Designer\n  }\n' +
      '  namespace Company {\n    class CEO\n  }\n  CEO --> Developer : oversees\n  CEO --> Designer : oversees';
    const loose = render(namespaces, options);
    const tight = render(namespaces, { ...options, maxWidth: 700 });
    expect(loose.width).toBeGreaterThan(700);
    expect(tight.width).toBeLessThan(loose.width * 0.7);
    // The names that the arrows now run through are drawn over them.
    expect(items(loose.scene, 'pele-cluster-title')).toEqual([]);
    const titles = items(tight.scene, 'pele-cluster-title');
    expect(titles.length).toBe(2);
    const lastEdge = Math.max(...items(tight.scene, 'pele-relation').map((edge) => tight.scene.items.indexOf(edge)));
    for (const title of titles) expect(tight.scene.items.indexOf(title)).toBeGreaterThan(lastEdge);
    assertSafe(tight, 'class');

    const wide = 'flowchart TB\n  A[Start here] --> ' + Array.from({ length: 8 }, (_, i) => `N${i}[Step number ${i}]`).join(' & ');
    const natural = render(wide, options);
    const closer = render(wide, { ...options, maxWidth: 700 });
    expect(natural.width).toBeGreaterThan(700);
    expect(closer.width).toBeLessThan(natural.width);
    expect(items(closer.scene, 'pele-node').length).toBe(items(natural.scene, 'pele-node').length);
  });

  it('ignores a width that is not a positive number, and survives a tiny one', { timeout: 120000 }, () => {
    for (const { name, sources } of corpora) {
      const source = sources[0];
      const natural = render(source, options).scene;
      for (const maxWidth of [0, -5, NaN, Infinity]) expect(same(render(source, { ...options, maxWidth }).scene, natural), `${name}: ${maxWidth}`).toBe(true);
      const tiny = render(source, { ...options, maxWidth: 1 });
      expect(Number.isFinite(tiny.width) && tiny.width > 0, name).toBe(true);
      assertSafe(tiny, name);
    }
  });
});
