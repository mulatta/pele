import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Scene } from '../../src/draw/scene.js';
import type { RenderOptions } from '../../src/types.js';
import { draw, itemById, items, lineOf, lines, shapesOf } from '../support/scene.js';

// The items that have an icon of their own drawn.
const iconed = (scene: Scene): string[] => items(scene).filter((i) => shapesOf(scene, i).length > 0).map((i) => i.id);

const TREE = 'treeView-beta\n    my-project/\n        src/\n            index.js\n        package.json\n    README.md\n';

describe('treeView rendering', () => {
  it('draws a row per entry, directories in bold, and a guide per parent', () => {
    const { scene, type } = draw(TREE);
    expect(type).toBe('treeView');
    expect(supports(TREE)).toBe(true);
    expect(items(scene, 'pele-node')).toHaveLength(5);
    expect(items(scene, 'pele-tree-dir')).toHaveLength(2);
    expect(scene.texts.find((t) => lineOf(t) === 'my-project')!.weight).toBe(700);
    expect(scene.texts.find((t) => lineOf(t) === 'index.js')!.weight).toBe(400);
    expect(scene.shapes.filter((h) => h.item === -1)).toHaveLength(2);
    expect(lines(scene)).not.toContain('/');
  });

  it('exposes the model as a tree', () => {
    const model = parse(TREE);
    expect(model.type).toBe('treeView');
    if (model.type !== 'treeView') return;
    expect(model.root.children.map((n) => n.name)).toEqual(['my-project', 'README.md']);
    expect(model.root.children[0].children.map((n) => [n.name, n.nodeType])).toEqual([['src', 'directory'], ['package.json', 'file']]);
    expect(model.count).toBe(6);
  });

  it('accepts box-drawing input and gives the same model', () => {
    const boxed = parse('treeView-beta\n├── src/\n│   ├── index.ts\n│   └── utils.ts\n├── package.json\n└── README.md\n');
    const indented = parse('treeView-beta\n    src/\n        index.ts\n        utils.ts\n    package.json\n    README.md\n');
    expect(boxed).toEqual(indented);
  });

  it('reports box-drawing errors against the original lines', () => {
    const src = 'treeView-beta\n│\n├── src/\n│\n│   └── "a\n';
    try {
      draw(src);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PeleError);
      expect((error as PeleError).line).toBe(5);
      expect((error as PeleError).message).toContain('line 5');
    }
    expect(() => draw('treeView-beta\n├── \n')).toThrow('Line 2: Empty node');
    expect(() => draw('treeView-beta\n├── a\n   b\n')).toThrow('Line 3: Unexpected indentation');
    expect(() => draw('---\ntitle: T\n---\ntreeView-beta\n└─ "bad')).toThrow(
      expect.objectContaining({ line: 5, column: 4, snippet: '└─ "bad\n---^', message: expect.stringMatching(/^Lexical error on line 5\./) })
    );
    expect(() => draw('---\ntitle: T\n---\ntreeView-beta\n├── \n')).toThrow('Line 5: Empty node');
    expect(() => draw('treeView-beta\n└─ "ok"\t"bad')).toThrow(expect.objectContaining({ line: 2, column: 9 }));
    expect(() => draw('treeView-beta\n└── "ok"\t\t"bad')).toThrow(
      expect.objectContaining({ line: 2, column: 11, snippet: '└── "ok"\t\t"bad\n----------^' })
    );
    expect(() => draw('---\ntitle: T\n---\ntreeView-beta\n"bad\nhello ─ world\nx\ny')).toThrow(
      expect.objectContaining({ line: 5, column: 1 })
    );
  });

  it('draws highlights, descriptions in one column, and extra classes', () => {
    const { scene } = draw('treeView-beta\n    src/\n        App.tsx :::highlight ## main\n        index.js :::mine ## entry point\n');
    expect(items(scene, 'highlight').map((i) => i.id)).toEqual(['App.tsx']);
    expect(items(scene, 'mine').map((i) => i.id)).toEqual(['index.js']);
    expect(scene.shapes.filter((h) => h.kind === 'fill').map((h) => h.item)).toEqual([scene.items.indexOf(itemById(scene, 'App.tsx')!)]);
    const xs = scene.texts.filter((t) => t.italic).map((t) => t.x);
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBe(xs[1]);
  });

  it('measures names in the monospace font when monospace lists files', () => {
    const src = 'treeView-beta\n    src/\n        App.tsx ## main\n';
    const descX = (scene: Scene): number => scene.texts.find((t) => t.italic)!.x;
    const plain = draw(src).scene;
    for (const maxWidth of [undefined, 90]) {
      const { scene } = draw(src, { maxWidth, monospace: ['files'] });
      expect(scene.texts.filter((t) => t.spans.every((p) => p.mono))).toHaveLength(maxWidth ? 3 : 2);
      expect(scene.texts.find((t) => lineOf(t) === 'src')!.weight).toBe(700);
      expect(scene.texts.find((t) => t.italic)!.spans.some((p) => p.mono)).toBe(false);
    }
    expect(plain.texts.some((t) => t.spans.some((p) => p.mono))).toBe(false);
    expect(descX(draw(src, { monospace: ['files'] }).scene)).toBeGreaterThan(descX(plain));
    for (const monospace of [[], ['file'], ['members'], 'files']) {
      expect(JSON.stringify(draw(src, { monospace } as RenderOptions).scene)).toBe(JSON.stringify(plain));
    }
  });

  it('shows icons only when asked, and offers each icon name to the host', () => {
    expect(iconed(draw(TREE).scene)).toEqual([]);
    expect(iconed(draw('---\nconfig:\n  treeView:\n    showIcons: true\n---\n' + TREE).scene)).toHaveLength(5);

    const asked: string[] = [];
    const { scene } = draw('treeView-beta\n  App.tsx icon(logos:react)\n  index.js\n  x.rs icon(rust)\n  y icon()\n', {
      icons: (name) => (asked.push(name), name === 'logos:react' ? '<circle r="4"/>' : null),
    });
    expect(asked).toEqual(['logos:react', 'mermaid-treeview:rust']);
    expect(iconed(scene)).toEqual(['App.tsx', 'x.rs']);
  });

  it('maps file names and extensions to icons from config', () => {
    const src =
      '---\nconfig:\n  treeView:\n    showIcons: true\n    defaultIconPack: material\n    filenameIcons:\n      Dockerfile: docker\n    extensionIcons:\n      .ts: typescript\n      txt: none\n---\n' +
      'treeView-beta\n  a.ts\n  Dockerfile\n  notes.txt\n  constructor\n  dir.ts/\n';
    const asked: string[] = [];
    const { scene } = draw(src, { icons: (name) => (asked.push(name), null) });
    expect(asked).toEqual(['material:typescript', 'material:docker', 'mermaid-treeview:file', 'mermaid-treeview:folder']);
    expect(iconed(scene)).toEqual(['a.ts', 'Dockerfile', 'constructor', 'dir.ts']);
  });

  it('keeps names as written', () => {
    const { scene } = draw('treeView-beta\n  "a  b   c"\n  <T>.ts ## x <br> y\n  #35;hash\n');
    expect(lines(scene)).toEqual(['a  b   c', '<T>.ts', 'x <br> y', '#hash']);
  });

  it('reads names that start with title', () => {
    const model = parse('treeView-beta\ntitles/\n  title.txt\n  title-page.md\n');
    expect(model.type).toBe('treeView');
    if (model.type === 'treeView') {
      const [dir] = model.root.children;
      expect([dir.name, ...dir.children.map((c) => c.name)]).toEqual(['titles', 'title.txt', 'title-page.md']);
    }
    const { scene } = draw('treeView-beta\ntitles/\n├── title.txt\n└── title-page.md\n');
    expect(lines(scene)).toEqual(['titles', 'title.txt', 'title-page.md']);
    const titled = parse('treeView-beta\ntitle%% c\naccTitle: A\nroot\n');
    expect(titled.type === 'treeView' && [titled.accTitle, titled.root.children.map((c) => c.name)]).toEqual(['A', ['root']]);
  });

  it('draws titles', () => {
    expect(lines(draw('---\ntitle: Front\n---\ntreeView-beta\naccTitle: Acc\naccDescr: Described\n  a\n').scene)).toEqual(['Front', 'a']);
    expect(lines(draw('---\ntitle: Front\n---\ntreeView-beta\ntitle Own\n  a\n').scene)).toEqual(['Own', 'a']);
  });

  it('honours the layout options', () => {
    const base = draw(TREE);
    const wide = draw('---\nconfig:\n  treeView:\n    rowIndent: 80\n    paddingY: 10\n    lineThickness: 3\n---\n' + TREE);
    expect(wide.width).toBeGreaterThan(base.width);
    expect(wide.height).toBeGreaterThan(base.height);
    expect(wide.scene.shapes.map((h) => h.width)).toEqual([3, 3]);
  });

  it('draws an empty tree and is deterministic', () => {
    const empty = draw('treeView-beta').scene;
    expect([empty.items, empty.texts, empty.shapes]).toEqual([[], [], []]);
    expect(JSON.stringify(draw(TREE).scene)).toBe(JSON.stringify(draw(TREE).scene));
  });

  it('rejects what Mermaid rejects', () => {
    for (const src of ['treeView-beta title x\n a', 'treeView-beta\n a\ntitle late', 'treeView-beta\n  \n  a', 'treeView-beta\n :::x']) {
      expect(() => draw(src), src).toThrow(PeleError);
    }
  });
});
