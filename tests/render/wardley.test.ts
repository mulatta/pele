import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Scene, SceneShape } from '../../src/draw/scene.js';
import { draw, itemById, items, lines, sceneProblem, shapesOf, textOf, textsOf } from '../support/scene.js';

// What is drawn, without where in the source each part was written.
const picture = (scene: Scene): string => JSON.stringify([scene.shapes, scene.texts]);

// Lines of no item in a dash pattern: the stage dividers are dashed 4 and 4, the optional grid 2 and 6.
const dashed = (scene: Scene, dash: number[]): SceneShape[] =>
  scene.shapes.filter((s) => s.kind === 'stroke' && s.item === -1 && s.dash?.join() === dash.join());
const stages = (scene: Scene): SceneShape[] => dashed(scene, [4, 4]);
const grid = (scene: Scene): SceneShape[] => dashed(scene, [2, 6]);

// The left end of the horizontal axis, from which the stages are laid out.
const originX = (scene: Scene): number => scene.shapes.find((s) => s.kind === 'stroke' && s.item === -1 && s.paint === 'var(--_l)')!.cmds[1];

// The middle of a component's circle, which is the first thing it draws.
function at(scene: Scene, id: string): [number, number] {
  const { box } = shapesOf(scene, itemById(scene, id, 'pele-wardley-component')!)[0];
  return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
}

// Where a component's label starts.
const labelX = (src: string): number => {
  const { scene } = draw(src);
  return textsOf(scene, itemById(scene, 'A', 'pele-wardley-component')!)[0].x;
};

const TEA =
  'wardley-beta\ntitle Tea Shop\nanchor Business [0.95, 0.63]\ncomponent Cup of Tea [0.79, 0.61]\ncomponent Tea [0.63, 0.81]\n' +
  'component Kettle [0.43, 0.35]\ncomponent Power [0.10, 0.70]\nBusiness -> Cup of Tea\nCup of Tea -> Tea\nCup of Tea -> Kettle\nKettle -> Power\n' +
  'evolve Kettle 0.62\nevolve Power 0.89\nnote "Standardising power" [0.30, 0.49]\n';

describe('wardley rendering', () => {
  it('draws axes, stages, components, links, evolution, and notes', () => {
    const result = draw(TEA);
    const { scene, type } = result;
    expect(type).toBe('wardley');
    expect(supports(TEA)).toBe(true);
    expect(stages(scene)).toHaveLength(3);
    for (const stage of ['Genesis', 'Custom Built', 'Product', 'Commodity', 'Evolution', 'Visibility']) expect(lines(scene)).toContain(stage);
    expect(items(scene, 'pele-wardley-component')).toHaveLength(4);
    expect(items(scene, 'pele-wardley-anchor')).toHaveLength(1);
    expect(items(scene, 'pele-edge')).toHaveLength(4);
    expect(items(scene, 'pele-wardley-trend')).toHaveLength(2);
    expect(lines(scene)).toContain('Standardising power');
    expect(lines(scene)).toContain('Tea Shop');
    expect(itemById(scene, 'Cup of Tea', 'pele-wardley-component')).toBeDefined();
    expect(sceneProblem(result)).toBeUndefined();
  });

  it('places components by evolution across and visibility up', () => {
    const { scene } = draw('wardley-beta\ncomponent Low [0.1, 0.2]\ncomponent High [0.9, 0.8]\ncomponent Percent [90.0, 80.0]\n');
    const low = at(scene, 'Low');
    const high = at(scene, 'High');
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(high[1]).toBeLessThan(low[1]);
    expect(at(scene, 'Percent')).toEqual(high);
  });

  it('exposes the model in percentages', () => {
    const model = parse(TEA);
    expect(model.type).toBe('wardley');
    if (model.type !== 'wardley') return;
    expect(model.nodes.find((n) => n.id === 'Kettle')).toMatchObject({ x: 35, y: 43, className: 'component' });
    expect(model.nodes[0]).toMatchObject({ id: 'Business', className: 'anchor' });
    expect(model.links).toHaveLength(4);
    expect(model.trends).toEqual([
      { nodeId: 'Kettle', targetX: 62, targetY: 43 },
      { nodeId: 'Power', targetX: 89, targetY: 10 },
    ]);
  });

  it('draws custom stages, dual labels, and stage widths', () => {
    const { scene } = draw('wardley-beta\nevolution Genesis@0.3 / Concept -> Custom@0.5 -> Product@0.9 -> Utility@1.0\ncomponent A [0.5, 0.5]\n');
    expect(lines(scene)).toContain('Genesis / Concept');
    expect(lines(scene)).toContain('Utility');
    const xs = stages(scene).map((s) => s.cmds[1] - originX(scene));
    expect(xs).toHaveLength(3);
    expect(xs[0] / xs[1]).toBeCloseTo(0.6, 5);
  });

  it('draws sourcing strategies and inertia', () => {
    const { scene } = draw(
      'wardley-beta\ncomponent A [0.9, 0.1] (build)\ncomponent B [0.7, 0.4] (buy) inertia\ncomponent C [0.5, 0.7] (outsource)\ncomponent D [0.3, 0.9] (market) (inertia)\n'
    );
    // Each strategy fills the circle in its own paint.
    const circle = (id: string): SceneShape => shapesOf(scene, itemById(scene, id, 'pele-wardley-component')!)[0];
    expect(['A', 'B', 'C', 'D'].map((id) => circle(id).paint)).toEqual(['var(--_s)', 'var(--_a)', 'var(--_m)', 'var(--_bg)']);
    // A market adds a triangle of circles inside its own.
    expect(shapesOf(scene, itemById(scene, 'D', 'pele-wardley-component')!).length).toBeGreaterThan(shapesOf(scene, itemById(scene, 'A', 'pele-wardley-component')!).length);
    // Inertia is a bar at the right of the component, a fill of three line segments.
    const bars = items(scene, 'pele-wardley-component').filter((c) => shapesOf(scene, c).some((s) => s.kind === 'fill' && s.paint === 'var(--_l)' && s.cmds.length === 13));
    expect(bars.map((c) => c.id)).toEqual(['B', 'D']);
  });

  it('draws flows, dashed links, and link labels', () => {
    const src = "wardley-beta\ncomponent A [0.9, 0.1]\ncomponent B [0.5, 0.5]\ncomponent C [0.1, 0.9]\nA +> B\nB +< C\nA +<> C\nA -.-> B; note here\nB +'cash'> C\nA -> Missing\nA -> A\n";
    const { scene } = draw(src);
    const edges = items(scene, 'pele-edge');
    expect(edges).toHaveLength(5);
    // An arrowhead is a filled triangle of its edge.
    const heads = edges.flatMap((e) => shapesOf(scene, e)).filter((s) => s.kind === 'fill');
    expect(heads).toHaveLength(5);
    expect(items(scene, 'pele-wardley-dashed')).toHaveLength(1);
    expect(items(scene, 'pele-wardley-dashed')[0].id).toBe('A-B');
    expect(lines(scene)).toContain('note here');
    expect(lines(scene)).toContain('cash');
  });

  it('draws pipelines around their components and moves the parent onto the box', () => {
    const src = 'wardley-beta\ncomponent Kettle [0.45, 0.57]\ncomponent Water [0.8, 0.8]\npipeline Kettle {\n  component Campfire Kettle [0.35]\n  component Electric Kettle [0.53]\n}\nWater -> Electric Kettle\nCampfire Kettle -> Kettle\n';
    const { scene } = draw(src);
    expect(items(scene, 'pele-wardley-pipeline')).toHaveLength(1);
    expect(items(scene, 'pele-wardley-pipeline-component')).toHaveLength(2);
    expect(items(scene, 'pele-wardley-pipeline-parent')).toHaveLength(1);
    expect(itemById(scene, 'Water-Kettle_Electric Kettle', 'pele-edge')).toBeDefined();
    expect(items(scene, 'pele-edge')).toHaveLength(1);
    const model = parse(src);
    if (model.type === 'wardley') expect(model.pipelines).toEqual([{ nodeId: 'Kettle', componentIds: ['Kettle_Campfire Kettle', 'Kettle_Electric Kettle'] }]);
  });

  it('draws annotations, listing their texts in the box or under the map', () => {
    const body = 'annotation 2,[0.5, 0.5] "Second"\nannotation 1,[0.6, 0.65] "First"\n';
    const boxed = draw('wardley-beta\nannotations [0.9, 0.1]\n' + body);
    const below = draw('wardley-beta\n' + body);
    expect(items(boxed.scene, 'pele-wardley-annotation')).toHaveLength(2);
    expect(lines(boxed.scene).indexOf('1. First')).toBeLessThan(lines(boxed.scene).indexOf('2. Second'));
    expect(lines(below.scene)).toContain('2. Second');
    expect(below.height).toBeGreaterThan(boxed.height);
  });

  it('moves a label out of the way of a link that leaves up and to the right', () => {
    const alone = labelX('wardley-beta\ncomponent A [0.5, 0.5]\ncomponent B [0.2, 0.2]\nA -> B\n');
    const blocked = labelX('wardley-beta\ncomponent A [0.5, 0.5]\ncomponent B [0.8, 0.8]\ncomponent C [0.2, 0.8]\nA -> B\nA -> C\n');
    const moved = labelX('wardley-beta\ncomponent A [0.5, 0.5] label [30, 30]\ncomponent B [0.8, 0.8]\nA -> B\n');
    expect(blocked).toBeLessThan(alone);
    expect(moved).toBe(alone + 22);
  });

  it('draws accelerators and deaccelerators', () => {
    const { scene } = draw('wardley-beta\naccelerator "AI Adoption" [0.55, 0.25]\ndeaccelerator Legacy [0.15, 0.75]\n');
    expect(items(scene, 'pele-wardley-accelerator').map((i) => i.id)).toEqual(['AI Adoption']);
    expect(items(scene, 'pele-wardley-deaccelerator').map((i) => i.id)).toEqual(['Legacy']);
  });

  it('honours size, label offsets, and the grid option, and keeps labels inside the picture', () => {
    const base = draw('wardley-beta\ncomponent A [0.5, 0.5]\n');
    const sized = draw('wardley-beta\nsize [1100, 800]\ncomponent A [0.5, 0.5]\n');
    expect(sized.width - base.width).toBe(200);
    expect(sized.height - base.height).toBe(200);
    const edge = draw('wardley-beta\ncomponent A long label at the right edge [0.5, 1.0]\n');
    expect(edge.width).toBeGreaterThan(base.width + 100);
    const moved = draw('wardley-beta\ncomponent A [0.5, 0.5] label [-40, 30]\n');
    expect(picture(moved.scene)).not.toBe(picture(base.scene));
    expect(grid(draw('---\nconfig:\n  wardley-beta:\n    showGrid: true\n---\nwardley-beta\ncomponent A [0.5, 0.5]\n').scene)).toHaveLength(3);
    expect(grid(base.scene)).toHaveLength(0);
  });

  it('draws titles', () => {
    expect(lines(draw('---\ntitle: Front\n---\nwardley-beta\naccTitle: Acc\naccDescr: Described\n').scene)).toContain('Front');
    const own = draw('---\ntitle: Front\n---\nwardley-beta\ntitle Own\n').scene;
    expect(lines(own)).toContain('Own');
    expect(textOf(own)).not.toContain('Front');
  });

  it("rejects what Mermaid rejects, with Mermaid's messages", () => {
    expect(() => draw('wardley-beta\ncomponent A [150.5, 0.5]\n')).toThrow(
      'Component "A" visibility must be between 0-1 (decimal) or 0-100 (percentage). Received: 150.5'
    );
    expect(() => draw('wardley-beta\npipeline Nope {\n component A [0.5]\n}\n')).toThrow(
      'Pipeline "Nope" must reference an existing component with coordinates.'
    );
    for (const src of ['wardley-beta\ncomponent market [0.1, 0.2]', 'wardley-beta\ncomponent A [1, 2]', 'wardley-beta\nA B', 'wardley-beta\nnote text [0.1, 0.2]']) {
      expect(() => draw(src), src).toThrow(PeleError);
    }
  });
});
