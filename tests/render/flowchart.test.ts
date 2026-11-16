import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import type { Scene, SceneItem, SceneShape, SceneSpan } from '../../src/draw/scene.js';
import { overFills } from '../../src/svg/edges.js';
import { resolveStyle } from '../../src/svg/theme.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, itemById, items, lineOf, lines, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('flowchart', /graph|flowchart/);

const sceneOf = (src: string): Scene => draw(src).scene;
// Where a source put a part moves with the lines it takes; the drawing does not.
const drawn = (src: string): string => JSON.stringify(sceneOf(src), (key, value) => (['line', 'end', 'from', 'to', 'symbol'].includes(key) ? undefined : value));

// A path is op codes, each followed by its arguments: M, L, C, Q, A, Z.
const ARGS = [2, 2, 6, 4, 7, 0];
const M = 0;
const C = 2;
const Q = 3;
const L = 1;
function segments(shape: SceneShape): { op: number; args: number[] }[] {
  const out: { op: number; args: number[] }[] = [];
  for (let i = 0; i < shape.cmds.length; i += 1 + ARGS[shape.cmds[i]]) out.push({ op: shape.cmds[i], args: shape.cmds.slice(i + 1, i + 1 + ARGS[shape.cmds[i]]) });
  return out;
}

const centre = (item: SceneItem): [number, number] => [(item.box!.x0 + item.box!.x1) / 2, (item.box!.y0 + item.box!.y1) / 2];
const nodeAt = (scene: Scene, id: string): [number, number] => centre(itemById(scene, id, 'pele-node')!);
const edgeOf = (scene: Scene, id: string): SceneItem => itemById(scene, id, 'pele-edge')!;
// An edge's line, and the arrowheads and ends drawn on it.
const lineOfEdge = (scene: Scene, id: string): SceneShape => shapesOf(scene, edgeOf(scene, id)).find((s) => s.kind === 'stroke')!;
const markersOf = (scene: Scene, id: string): SceneShape[] => shapesOf(scene, edgeOf(scene, id)).slice(1);
// The first point of an edge's line, and the tip of each arrowhead.
const startOf = (scene: Scene, id: string): [number, number] => [lineOfEdge(scene, id).cmds[1], lineOfEdge(scene, id).cmds[2]];
const tipOf = (marker: SceneShape): [number, number] => [marker.cmds[1], marker.cmds[2]];

// The spans of the first text of the node holding `label`.
const spansOf = (src: string, id = 'A'): SceneSpan[] => {
  const scene = sceneOf(src);
  return textsOf(scene, itemById(scene, id, 'pele-node')!).flatMap((t) => t.spans);
};
const light = 'var(--pele-fg-on-light,#1f1f1f)';
const dark = 'var(--pele-fg-on-dark,#fff)';
// What lies under an edge to keep it clear of a fill it crosses: the page color, belonging to no part.
const casings = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.item === -1 && s.paint === 'var(--_bg)');
const sameLine = (a: number[], b: number[]): boolean => a.length === b.length && a.every((n, i) => n === b[i]);

describe('flowchart rendering', () => {
  it('renders every corpus input that parses, as a scene a host can take', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      const json = JSON.stringify(result.scene);
      expect(json, where).not.toContain('NaN');
      expect(json, where).not.toContain('undefined');
      expect(JSON.stringify(draw(src).scene), where).toBe(json);
    }
    expect(rendered).toBeGreaterThan(300);
  });

  it('reports size and type', () => {
    const result = draw('flowchart LR\n  A --> B');
    expect(result.type).toBe('flowchart');
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(30);
    expect([result.scene.w, result.scene.h]).toEqual([result.width, result.height]);
  });

  it('lays out along the declared direction', () => {
    const tall = draw('flowchart TD\n  A --> B --> C');
    const wide = draw('flowchart LR\n  A --> B --> C');
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
  });

  it('themes through paint tokens a host resolves', () => {
    const { scene } = draw('flowchart TD\n  A --> B');
    expect(new Set(scene.shapes.map((s) => s.paint))).toEqual(new Set(['var(--_s)', 'var(--_b)', 'var(--_l)']));
    expect(new Set(scene.texts.map((t) => t.paint))).toEqual(new Set(['var(--_fg)']));
  });

  it('keeps label text as text', () => {
    const { scene } = draw('flowchart TD\n  A["<img src=x onerror=alert(1)> & more"]');
    expect(lines(scene)).toEqual([' & more']);
  });

  it('keeps literal angle-bracket text in quoted labels', () => {
    expect(lines(sceneOf('flowchart LR\n  A["List<T>"]'))).toEqual(['List<T>']);
  });

  it('keeps a label that is only tag-shaped text instead of rendering it blank', () => {
    expect(lines(sceneOf('flowchart LR\n  A["<T>"]'))).toEqual(['<T>']);
  });

  it('keeps the text of <u> spans', () => {
    const scene = sceneOf('flowchart LR\n  A["a <u>underlined</u> word"]\n  B["<u>all of it</u>"]');
    expect(lines(scene)).toEqual(['a underlined word', 'all of it']);
    expect(textsOf(scene, itemById(scene, 'A', 'pele-node')!)[0].spans).toEqual([{ text: 'a ' }, { text: 'underlined', underline: true }, { text: ' word' }]);
    expect(lines(sceneOf('kanban\n  todo[Todo]\n    t1[<u>card</u>]'))).toContain('card');
  });

  it('styles other inline tags as browsers do', () => {
    const styles: [string, Partial<SceneSpan>][] = [
      ['cite', { italic: true }],
      ['dfn', { italic: true }],
      ['var', { italic: true }],
      ['kbd', { mono: true }],
      ['samp', { mono: true }],
      ['tt', { mono: true }],
      ['ins', { underline: true }],
    ];
    for (const [tag, style] of styles) {
      expect(spansOf(`flowchart LR\n  A["plain <${tag}>tagged</${tag}> plain"]`), tag).toEqual([{ text: 'plain ' }, { text: 'tagged', ...style }, { text: ' plain' }]);
    }
  });

  it('drops real HTML tags and keeps their text', () => {
    expect(lines(sceneOf('flowchart LR\n  A["<span title=x>red</span> and <small>print</small><img src=x>"]'))).toEqual(['red and print']);
  });

  it('still formats recognized tags while keeping unrecognized ones literal', () => {
    expect(spansOf('flowchart LR\n  A["<b>bold</b> and <T>"]')).toEqual([{ text: 'bold', weight: 700, weightVar: '--_w' }, { text: ' and <T>' }]);
  });

  it('decodes entity codes and line breaks in labels', () => {
    const scene = sceneOf('flowchart TD\n  A["a #quot;b#quot; #35; #9829;<br/>second line"]');
    expect(lines(scene)).toEqual(['a "b" # ♥', 'second line']);
  });

  it('decodes HTML5 aliases such as lcub and verbar in labels', () => {
    const text = lines(sceneOf('flowchart LR\n  A["GET /plans/&lcub;id&rcub;"] --> B["items#lsqb;0#rsqb; #verbar; none"]'));
    expect(text).toContain('GET /plans/{id}');
    expect(text).toContain('items[0] | none');
  });

  it('decodes each entity code once', () => {
    expect(lines(sceneOf('flowchart LR\n  A["x #amp;lt; y #38;gt; z"]'))).toEqual(['x &lt; y &gt; z']);
  });

  it('wraps long labels', () => {
    const short = draw('flowchart TD\n  A[one two]');
    const long = draw('flowchart TD\n  A[one two three four five six seven eight nine ten eleven twelve]');
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.width).toBeLessThan(300);
  });

  it('renders markdown emphasis', () => {
    expect(spansOf('flowchart TD\n  A["`This **is** _Markdown_`"]')).toEqual([{ text: 'This ' }, { text: 'is', weight: 700, weightVar: '--_w' }, { text: ' ' }, { text: 'Markdown', italic: true }]);
  });

  it('draws <code> spans in labels with the monospace font', () => {
    expect(spansOf('flowchart TD\n  A["Call <code>render()</code> once"]')).toEqual([{ text: 'Call ' }, { text: 'render()', mono: true }, { text: ' once' }]);
  });

  it('draws a label that is all code in the monospace font', () => {
    expect(spansOf('flowchart TD\n  A["<code>render()</code>"]')).toEqual([{ text: 'render()', mono: true }]);
  });

  it('closes markdown emphasis in a label that is already bold', () => {
    const scene = sceneOf('flowchart TD\n  A["`one **two** three`"]\n  style A font-weight:bold');
    expect(textOf(scene)).not.toContain('**');
    expect(lines(scene)).toEqual(['one two three']);
  });

  it.each(['b', 'strong', 'i', 'em'])('keeps <%s> formatting across explicit line breaks', (tag) => {
    for (const br of ['<br/>', '<br>', '<BR />', '\\n', '\n']) {
      const source = `flowchart LR\n  A["<${tag}>First${br}Second</${tag}> plain${br}Third"]`;
      const reopened = `flowchart LR\n  A["<${tag}>First</${tag}>${br}<${tag}>Second</${tag}> plain${br}Third"]`;
      expect(drawn(source), `${tag} across ${JSON.stringify(br)}`).toBe(drawn(reopened));
    }
  });

  it('keeps nested HTML formatting across breaks without changing other labels or the base style', () => {
    const source = 'flowchart LR\n  A["<b><i>First<br/><br/>Second</i> bold</b> plain"] --> B[plain]';
    const reopened = 'flowchart LR\n  A["<b><i>First</i></b><br/><br/><b><i>Second</i> bold</b> plain"] --> B[plain]';
    for (const suffix of ['', '\n  style A font-weight:bold']) {
      expect(drawn(source + suffix)).toBe(drawn(reopened + suffix));
    }
    expect(drawn('flowchart LR\n A["<b>First<br/>Second"] --> B[plain]')).toBe(drawn('flowchart LR\n A["<b>First</b><br/><b>Second</b>"] --> B[plain]'));
  });

  it('applies style, classDef and linkStyle', () => {
    const scene = sceneOf(
      'flowchart TD\n  A --> B\n  style A fill:#f9f,stroke:#333,stroke-width:4px,color:#fff\n  classDef warn fill:#ff0\n  class B warn\n  linkStyle 0 stroke:#f00,stroke-width:3px'
    );
    const a = itemById(scene, 'A', 'pele-node')!;
    expect(shapesOf(scene, a).map((s) => [s.kind, s.paint, s.width])).toEqual([['fill', '#f9f', undefined], ['stroke', '#333', 4]]);
    expect(textsOf(scene, a).map((t) => t.paint)).toEqual(['#fff']);
    expect(itemById(scene, 'B', 'warn')!.kind).toBe('pele-node pele-shape-rect warn');
    expect(shapesOf(scene, edgeOf(scene, 'L_A_B_0')).map((s) => [s.kind, s.paint, s.width])).toEqual([['stroke', '#f00', 3], ['fill', '#f00', undefined]]);
  });

  it('draws a subgraph fill the author sets at full opacity', () => {
    const scene = sceneOf('flowchart LR\n  subgraph S\n    A\n  end\n  subgraph T\n    B\n  end\n  style S fill:#BBDEFB');
    expect(shapesOf(scene, itemById(scene, 'S')!)[0]).toMatchObject({ paint: '#BBDEFB', opacity: 1 });
    expect(shapesOf(scene, itemById(scene, 'T')!)[0]).toMatchObject({ paint: 'var(--_a)', opacity: 0.5 });
  });

  it('picks a contrasting label color on fills a style sets', () => {
    const src =
      'flowchart LR\n  subgraph S["Cluster"]\n    A[Start] -- Launch --> B[Worker]\n  end\n  C[Output]\n  D[Dark]\n  E[Own]\n  F[Plain]\n  G[Words]\n  B --> C\n' +
      '  style S fill:#BBDEFB\n  style C fill:#BBDEFB\n  classDef dark fill:navy\n  class D dark\n  style E fill:#BBDEFB,color:#333\n  style G fill:#000\n  G@{ shape: text }';
    const scene = sceneOf(src);
    const paint = (id: string): string => textsOf(scene, itemById(scene, id)!)[0].paint;
    expect(paint('S')).toBe(light);
    expect(paint('C')).toBe(light);
    expect(paint('D')).toBe(dark);
    expect(paint('E')).toBe('#333');
    expect(paint('F')).toBe('var(--_fg)');
    expect(paint('G')).toBe('var(--_fg)');
    expect(paint('A')).toBe('var(--_fg)');
    expect(textsOf(scene, itemById(scene, 'L_A_B_0', 'pele-edge-label')!).map(lineOf)).toEqual(['Launch']);
  });

  it('cases edges that cross into a subgraph fill a style sets and inks edges inside it', () => {
    const src =
      'flowchart LR\n  subgraph S["Cluster"]\n    A[Start] -- Launch --> B[Worker]\n    subgraph N\n      G --> H\n    end\n  end\n  subgraph T\n    D --> E\n  end\n  C[Output]\n  B --> C\n  C ==> D\n  B --> B\n  F --> C\n  B --> G\n  A --> H\n  style S fill:#BBDEFB\n  style N fill:navy\n  style C fill:#BBDEFB';
    const scene = sceneOf(src);
    const cased = (id: string): boolean => casings(scene).some((s) => s.kind === 'stroke' && sameLine(s.cmds, lineOfEdge(scene, id).cmds));
    // Inside one fill: that fill's ink, on the line and its arrowhead.
    for (const id of ['L_A_B_0', 'L_B_B_0']) {
      expect(cased(id)).toBe(false);
      expect(lineOfEdge(scene, id).paint).toBe(light);
      expect(markersOf(scene, id).length).toBeGreaterThan(0);
      for (const marker of markersOf(scene, id)) expect(marker.paint).toBe(light);
    }
    expect(lineOfEdge(scene, 'L_G_H_0').paint).toBe(dark);
    // Across a fill's border, including into a nested fill: a casing and the theme's line.
    for (const id of ['L_B_C_0', 'L_B_G_0', 'L_A_H_0']) {
      expect(cased(id)).toBe(true);
      expect(shapesOf(scene, edgeOf(scene, id)).map((s) => s.paint)).not.toContain(light);
      expect(shapesOf(scene, edgeOf(scene, id)).map((s) => s.paint)).not.toContain(dark);
    }
    for (const id of ['L_C_D_0', 'L_D_E_0', 'L_F_C_0']) {
      expect(cased(id)).toBe(false);
      expect(shapesOf(scene, edgeOf(scene, id)).map((s) => s.paint)).toEqual(['var(--_l)', 'var(--_l)']);
    }
    // The arrowheads are cased too, in the page color, and the casings lie under every edge.
    expect(casings(scene).some((s) => s.kind === 'fill')).toBe(true);
    expect(scene.shapes.lastIndexOf(casings(scene).at(-1)!)).toBeLessThan(scene.shapes.indexOf(lineOfEdge(scene, 'L_A_B_0')));
    const plain = sceneOf(src.replace(/\n  style [SN] fill:\S+/g, ''));
    expect(casings(plain)).toEqual([]);
    expect(plain.shapes.map((s) => s.paint)).not.toContain(light);
    expect(plain.shapes.map((s) => s.paint)).not.toContain(dark);
  });

  it('cases an edge whose marker alone reaches into a nested fill', () => {
    const fills = [
      { box: [-20, -20, 100, 100], shape: ' style="fill:white;"' },
      { box: [10, 0, 50, 50], shape: ' style="fill:navy;"' },
    ];
    expect(overFills('M0,10L8,10', [15, 10], fills)).toBe('');
    expect(overFills('M0,10L8,10', [9, 10], fills)).toBe('var(--pele-fg-on-light,#1f1f1f)');
    // A path that starts on a border and stays inside is held by that fill.
    expect(overFills('M-20,10L8,10', [9, 10], fills)).toBe('var(--pele-fg-on-light,#1f1f1f)');
  });

  it('cases an edge whose curve runs into a filled subgraph', () => {
    const scene = sceneOf('flowchart LR\nsubgraph S\n  A\n  B --> G\nend\nD\nE --> A\nD --> F\nF --> C\nB --> C\nstyle S fill:white');
    const cased = (id: string): boolean => casings(scene).some((s) => s.kind === 'stroke' && sameLine(s.cmds, lineOfEdge(scene, id).cmds));
    expect(cased('L_F_C_0')).toBe(true);
    expect(cased('L_D_F_0')).toBe(false);
  });

  it('cases an edge as wide and as faint as its line style makes it', () => {
    const under = (link: string, fill = 'white'): SceneShape[] =>
      casings(sceneOf(`flowchart TB\nsubgraph S\n  A\nend\nA --x B\nstyle S fill:${fill}\n${link}`));
    // Its line and its end.
    expect(under('linkStyle 0 stroke-width:10px').map((s) => s.width)).toEqual([14, 14]);
    expect(under('linkStyle 0 stroke-width:1em')).toHaveLength(2);
    expect(under('linkStyle 0 opacity:0,stroke-opacity:0.5').map((s) => s.opacity)).toEqual([0, 0]);
    expect(under('linkStyle 0 stroke:none')).toEqual([]);
    expect(under('', 'none')).toEqual([]);
    expect(under('', 'transparent')).toEqual([]);
    expect(under('', '#0000')).toEqual([]);
    const faded = sceneOf('flowchart TB\nsubgraph S\n  A --> B\nend\nstyle S fill:black,opacity:0');
    expect(casings(faded)).toEqual([]);
    expect(faded.shapes.map((s) => s.paint)).not.toContain(dark);
  });

  it('drops style values that could load resources or break out of the attribute', () => {
    expect(resolveStyle(['fill:url(http://example.com/x.png)', 'stroke:red']).shape).toBe(' style="stroke:red;"');
    expect(resolveStyle(['fill:red;background:blue', 'color:expression(alert(1))']).shape).toBe('');
    expect(resolveStyle(['position:fixed', 'fill:"><script>']).shape).toBe('');
  });

  it('links nodes and neutralizes script URLs', () => {
    const { scene, links } = draw(
      'flowchart TD\n  A --> B --> C\n  click A "https://example.com" "A tooltip" _blank\n  click B "javascript:alert(1)"\n  click C call doSomething()'
    );
    expect(JSON.stringify(scene)).not.toContain('doSomething');
    expect(links).toEqual([{ id: 'A', href: 'https://example.com/', internal: false }]);
  });

  it('turns internal-link nodes into Obsidian links', () => {
    const result = draw('flowchart TD\n  A[My note] --> B\n  class A internal-link;');
    expect(result.links).toEqual([{ id: 'A', href: 'My note', internal: true }]);
  });

  it('draws subgraphs as clusters behind their members', () => {
    const scene = sceneOf('flowchart TD\n  subgraph one [First group]\n    A --> B\n  end\n  B --> C');
    const one = itemById(scene, 'one', 'pele-cluster')!;
    expect(textsOf(scene, one).map(lineOf)).toEqual(['First group']);
    const at = (item: SceneItem): number => scene.shapes.findIndex((s) => s.item === scene.items.indexOf(item));
    expect(at(one)).toBeLessThan(at(itemById(scene, 'A', 'pele-node')!));
  });

  it("ignores a subgraph's direction when its nodes link outside it", () => {
    const groups = 'flowchart LR\n  subgraph S\n    direction TB\n    s1\n    s2\n  end\n  subgraph P\n    direction TB\n    p1\n    p2\n  end\n';
    const edges = '  s1 --> p2\n  s2 --> p1\n';
    expect(drawn(groups + edges)).toBe(drawn(groups.replace(/ *direction TB\n/g, '') + edges));

    const scene = sceneOf(
      'flowchart LR\n  subgraph one\n    direction TB\n    a1 --> a2\n  end\n  subgraph two\n    direction TB\n    b1 --> b2\n  end\n  subgraph outer\n    direction TB\n    subgraph inner\n      direction TB\n      c1 --> c2\n    end\n    c3\n  end\n  x --> one\n  x --> b1\n  c3 --> x'
    );
    expect(nodeAt(scene, 'a1')[0]).toBe(nodeAt(scene, 'a2')[0]);
    expect(nodeAt(scene, 'b1')[1]).toBe(nodeAt(scene, 'b2')[1]);
    expect(nodeAt(scene, 'c1')[0]).toBe(nodeAt(scene, 'c2')[0]);
  });

  it('lines up unlinked subgraph members with the member an outside edge enters', () => {
    const scene = sceneOf('flowchart TB\n  subgraph S\n    a\n    b\n    c\n  end\n  x --> a');
    expect(nodeAt(scene, 'b')[1]).toBe(nodeAt(scene, 'a')[1]);
    expect(nodeAt(scene, 'c')[1]).toBe(nodeAt(scene, 'a')[1]);
  });

  it('gives edges arrowheads and ends drawn as shapes of the edge', () => {
    const scene = sceneOf('flowchart LR\n  A --> B\n  B --- C\n  C --x D\n  D o--o E\n  E <--> F');
    const marks = items(scene, 'pele-edge').map((edge) => shapesOf(scene, edge).length - 1);
    expect(marks).toEqual([1, 0, 1, 2, 2]);
  });

  it('keeps an arrowhead apart from the edge that leaves beside it', () => {
    const scene = sceneOf('flowchart TD\n  A --> B\n  B --> A');
    const tips = [...markersOf(scene, 'L_A_B_0'), ...markersOf(scene, 'L_B_A_0')].map(tipOf);
    const starts = [startOf(scene, 'L_A_B_0'), startOf(scene, 'L_B_A_0')];
    expect(tips).toHaveLength(2);
    // Each node has one edge arriving and one leaving on the side that faces the other node.
    for (const [x, y] of tips) {
      const beside = starts.find((start) => Math.abs(start[1] - y) < 1);
      expect(beside).toBeDefined();
      expect(Math.abs(beside![0] - x)).toBeGreaterThanOrEqual(12);
    }
  });

  it('ends the edges that spread along a diamond or a circle on its outline', () => {
    for (const dir of ['TD', 'LR']) {
      const scene = sceneOf(`flowchart ${dir}\n  D{Decide} --> A\n  D --> B\n  D --> C\n  A & B & C --> E((End))`);
      const diamond = itemById(scene, 'D', 'pele-node')!;
      const [dx, dy] = centre(diamond);
      const w = diamond.box!.x1 - diamond.box!.x0;
      const h = diamond.box!.y1 - diamond.box!.y0;
      const circle = itemById(scene, 'E', 'pele-node')!;
      const [ex, ey] = centre(circle);
      const r = (circle.box!.x1 - circle.box!.x0) / 2;
      const edges = items(scene, 'pele-edge');
      const starts = edges.map((e) => startOf(scene, e.id));
      const tips = edges.map((e) => tipOf(markersOf(scene, e.id)[0]));
      const fromDiamond = starts.slice(0, 3);
      expect(new Set(fromDiamond.map((p) => p.join())).size, dir).toBe(3);
      for (const [x, y] of fromDiamond) expect(Math.abs(x - dx) / (w / 2) + Math.abs(y - dy) / (h / 2), dir).toBeCloseTo(1, 1);
      const intoCircle = tips.slice(3);
      expect(new Set(intoCircle.map((p) => p.join())).size, dir).toBe(3);
      for (const [x, y] of intoCircle) expect(Math.hypot(x - ex, y - ey), dir).toBeCloseTo(r, 0);
    }
  });

  it('routes a stepped flowchart at right angles, clear of its nodes', () => {
    const source = '---\nconfig:\n  flowchart:\n    curve: step\n---\nflowchart TD\n  A[Start] --> B[Parse]\n  A --> C[Measure]\n  A --> D[Theme]\n  B --> E[Fits]\n  C --> E\n  D --> E\n  E -->|Yes| F[Draw]\n  E -->|No| A';
    const scene = sceneOf(source);
    const boxes = items(scene, 'pele-node').map((node) => ({ x: centre(node)[0], y: centre(node)[1], w: node.box!.x1 - node.box!.x0, h: node.box!.y1 - node.box!.y0 }));
    expect(boxes).toHaveLength(6);
    const edges = items(scene, 'pele-edge');
    expect(edges).toHaveLength(8);
    for (const edge of edges) {
      const path = segments(lineOfEdge(scene, edge.id));
      // Straight runs and rounded corners only.
      expect(path[0].op).toBe(M);
      for (const { op } of path.slice(1)) expect([L, Q]).toContain(op);
      const points = path.flatMap(({ args }) => args.flatMap((_, i) => (i % 2 === 0 ? [[args[i], args[i + 1]]] : [])));
      for (const [x, y] of points.slice(1, -1)) {
        for (const box of boxes) expect(Math.abs(x - box.x) < box.w / 2 - 1 && Math.abs(y - box.y) < box.h / 2 - 1, edge.id).toBe(false);
      }
      // Arrowheads point straight along the flow: the two back corners are level.
      for (const marker of markersOf(scene, edge.id)) expect(marker.cmds[5]).toBeCloseTo(marker.cmds[8], 5);
    }
  });

  it('keeps nodes in the order they are written, where the mirror image would cross no less', () => {
    const scene = sceneOf('flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|One| D[Laptop]\n  C -->|Two| E[iPhone]\n  C -->|Three| F[Car]\n  D --> B\n  E --> A');
    const x = (id: string): number => nodeAt(scene, id)[0];
    // The car goes between the two that have a way back up, and the laptop, written first, goes on the left.
    expect(x('D')).toBeLessThan(x('F'));
    expect(x('F')).toBeLessThan(x('E'));
  });

  it('brings a lone edge to the tip of a diamond, and not to wherever it would run straight', () => {
    const scene = sceneOf('flowchart TD\n  A[A node wide enough to reach over the diamond] --> B[Left]\n  A --> C{Decide}\n  B --> D[End]\n  C --> D');
    expect(tipOf(markersOf(scene, 'L_A_C_0')[0])[0]).toBeCloseTo(nodeAt(scene, 'C')[0], 1);
  });

  it('turns an edge in the whole height between two ranks when it passes clear of the labels between them', () => {
    const scene = sceneOf('flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|One| D[Laptop]\n  C -->|Two| E[iPhone]\n  C -->|Three| F[Car]\n  D --> B\n  E --> A');
    const path = segments(lineOfEdge(scene, 'L_E_A_0'));
    // The last curve of the edge back to the top starts below the label's rank, not beside the label.
    const last = path.map(({ op }) => op).lastIndexOf(C);
    const from = path[last - 1].args;
    const y = (id: string): number => nodeAt(scene, id)[1];
    expect(from[from.length - 1]).toBeGreaterThan((y('A') + y('B')) / 2 + 10);
  });

  it('keeps the branches of a decision in the order they are written when no order crosses less', () => {
    const scene = sceneOf('flowchart TD\n  A{Which way?} -->|The first and longest of the answers| B\n  A -->|Second| C\n  A -->|A third answer| D\n  A -->|Fourth| E\n  B -->|Back| A');
    const xs = ['B', 'C', 'D', 'E'].map((id) => nodeAt(scene, id)[0]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('labels an edge that passes a row of nodes level with that row', () => {
    const scene = sceneOf('flowchart TD\n  A[Start] --> B[Parse]\n  A --> C[Measure]\n  B --> E{Fits?}\n  C --> E\n  E -->|Yes| F[Draw]\n  E -->|No| A');
    const y = (id: string): number => nodeAt(scene, id)[1];
    const label = (id: string): number => centre(itemById(scene, id, 'pele-edge-label')!)[1];
    // The edge back up to the start passes the row in the middle, and its label sits in that row.
    expect(label('L_E_A_0')).toBeCloseTo(y('B'), 1);
    // The label of an edge from one row to the next sits between the two.
    expect(label('L_E_F_0')).toBeGreaterThan(y('E'));
    expect(label('L_E_F_0')).toBeLessThan(y('F'));
  });

  it('keeps invisible links out of the drawing but in the layout', () => {
    const linked = draw('flowchart LR\n  A ~~~ B');
    const apart = draw('flowchart LR\n  A\n  B');
    expect(items(linked.scene, 'pele-edge')).toEqual([]);
    expect(linked.width).toBeGreaterThan(apart.width - 1);
    expect(linked.height).toBeLessThan(apart.height);
  });



  it('reads front matter and init directives', () => {
    const plain = draw('flowchart TD\n  A --> B');
    const spaced = draw('---\nconfig:\n  flowchart:\n    rankSpacing: 200\n---\nflowchart TD\n  A --> B');
    const directive = draw('%%{init: {"flowchart": {"rankSpacing": 200}}}%%\nflowchart TD\n  A --> B');
    expect(spaced.height).toBeGreaterThan(plain.height + 100);
    expect(directive.height).toBe(spaced.height);
  });

  it('ignores comments', () => {
    expect(textOf(sceneOf('flowchart TD\n  %% a comment\n  A --> B\n'))).not.toContain('comment');
  });
});

describe('public api', () => {
  it('detects diagram types', () => {
    expect(detectType('flowchart TD\n A')).toBe('flowchart');
    expect(detectType('  graph LR\n A')).toBe('flowchart');
    expect(detectType('%% comment\nsequenceDiagram\n A->>B: hi')).toBe('sequence');
    expect(detectType('---\ntitle: x\n---\nclassDiagram\n class A')).toBe('class');
    expect(detectType('hello')).toBe(null);
  });

  it('says what it can render', () => {
    expect(supports('flowchart TD\n A')).toBe(true);
    expect(supports('sequenceDiagram\n A->>B: hi')).toBe(true);
    expect(supports('nothing')).toBe(false);
  });

  it('throws structured errors', () => {
    const unsupported = (() => {
      try {
        draw('zenuml\n A->B: hi');
      } catch (error) {
        return error as PeleError;
      }
    })();
    expect(unsupported).toBeInstanceOf(PeleError);
    expect(unsupported?.code).toBe('unsupported-diagram');
    expect(unsupported?.type).toBe(null);

    const syntax = (() => {
      try {
        draw('flowchart TD\n  A --> B\n  C --> --> D\n  E');
      } catch (error) {
        return error as PeleError;
      }
    })();
    expect(syntax?.code).toBe('syntax');
    expect(syntax?.type).toBe('flowchart');
    expect(syntax?.line).toBe(3);
    expect(syntax?.message).toContain('Parse error on line 3');

    expect(() => draw('flowchart TD\n  A --> B', { limit: 5 })).toThrow(/limit/);
  });

  it('shows entity codes in errors as they were written', () => {
    expect(() => draw('flowchart TD\nA[a#35;b] --> -->')).toThrow(/^Parse error on line 2:\nA\[a#35;b\] --> -->\n/);
    expect(() => draw('flowchart TD\na@{shape: "#35;x"}')).toThrow(
      expect.objectContaining({ code: 'semantic', message: 'No such shape: #35;x.' })
    );
  });

  it('reports lines and columns in the source as written', () => {
    expect(() => draw('flowchart TD\nA[a#35;b] --> -->')).toThrow(
      expect.objectContaining({ line: 2, column: 15, snippet: 'A[a#35;b] --> -->\n--------------^' })
    );
    expect(() => draw('---\ntitle: T\n---\n\n%% A comment\nflowchart TD\n  A --> B\n  C --> --> D')).toThrow(
      expect.objectContaining({ line: 8, column: 9, message: expect.stringMatching(/^Parse error on line 8:\n  C --> --> D\n--------\^\n/) })
    );
    expect(() => draw('flowchart TD\n  A{a}  \n\n  C --> --> D')).toThrow(expect.objectContaining({ line: 4, column: 9 }));
    for (const end of ['', '\n', '\n%% A comment\n\n']) {
      expect(() => draw(`flowchart LR\n  A -->${end}`), JSON.stringify(end)).toThrow(expect.objectContaining({ line: 2, column: 8 }));
    }
  });

  it('parses without rendering', () => {
    const model = parse('flowchart LR\n  A[Start] --> B{Choice}');
    expect(model.type).toBe('flowchart');
    expect(model.direction).toBe('LR');
    expect([...model.nodes.keys()]).toEqual(['A', 'B']);
    expect(model.nodes.get('B')?.type).toBe('diamond');
    expect(model.edges[0]).toMatchObject({ start: 'A', end: 'B', type: 'arrow_point' });
  });

  it('keeps the runs of <sub> and <sup> in labels apart', () => {
    const scene = sceneOf('flowchart LR\n  A["H<sub>2</sub>O"] --> B["x<sup>2</sup>"]');
    // Set smaller, below or above the line, by the text's size.
    expect(textsOf(scene, itemById(scene, 'A', 'pele-node')!)[0].spans).toEqual([{ text: 'H' }, { text: '2', scale: 1 / 1.2, shift: 0.2 }, { text: 'O' }]);
    expect(textsOf(scene, itemById(scene, 'B', 'pele-node')!)[0].spans).toEqual([{ text: 'x' }, { text: '2', scale: 1 / 1.2, shift: -0.33 }]);
    expect(textOf(scene)).not.toContain('<su');
  });

  it('nesting sub/sup inside other emphasis keeps the emphasis on each run', () => {
    expect(spansOf('flowchart LR\n  A["<b>H<sub>2</sub>O</b>"]')).toEqual([
      { text: 'H', weight: 700, weightVar: '--_w' },
      { text: '2', weight: 700, weightVar: '--_w', scale: 1 / 1.2, shift: 0.2 },
      { text: 'O', weight: 700, weightVar: '--_w' },
    ]);
  });

  it('keeps the runs of text inside both <sup> and <sub>', () => {
    expect(spansOf('flowchart LR\n  A["x<sup>a<sub>b</sub>c</sup>"]').map((span) => span.text)).toEqual(['x', 'a', 'b', 'c']);
  });

  it('keeps the runs when a nested <sup> closes', () => {
    expect(spansOf('flowchart LR\n  A["<sup>a<sub>b<sup>c</sup>d</sub>e</sup>"]').map((span) => span.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps the runs of <sup> and <sub> across a line break', () => {
    const scene = sceneOf('flowchart LR\n  A["<sup>a<sub>b<br/>c</sub>d</sup>"]');
    expect(textsOf(scene, itemById(scene, 'A', 'pele-node')!).map((t) => t.spans.map((span) => span.text))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps the text of a label that is all subscript', () => {
    expect(lines(sceneOf('stateDiagram-v2\n  s1\n  note right of s1 : <sub>2</sub>'))).toContain('2');
  });
});
