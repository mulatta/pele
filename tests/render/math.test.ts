import { describe, expect, it } from 'vitest';
import { type MathMarkup } from '../../src/index.js';
import type { Box, Scene } from '../../src/draw/scene.js';
import { draw, itemById, items, lineOf, lines, textOf } from '../support/scene.js';

const MATH = '#0a0';

// Markup that is a plain rectangle of the size it reports, so that the scene shows where the
// resolver's box was put.
const solid = (width: number, height: number, fill = MATH): MathMarkup => ({ svg: `<rect width="${width}" height="${height}" fill="${fill}"/>`, width, height });

function recorder(markup: (tex: string, size: number) => MathMarkup | null = () => solid(30, 18)) {
  const asked: [string, number][] = [];
  const math = (tex: string, size: number): MathMarkup | null => {
    asked.push([tex, size]);
    return markup(tex, size);
  };
  return { asked, math };
}

const boxes = (scene: Scene, paint = MATH): Box[] => scene.shapes.filter((s) => s.paint === paint).map((s) => s.box);
const same = (a: { scene: unknown }, b: { scene: unknown }): boolean => JSON.stringify(a.scene) === JSON.stringify(b.scene);

describe('math in labels', () => {
  it('leaves $$ as text without a resolver', () => {
    const { scene } = draw('flowchart LR\n  A["$$x^2$$"]');
    expect(lines(scene)).toContain('$$x^2$$');
    expect(boxes(scene)).toEqual([]);
  });

  it('draws the same as without a resolver when the resolver has nothing', () => {
    const src = 'flowchart LR\n  A["$$x^2$$ and text"] -->|"$$y$$"| B';
    const plain = draw(src);
    expect(same(draw(src, { math: () => null }), plain)).toBe(true);
    expect(same(draw(src, { math: () => ({ svg: '', width: NaN, height: 10 }) }), plain)).toBe(true);
    expect(same(draw(src, { math: () => ({ svg: '', width: 10, height: -1 }) }), plain)).toBe(true);
  });

  it('gives the resolver the TeX as written and the label font size', () => {
    const { asked, math } = recorder();
    draw('flowchart LR\n  A["$$a \\neq b_1 < c * d$$"] -->|"$$e^#35;$$"| B', { math });
    expect(asked).toEqual([
      ['a \\neq b_1 < c * d', 16],
      ['e^#', 14],
    ]);
  });

  it('asks once for an expression used again at the same size', () => {
    const { asked, math } = recorder();
    draw('flowchart LR\n  A["$$x$$"] --> B["$$x$$"] --> C["$$x$$"]', { math });
    expect(asked).toEqual([['x', 16]]);
  });

  it('draws SVG markup in a box of the size the resolver gives', () => {
    const { math } = recorder(() => solid(40, 50));
    const drawn = draw('flowchart LR\n  A["$$\\frac{a}{b}$$"]', { math });
    const plain = draw('flowchart LR\n  A["x"]');
    const node = itemById(drawn.scene, 'A')!;
    const [box] = boxes(drawn.scene);
    expect(boxes(drawn.scene)).toHaveLength(1);
    expect([box.x1 - box.x0, box.y1 - box.y0]).toEqual([40, 50]);
    // The box is centred on the label.
    expect((box.x0 + box.x1) / 2).toBeCloseTo((node.box!.x0 + node.box!.x1) / 2, 1);
    expect((box.y0 + box.y1) / 2).toBeCloseTo((node.box!.y0 + node.box!.y1) / 2, 1);
    expect(textOf(drawn.scene)).not.toContain('$$');
    expect(drawn.height).toBeGreaterThan(plain.height + 25);
  });

  it('leaves out HTML markup, which a scene cannot hold, but keeps its room', () => {
    const { math } = recorder(() => ({ html: '<span class="katex">x<br></span>', width: 20, height: 60 }));
    const { scene, height } = draw('flowchart LR\n  A["$$x$$"]', { math });
    expect(scene.skipped).toEqual({ math: 1 });
    expect(textOf(scene)).not.toContain('$$');
    expect(height).toBeGreaterThan(draw('flowchart LR\n  A["x"]').height + 25);
  });

  it('sets math on the line among the text around it', () => {
    const { math } = recorder(() => solid(30, 40));
    const { scene } = draw('flowchart LR\n  A["Total $$x$$ items<br/>last line"]', { math });
    const [box] = boxes(scene);
    const total = scene.texts.find((t) => lineOf(t) === 'Total ')!;
    const rest = scene.texts.find((t) => lineOf(t) === ' items')!;
    const last = scene.texts.find((t) => lineOf(t) === 'last line')!;
    expect(rest.x).toBeGreaterThanOrEqual(box.x1);
    expect(total.y).toBe(rest.y);
    const middle = box.y0 + 20;
    expect(Math.abs(total.y - 16 * 0.35 - middle)).toBeLessThan(0.02);
    expect(last.y).toBeGreaterThan(box.y1);
  });

  it('keeps an expression whole when a label wraps', () => {
    const { math } = recorder((tex) => solid(tex.length * 10, 18));
    const { scene } = draw('flowchart TD\n  A["some words before $$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$$ and after it"]', {
      math,
      config: { flowchart: { wrappingWidth: 120 } },
    });
    expect(boxes(scene)).toHaveLength(1);
    expect(boxes(scene)[0].x1 - boxes(scene)[0].x0).toBe(300);
  });

  it('draws math in sequence messages, participants and notes', () => {
    const { asked, math } = recorder();
    const { scene } = draw('sequenceDiagram\n  participant A as $$\\alpha$$\n  A->>B: Solve $$x^2$$\n  Note over A: $$\\int x$$', { math });
    expect(asked.map(([tex]) => tex).sort()).toEqual(['\\alpha', '\\int x', 'x^2']);
    expect(boxes(scene)).toHaveLength(4);
    expect(textOf(scene)).not.toContain('$$');
  });

  it('draws math in swimlanes', () => {
    const { asked, math } = recorder();
    draw('swimlane-beta LR\n  subgraph L["$$\\lambda$$"]\n    A["$$a$$"]\n  end', { math });
    expect(asked.map(([tex]) => tex).sort()).toEqual(['\\lambda', 'a']);
  });

  it('leaves other diagram types alone', () => {
    const { asked, math } = recorder();
    const src = 'pie\n  "$$x$$" : 3';
    expect(same(draw(src, { math }), draw(src))).toBe(true);
    draw('timeline\n  2020 : $$x$$', { math });
    draw('gantt\n  section S\n    $$x$$ :a1, 2024-01-01, 3d', { math });
    expect(asked).toEqual([]);
  });

  it('colors math as the label text', () => {
    const { math } = recorder(() => solid(30, 18, 'currentColor'));
    const { scene } = draw('flowchart LR\n  A["$$x$$"]\n  classDef red color:#c00\n  class A red', { math });
    expect(boxes(scene, '#c00')).toHaveLength(1);
  });

  it('colors math in a styled lane as its title', () => {
    const { math } = recorder(() => solid(30, 18, 'currentColor'));
    const { scene } = draw('swimlane-beta LR\n  subgraph L["$$x$$"]\n    A\n  end\n  style L color:#c00', { math });
    expect(boxes(scene, '#c00')).toHaveLength(1);
  });

  it('draws a cluster title once, not again in its outline', () => {
    const { math } = recorder(() => solid(30, 18, 'currentColor'));
    const { scene } = draw('flowchart LR\n  subgraph S["$$x$$"]\n    A\n  end', { math });
    expect(boxes(scene, 'var(--_m)')).toHaveLength(1);
  });

  it('matches each expression lazily, within one line', () => {
    const { asked, math } = recorder();
    draw('flowchart LR\n  A["$$a$$ and $$b$$<br/>$$c<br/>d$$"]', { math });
    expect(asked.map(([tex]) => tex)).toEqual(['a', 'b', 'c<br/>d']);
  });

  it('keeps each expression in its place when a tag drops another', () => {
    const fills: Record<string, string> = { a: '#a00', b: '#0b0', c: '#00c' };
    const { math } = recorder((tex) => solid(10, 18, fills[tex]));
    const { scene } = draw('flowchart LR\n  A["<span title=$$a$$>hello</span> $$b$$ $$c$$"]', { math });
    expect(boxes(scene, '#a00')).toEqual([]);
    const [b] = boxes(scene, '#0b0');
    const [c] = boxes(scene, '#00c');
    expect(c.x0).toBeGreaterThan(b.x0);
  });

  it('shows unresolved expressions as TeX among resolved ones in markdown', () => {
    const { math } = recorder((tex) => (tex === 'b' ? null : solid(10, 18)));
    const { scene } = draw('flowchart LR\n  A["`**bold** $$a_1$$ and $$b$$ *c*`"]', { math });
    expect(boxes(scene)).toHaveLength(1);
    expect(textOf(scene)).toContain('$$b$$');
    expect(scene.texts.some((t) => t.spans.some((s) => s.text === 'bold' && s.weight === 700))).toBe(true);
    expect(scene.texts.some((t) => t.spans.some((s) => s.text === 'c' && s.italic === true))).toBe(true);
  });

  it('gives math the label opacity, but not styles that would change its size', () => {
    const { math } = recorder();
    const { scene } = draw('flowchart LR\n  A["Hide $$x$$"]\n  style A opacity:0,letter-spacing:6px,word-spacing:4px', { math });
    expect(scene.shapes.filter((s) => s.paint === MATH).map((s) => s.opacity)).toEqual([0]);
    expect(boxes(scene)[0].x1 - boxes(scene)[0].x0).toBe(30);
  });

  it('draws a patch behind math in a cluster title an edge runs through', () => {
    const { math } = recorder(() => solid(200, 18));
    const { scene } = draw('flowchart TD\n  X --> A\n  subgraph S["$$x$$"]\n    A\n  end', { math });
    const title = items(scene, 'pele-cluster-title')[0];
    const patch = scene.shapes.find((s) => scene.items[s.item] === title && s.paint.startsWith('color-mix('))!;
    expect(patch).toBeDefined();
    expect([patch.box.x1 - patch.box.x0, patch.box.y1 - patch.box.y0]).toEqual([200, 18]);
    expect(boxes(scene)).toHaveLength(1);
  });

  it('is not confused by a render inside the resolver', () => {
    const icons = (name: string): string => `<path fill="${name.includes('car') ? '#a00' : '#00a'}" d="M0,0h10v10h-10z"/>`;
    const math = (tex: string): MathMarkup => {
      draw('flowchart LR\n  B["fa:fa-star <b></b> $$y$$"]', { icons });
      return solid(10, 18, tex === 'x' ? MATH : '#c0c');
    };
    const { scene } = draw('flowchart LR\n  A["$$x$$ fa:fa-car"]', { icons, math });
    expect(boxes(scene, '#a00')).toHaveLength(1);
    expect(boxes(scene, '#00a')).toEqual([]);
    expect(boxes(scene)).toHaveLength(1);
  });

  it('recovers when the resolver throws', () => {
    const src = 'flowchart LR\n  A["$$x$$"]';
    expect(() => draw(src, { math: () => { throw new Error('no'); } })).toThrow('no');
    expect(() => draw('flowchart LR\n  A["<b></b>"]')).not.toThrow();
    expect(boxes(draw(src, { math: recorder().math }).scene)).toHaveLength(1);
  });

  it('makes room for tall math in a sequence message that breaks', () => {
    const tall = recorder(() => solid(40, 60));
    const short = recorder(() => solid(40, 10));
    const src = 'sequenceDiagram\n  A->>B: averyveryverylongwordthatmustbreak $$x$$ more\n  B->>A: ok';
    const narrow = { maxWidth: 220 };
    expect(draw(src, { ...narrow, math: tall.math }).height - draw(src, { ...narrow, math: short.math }).height).toBeGreaterThanOrEqual(40);
  });
});

const COVERAGE: [string, string, string[]][] = [
  [
    'state',
    'stateDiagram-v2\n  state "$$a$$" as s1\n  s1 : $$b$$\n  [*] --> s1 : $$c$$\n  note right of s1 : $$d$$\n  state "$$e$$" as C {\n    x --> y\n  }',
    ['a', 'b', 'c', 'd', 'e'],
  ],
  ['class', 'classDiagram\n  class A {\n    <<$$a$$>>\n  }\n  note for A "$$b$$"\n  A "$$c$$" --> "1" B : $$d$$\n  class C["$$e$$"]', ['a', 'b', 'c', 'd', 'e']],
  ['er', 'erDiagram\n  p["$$a$$"] {\n    string name "$$b$$"\n  }\n  p ||--o{ q : "$$c$$"', ['a', 'b', 'c']],
  ['mindmap', 'mindmap\n  root(("$$a$$"))\n    $$b$$', ['a', 'b']],
  ['kanban', 'kanban\n  todo["$$a$$"]\n    t1["$$b$$"]', ['a', 'b']],
  ['block', 'block-beta\n  a["$$a$$"] b["$$b$$"]\n  a -- "$$c$$" --> b', ['a', 'b', 'c']],
  [
    'requirement',
    'requirementDiagram\n  requirement "$$a$$" {\n    id: "$$b$$"\n    text: "$$c$$"\n  }\n  element e1 {\n    type: "$$d$$"\n    docref: "$$e$$"\n  }',
    ['a', 'b', 'c', 'd', 'e'],
  ],
  ['usecase', 'usecase-beta\n  actor C("$$a$$")\n  systemBoundary "$$b$$"\n    U("$$c$$")\n  end\n  C --> U', ['a', 'b', 'c']],
];

describe('math in other diagram types', () => {
  for (const [type, src, expected] of COVERAGE) {
    it(`typesets the labels Mermaid typesets in ${type} diagrams`, () => {
      const { asked, math } = recorder();
      const { scene } = draw(src, { math });
      expect([...new Set(asked.map(([tex]) => tex))].sort()).toEqual(expected);
      // Item ids retain the TeX source, the text must not.
      expect(textOf(scene)).not.toContain('$$');
    });
  }

  it('leaves class members as text, as Mermaid does', () => {
    const { asked, math } = recorder();
    const { scene } = draw('classDiagram\n  class A {\n    +$$m$$ int\n  }\n  A : $$n$$ text', { math });
    expect(asked).toEqual([]);
    expect(textOf(scene)).toContain('$$m$$ int');
    expect(textOf(scene)).toContain('$$n$$ text');
  });

  it('leaves titles as text, as Mermaid does', () => {
    for (const body of ['flowchart LR\n  A', 'sequenceDiagram\n  A->>B: hi', 'stateDiagram-v2\n  [*] --> s1', 'erDiagram\n  A ||--o{ B : has', 'kanban\n  todo[Todo]', 'mindmap\n  root']) {
      const { asked, math } = recorder();
      const { scene } = draw(`---\ntitle: $$t$$\n---\n${body}`, { math });
      expect(asked, body).toEqual([]);
      expect(lines(scene), body).toContain('$$t$$');
    }
  });

  const TALL: [string, string][] = [
    ['er', 'erDiagram\n  p {\n    string name "$$t$$<br/>after"\n  }'],
    ['mindmap', 'mindmap\n  root\n    child["$$t$$<br/>after"]'],
    ['kanban', 'kanban\n  todo[Todo]\n    t1["$$t$$<br/>after"]'],
    ['requirement', 'requirementDiagram\n  requirement r1 {\n    id: 1\n    text: "$$t$$<br/>after"\n  }'],
    ['usecase', 'usecase-beta\n  actor C("C")\n  U("`$$t$$\nafter`")\n  C --> U'],
    ['state', 'stateDiagram-v2\n  s1 : $$t$$<br/>after'],
    ['class', 'classDiagram\n  class A\n  note for A "$$t$$<br/>after"'],
  ];
  for (const [type, src] of TALL) {
    it(`puts the line after tall math below it in ${type} diagrams`, () => {
      const { math } = recorder(() => solid(30, 60));
      const { scene } = draw(src, { math });
      const [box] = boxes(scene);
      const after = scene.texts.find((t) => lineOf(t) === 'after');
      expect(box, type).toBeDefined();
      expect(after, type).toBeDefined();
      expect(after!.y, type).toBeGreaterThan(box.y0 + 60);
    });
  }

  it('makes room between classes for tall cardinalities at both ends of an edge', () => {
    const { math } = recorder(() => solid(20, 40));
    const { scene } = draw('classDiagram\n  A "$$x$$" --> "$$y$$" B', { math });
    const [first, second] = boxes(scene).sort((a, b) => a.y0 - b.y0);
    expect(first.y1).toBeLessThanOrEqual(second.y0);
  });

  it('gives a JSON row in a use case diagram the height of its key', () => {
    const { math } = recorder(() => solid(20, 40));
    const { scene } = draw('usecase-beta\n  json Payload@{"$$x$$":1,"other":2}', { math });
    const [key] = boxes(scene);
    const other = scene.texts.find((t) => lineOf(t) === 'other')!;
    expect(other.y - 14 * 0.35 - 14 * 0.75).toBeGreaterThanOrEqual(key.y1);
  });

  it('widens kanban columns to hold math that cannot wrap', () => {
    const { math } = recorder(() => solid(300, 30));
    const src = 'kanban\n  todo[Todo]\n    a["$$x$$"]\n  done[Done]\n    b[Other]';
    const wide = draw(src, { math }).scene;
    const [box] = boxes(wide);
    expect(box.x1).toBeLessThanOrEqual(itemById(wide, 'a', 'pele-card')!.box!.x1);
    const plain = itemById(draw('kanban\n  todo[Todo]\n    a[plain]').scene, 'a', 'pele-card')!.box!;
    expect(plain.x1 - plain.x0).toBe(184);
    const narrow = draw(src, { math, maxWidth: 240 }).scene;
    expect(boxes(narrow)[0].x1).toBeLessThanOrEqual(itemById(narrow, 'a', 'pele-card')!.box!.x1);
  });
});
