import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import type { FlowchartModel, RenderOptions } from '../../src/index.js';
import type { Scene, SceneItem } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, draw, itemById, items, lines, shapesOf, textsOf, tryDraw } from '../support/scene.js';

const sceneOf = (src: string, extra: RenderOptions = {}): Scene => draw(src, extra).scene;
// Scenes are compared as the JSON of their drawing.
const drawn = (src: string, extra: RenderOptions = {}): string => JSON.stringify(sceneOf(src, extra), (key, value) => (['line', 'end', 'from', 'to', 'symbol'].includes(key) ? undefined : value));

const ORDER = `swimlane-beta LR
  subgraph Customer
    browse[Browse] --> pay[Pay]
  end
  subgraph Warehouse
    pick[Pick] --> ship[Ship]
  end
  pay -- paid --> pick`;

const examples: string[] = JSON.parse(readFileSync('tests/corpus/swimlane-docs.json', 'utf8'));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxOf = (item: SceneItem): Box => ({ x: item.box!.x0, y: item.box!.y0, w: item.box!.x1 - item.box!.x0, h: item.box!.y1 - item.box!.y0 });

// The outline of each lane and the center of each node.
function lanes(scene: Scene): Map<string, Box> {
  return new Map(items(scene, 'pele-lane').map((lane) => [lane.id, boxOf(lane)]));
}
function centers(scene: Scene): Map<string, [number, number]> {
  return new Map(items(scene, 'pele-node').map((node) => [node.id, [(node.box!.x0 + node.box!.x1) / 2, (node.box!.y0 + node.box!.y1) / 2]]));
}
const inside = (p: [number, number], b: Box): boolean => p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h;
// A lane's title is turned on its side when the lanes are bands across the page.
const turned = (scene: Scene): boolean => scene.texts.some((t) => t.angle === -90);

describe('swimlane rendering', () => {
  it('is detected and supported', () => {
    expect(detectType(ORDER)).toBe('swimlane');
    expect(supports(ORDER)).toBe(true);
    expect(draw(ORDER).type).toBe('swimlane');
    expect(detectType('swimlane-betax\n a --> b')).not.toBe('swimlane');
  });

  it('reads the same model as a flowchart with the same body', () => {
    const lane = parse(ORDER) as FlowchartModel;
    const flow = parse(ORDER.replace('swimlane-beta', 'flowchart')) as FlowchartModel;
    expect([...lane.nodes.keys()]).toEqual([...flow.nodes.keys()]);
    expect(lane.edges.map((e) => [e.start, e.end, e.text])).toEqual(flow.edges.map((e) => [e.start, e.end, e.text]));
    expect(lane.subgraphs.map((s) => [s.id, s.nodes])).toEqual(flow.subgraphs.map((s) => [s.id, s.nodes]));
    expect(lane.direction).toBe('LR');
  });

  it('rejects what the flowchart grammar rejects', () => {
    expect(() => draw('swimlane-beta LR\n  a --> ')).toThrow(PeleError);
    expect(() => draw('swimlane-beta LR\n  subgraph x\n  a')).toThrow(PeleError);
  });

  it('draws one lane per top-level subgraph and keeps each node in its lane', () => {
    const scene = sceneOf(ORDER);
    const boxes = lanes(scene);
    const at = centers(scene);
    expect([...boxes.keys()]).toEqual(['Warehouse', 'Customer']);
    expect(inside(at.get('browse')!, boxes.get('Customer')!)).toBe(true);
    expect(inside(at.get('pay')!, boxes.get('Customer')!)).toBe(true);
    expect(inside(at.get('pick')!, boxes.get('Warehouse')!)).toBe(true);
    expect(inside(at.get('ship')!, boxes.get('Warehouse')!)).toBe(true);
    expect(lines(scene)).toContain('paid');
  });

  it('stacks lanes down the page when the flow runs sideways, and across it otherwise', () => {
    const scene = sceneOf(ORDER);
    const sideways = lanes(scene);
    expect(sideways.get('Customer')!.y).toBeLessThan(sideways.get('Warehouse')!.y);
    expect(sideways.get('Customer')!.x).toBe(sideways.get('Warehouse')!.x);
    expect(turned(scene)).toBe(true);
    const across = sceneOf(ORDER.replace('LR', 'TD'));
    const down = lanes(across);
    expect(down.get('Customer')!.x).toBeLessThan(down.get('Warehouse')!.x);
    expect(down.get('Customer')!.y).toBe(down.get('Warehouse')!.y);
    expect(turned(across)).toBe(false);
  });

  it('lines up steps of the same rank across lanes', () => {
    const at = centers(sceneOf('swimlane-beta TD\n  subgraph A\n    a1 --> a2\n  end\n  subgraph B\n    b1 --> b2\n  end\n  a1 --> b2'));
    expect(at.get('a1')![1]).toBe(at.get('b1')![1]);
    expect(at.get('a2')![1]).toBe(at.get('b2')![1]);
    expect(at.get('a1')![0]).toBe(at.get('a2')![0]);
  });

  it('turns long horizontal flows downward while retaining every lane, step and relation', () => {
    for (const source of [examples[2], examples[9]]) {
      const model = parse(source) as FlowchartModel;
      const before = JSON.stringify(model);
      const wide = draw(model);
      const narrow = draw(model, { maxWidth: 480 });
      expect(narrow.width).toBeLessThanOrEqual(480);
      expect(narrow.height).toBeGreaterThan(wide.height);
      expect(turned(narrow.scene)).toBe(false);
      const boxes = lanes(narrow.scene), at = centers(narrow.scene);
      expect([...boxes.keys()]).toEqual([...lanes(wide.scene).keys()]);
      expect([...at.keys()]).toEqual([...centers(wide.scene).keys()]);
      for (const lane of model.subgraphs) {
        for (const id of lane.nodes) expect(inside(at.get(id)!, boxes.get(lane.id)!)).toBe(true);
      }
      const edges = (scene: Scene): SceneItem[] => items(scene, 'pele-edge');
      expect(edges(narrow.scene).length).toBe(edges(wide.scene).length);
      // An edge and its arrowhead or cross are shapes of the edge.
      expect(edges(narrow.scene).map((e) => shapesOf(narrow.scene, e).length)).toEqual(edges(wide.scene).map((e) => shapesOf(wide.scene, e).length));
      // Narrower lanes wrap their labels in more lines.
      const text = (scene: Scene): string => lines(scene).join('').replace(/\s/g, '');
      expect(text(narrow.scene)).toBe(text(wide.scene));
      expect(JSON.stringify(model)).toBe(before);
      expect(JSON.stringify(draw(model, { maxWidth: wide.width }).scene)).toBe(JSON.stringify(wide.scene));
      assertSafe(narrow, source.slice(0, 80));
    }
  });

  it('honors autoDirection, the breakpoint and an already vertical direction', () => {
    const source = examples[2];
    const horizontal = drawn(source, { maxWidth: 480, autoDirection: false });
    expect(turned(sceneOf(source, { maxWidth: 480, autoDirection: false }))).toBe(true);
    expect(drawn(source, { maxWidth: 480, directionBreakpoint: 480 })).toBe(horizontal);
    expect(turned(sceneOf(source, { maxWidth: 700 }))).toBe(true);
    expect(turned(sceneOf(source, { maxWidth: 700, directionBreakpoint: 800 }))).toBe(false);
    expect(drawn(source, { maxWidth: 480 })).toBe(drawn(source.replace('LR', 'TB'), { maxWidth: 480 }));
    expect(drawn(source.replace('LR', 'RL'), { maxWidth: 480 })).toBe(drawn(source, { maxWidth: 480 }));
    const up = centers(sceneOf(ORDER.replace('LR', 'BT'), { maxWidth: 160 }));
    expect(up.get('browse')![1]).toBeGreaterThan(up.get('pay')![1]);
  });

  it('keeps a horizontal layout when turning would make it wider', () => {
    const source = 'swimlane-beta LR\n' + Array.from({ length: 5 }, (_, i) =>
      `subgraph L${i}\n a${i} --> b${i}\nend`).join('\n');
    expect(drawn(source, { maxWidth: 160 })).toBe(drawn(source, { maxWidth: 160, autoDirection: false }));
    expect(turned(sceneOf(source, { maxWidth: 160 }))).toBe(true);
  });

  it('draws the changes branch from a separate side of the approval decision', () => {
    const source = examples[9];
    for (const maxWidth of [undefined, 320]) {
      const scene = sceneOf(source, { maxWidth });
      const [cx, cy] = centers(scene).get('decide')!;
      const start = (id: string): [number, number] => {
        const line = shapesOf(scene, itemById(scene, id, 'pele-edge')!).find((s) => s.kind === 'stroke')!;
        return [line.cmds[1], line.cmds[2]];
      };
      const accepted = start('L_decide_create_0'), returned = start('L_decide_apply_0');
      if (maxWidth === undefined) {
        expect(accepted[0]).toBeCloseTo(cx, 1);
        expect(returned[0]).toBeCloseTo(cx, 1);
        expect(accepted[1]).toBeGreaterThan(cy);
        expect(returned[1]).toBeLessThan(cy);
      } else {
        expect(accepted[1]).toBeCloseTo(cy, 1);
        expect(returned[1]).toBeCloseTo(cy, 1);
        expect(accepted[0]).toBeGreaterThan(cx);
        expect(returned[0]).toBeLessThan(cx);
      }
    }
  });

  it('retains nested groups, unnamed and empty lanes, styled nodes, links and self-loops after turning', () => {
    const source = '---\ntitle: Delivery\n---\nswimlane-beta LR\nstart --> a\nsubgraph Team\n subgraph Inner\n a{Ready?} --> b[(Store)]\n b --> b\n end\n c --> d --> e\nend\nsubgraph Empty\nend\nb --> c\nclick a "https://example.com"\nstyle a fill:#f00\nclassDef hot stroke:#0f0\nclass b hot';
    const wide = draw(source), narrow = draw(source, { maxWidth: 320 });
    const scene = narrow.scene;
    expect(turned(scene)).toBe(false);
    expect(lanes(scene).size).toBe(3);
    const inner = boxOf(itemById(scene, 'Inner', 'pele-cluster')!);
    const at = centers(scene);
    expect(inside(at.get('a')!, inner)).toBe(true);
    expect(inside(at.get('b')!, inner)).toBe(true);
    expect(narrow.links).toEqual(wide.links);
    expect(lines(scene)).toContain('Delivery');
    expect(shapesOf(scene, itemById(scene, 'a', 'pele-node')!)[0].paint).toBe('#f00');
    expect(shapesOf(scene, itemById(scene, 'b', 'pele-node')!).map((s) => s.paint)).toContain('#0f0');
    expect(itemById(scene, 'a', 'pele-shape-diam')).toBeDefined();
    expect(itemById(scene, 'b', 'pele-shape-cyl')).toBeDefined();
    expect(items(scene, 'pele-edge').length).toBe(items(wide.scene, 'pele-edge').length);
  });

  it('follows every direction', () => {
    const at = (dir: string, id: string): [number, number] => centers(sceneOf(`swimlane-beta ${dir}\n  subgraph L\n    a --> b\n  end`)).get(id)!;
    expect(at('TB', 'a')[1]).toBeLessThan(at('TB', 'b')[1]);
    expect(at('BT', 'a')[1]).toBeGreaterThan(at('BT', 'b')[1]);
    expect(at('LR', 'a')[0]).toBeLessThan(at('LR', 'b')[0]);
    expect(at('RL', 'a')[0]).toBeGreaterThan(at('RL', 'b')[0]);
  });

  it('gives nodes outside every lane a lane of their own', () => {
    const scene = sceneOf('swimlane-beta TD\n  start --> a\n  subgraph Team\n    a --> b\n  end');
    const boxes = lanes(scene);
    expect(boxes.size).toBe(2);
    const loose = [...boxes.keys()].find((id) => id !== 'Team')!;
    expect(inside(centers(scene).get('start')!, boxes.get(loose)!)).toBe(true);
    expect(boxes.get(loose)!.x).toBeLessThan(boxes.get('Team')!.x);
    expect(lanes(sceneOf('swimlane-beta TD\n  a --> b')).size).toBe(1);
  });

  it('draws an empty lane and a group inside a lane', () => {
    const scene = sceneOf('swimlane-beta TD\n  subgraph One\n    subgraph Inner\n      a --> b\n    end\n    c\n  end\n  subgraph Two\n  end\n  b --> c');
    expect(lanes(scene).size).toBe(2);
    expect(items(scene, 'pele-cluster').filter((i) => i.kind === 'pele-cluster')).toHaveLength(1);
    expect(lines(scene)).toContain('Inner');
  });

  it('ignores a direction inside a lane', () => {
    const plain = drawn('swimlane-beta TD\n  subgraph L\n    a --> b\n  end');
    const turned = drawn('swimlane-beta TD\n  subgraph L\n    direction LR\n    a --> b\n  end');
    expect(turned).toBe(plain);
  });

  it('keeps flowchart features: shapes, styles, links and titles', () => {
    const { scene, links } = draw(
      '---\ntitle: Orders\n---\nswimlane-beta LR\n  subgraph L[Lane **one**]\n    a{Choice} --> b[(Store)]\n    b --> b\n  end\n  click a "https://example.com" "tip"\n  style a fill:#f00\n  classDef hot stroke:#0f0\n  class b hot\n  style L fill:#00f'
    );
    expect(items(scene, 'pele-node').every((node) => node.kind.includes('pele-shape-'))).toBe(true);
    expect(lines(scene)).toContain('Orders');
    expect(links).toEqual([{ id: 'a', href: 'https://example.com/', internal: false }]);
    expect(shapesOf(scene, itemById(scene, 'a')!)[0].paint).toBe('#f00');
    expect(shapesOf(scene, itemById(scene, 'L')!).map((shape) => shape.paint)).toContain('#00f');
    expect(draw('swimlane-beta LR\n  a\n  click a "https://example.com"').links).toEqual([{ id: 'a', href: 'https://example.com/', internal: false }]);
  });

  it('picks a contrasting lane title color on a fill a style sets', () => {
    const scene = sceneOf('swimlane-beta LR\n  subgraph L[Light]\n    a\n  end\n  subgraph D[Dark]\n    b\n  end\n  subgraph P[Plain]\n    c\n  end\n  style L fill:#BBDEFB\n  style D fill:#1f3a5f');
    const title = (id: string): string => textsOf(scene, itemById(scene, id, 'pele-lane')!)[0].paint;
    expect(title('L')).toBe('var(--pele-fg-on-light,#1f1f1f)');
    expect(title('D')).toBe('var(--pele-fg-on-dark,#fff)');
    expect(title('P')).toBe('var(--_m)');
    expect(textsOf(scene, itemById(scene, 'a', 'pele-node')!)[0].paint).toBe('var(--_fg)');
  });

  it('inks or cases edges on a lane band a style fills', () => {
    const src = 'swimlane-beta TB\nsubgraph S["one<br/>two<br/>three<br/>four<br/>five<br/>six<br/>seven<br/>eight"]\n  A\nend\nS --> S\nstyle S fill:black';
    const scene = sceneOf(src);
    expect(shapesOf(scene, items(scene, 'pele-edge')[0])[0].paint).toBe('var(--pele-fg-on-dark,#fff)');
    const plain = sceneOf(src.replace('\nstyle S fill:black', ''));
    expect(plain.shapes.filter((s) => s.item === -1)).toEqual([]);
    expect(JSON.stringify(plain)).not.toContain('--pele-fg-on');
  });

  it('reads spacing from the swimlane config, then the flowchart config', () => {
    const src = 'swimlane-beta TD\n  subgraph L\n    a --> b\n  end';
    const plain = draw(src).height;
    expect(draw(`---\nconfig:\n  swimlane:\n    rankSpacing: 200\n---\n${src}`).height).toBeGreaterThan(plain + 100);
    expect(draw(`---\nconfig:\n  flowchart:\n    rankSpacing: 200\n---\n${src}`).height).toBeGreaterThan(plain + 100);
  });


  it('is the same every time', () => {
    expect(sceneOf(ORDER)).toEqual(sceneOf(ORDER));
  });

  it("renders Mermaid's documentation examples", () => {
    const corpus = loadCorpus('swimlane', /swimlane-beta/);
    expect(corpus.length).toBeGreaterThan(8);
    for (const src of corpus) {
      const result = draw(src);
      assertSafe(result, src.slice(0, 80));
      expect(lanes(result.scene).size, src.slice(0, 80)).toBeGreaterThan(0);
    }
  });
});

const TEMPLATES: ((p: string) => string)[] = [
  (p) => `swimlane-beta TD\n  subgraph L["${p}"]\n    a\n  end`,
  (p) => `swimlane-beta LR\n  subgraph L["${p}"]\n    a["${p}"] -- "${p}" --> b\n  end`,
  (p) => `swimlane-beta TD\n  subgraph ${p}\n    a\n  end`,
  (p) => `swimlane-beta ${p}\n  a --> b`,
  (p) => `swimlane-beta TD\n  subgraph L\n    a\n  end\n  style L ${p}\n  class L ${p}`,
  (p) => `swimlane-beta LR\n  subgraph L\n    a\n  end\n  click a "${p}" "${p}"\n  L:::${p}`,
  (p) => `---\ntitle: "${p}"\nconfig:\n  swimlane: "${p}"\n---\nswimlane-beta TD\n  a`,
  (p) => `swimlane-beta RL\n  subgraph L["\`**${p}**\`"]\n    a\n  end\n  accTitle: ${p}\n  accDescr: ${p}`,
];

describe('safe swimlane output', () => {
  it('holds with hostile text in every position', { timeout: 120000 }, () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        const result = tryDraw(template(payload));
        if (result === undefined) continue;
        assertSafe(result, JSON.stringify(template(payload)).slice(0, 160));
        rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(40);
  });

  it('handles lane names that are object keys', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const result = draw(`swimlane-beta TD\n  subgraph ${name}\n    a --> b\n  end\n  subgraph other\n    c\n  end\n  b --> c`);
      assertSafe(result, name);
      expect(lanes(result.scene).size).toBe(2);
    }
  });
});
