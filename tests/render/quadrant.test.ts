import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Scene, SceneText } from '../../src/draw/scene.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { draw, itemById, items, lineOf, lines, shapesOf, textsOf } from '../support/scene.js';

const CHART = `quadrantChart
  title Reach and engagement
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 Expand
  quadrant-2 Promote
  quadrant-3 Re-evaluate
  quadrant-4 Improve
  Campaign A: [0.25, 0.75]
  Campaign B: [0.75, 0.25]`;

const points = (scene: Scene) => items(scene, 'pele-point');

// Where a point is: the middle of its circle.
function centre(scene: Scene, id: string): [number, number] {
  const { box } = itemById(scene, id, 'pele-point')!;
  return [(box!.x0 + box!.x1) / 2, (box!.y0 + box!.y1) / 2];
}

// The radius of a point's circle, from the arc that draws it.
const radius = (scene: Scene, id: string): number => shapesOf(scene, itemById(scene, id, 'pele-point')!)[0].cmds[4];

// What is drawn, without where in the source each part was written.
const picture = (scene: Scene): string => JSON.stringify([scene.shapes, scene.texts]);

const textNamed = (scene: Scene, line: string): SceneText => scene.texts.find((t) => lineOf(t) === line)!;

describe('quadrant chart rendering', () => {
  it('draws the title, four quadrants, axis labels and points', () => {
    const { scene, type, width, height } = draw(CHART);
    expect(type).toBe('quadrantChart');
    expect(supports('quadrantChart')).toBe(true);
    expect([width, height]).toEqual([500, 500]);
    expect(items(scene, 'pele-quadrant')).toHaveLength(4);
    for (const text of ['Reach and engagement', 'Low Reach', 'High Reach', 'Low Engagement', 'High Engagement']) {
      expect(lines(scene)).toContain(text);
    }
    for (const text of ['Expand', 'Promote', 'Re-evaluate', 'Improve', 'Campaign A', 'Campaign B']) {
      expect(lines(scene)).toContain(text);
    }
    expect(points(scene)).toHaveLength(2);
    expect(shapesOf(scene, points(scene)[0])[0].paint).toMatch(/^var\(--pele-series-1,/);
  });

  it('places points by their coordinates, x to the right and y upwards', () => {
    const { scene } = draw('quadrantChart\n A: [0, 0]\n B: [1, 1]\n C: [0.5, 0.5]');
    const [ax, ay] = centre(scene, 'A');
    const [bx, by] = centre(scene, 'B');
    expect(bx).toBeGreaterThan(ax);
    expect(by).toBeLessThan(ay);
    const [cx, cy] = centre(scene, 'C');
    expect(cx).toBeCloseTo((ax + bx) / 2);
    expect(cy).toBeCloseTo((ay + by) / 2);
  });

  it('puts quadrant 1 at the top right and goes on anticlockwise', () => {
    const { scene } = draw('quadrantChart\n quadrant-1 q1\n quadrant-2 q2\n quadrant-3 q3\n quadrant-4 q4');
    const [q1, q2, q3, q4] = ['1', '2', '3', '4'].map((id) => itemById(scene, id, 'pele-quadrant')!.box!);
    expect(q1.x0).toBeGreaterThan(q2.x0);
    expect(q1.y0).toBe(q2.y0);
    expect(q3.x0).toBe(q2.x0);
    expect(q3.y0).toBeGreaterThan(q2.y0);
    expect([q4.x0, q4.y0]).toEqual([q1.x0, q3.y0]);
  });

  it('draws the first point on top, as Mermaid does', () => {
    const { scene } = draw('quadrantChart\n First: [0.5, 0.5]\n Second: [0.5, 0.5]');
    expect(points(scene).map((p) => p.id)).toEqual(['Second', 'First']);
  });

  it('moves the x axis labels below the chart once there are points', () => {
    const y = (src: string): number => textNamed(draw(src).scene, 'Left').y;
    expect(y('quadrantChart\n x-axis Left --> Right')).toBeLessThan(100);
    expect(y('quadrantChart\n x-axis Left --> Right\n A: [0.5, 0.5]')).toBeGreaterThan(400);
    expect(y('---\nconfig:\n  quadrantChart:\n    xAxisPosition: bottom\n---\nquadrantChart\n x-axis Left --> Right')).toBeGreaterThan(400);
  });

  it('applies point styles, with direct styles over class styles', () => {
    const { scene } = draw(
      `quadrantChart
        A: [0.1, 0.1] radius: 12
        B:::c1: [0.2, 0.2] color: #ff3300, radius: 10
        C:::c2: [0.3, 0.3]
        D: [0.4, 0.4] color: 00f, stroke-width: 3px
        E: [0.5, 0.5] stroke-color: #00ff00
        classDef c1 color: #109060
        classDef c2 color: #908342, radius : 9, stroke-color: #310085, stroke-width: 10px`
    );
    const dot = (id: string) => shapesOf(scene, itemById(scene, id, 'pele-point')!);
    expect(radius(scene, 'A')).toBe(12);
    expect(radius(scene, 'B')).toBe(10);
    expect(dot('B').map((s) => [s.kind, s.paint])).toEqual([['fill', '#ff3300']]);
    expect(itemById(scene, 'B', 'pele-point')!.kind.split(' ')).toContain('c1');
    expect(radius(scene, 'C')).toBe(9);
    expect(dot('C').map((s) => [s.kind, s.paint, s.width])).toEqual([
      ['fill', '#908342', undefined],
      ['stroke', '#310085', 10],
    ]);
    const [fill, stroke] = dot('D');
    expect(fill.paint).toBe('#00f');
    expect([stroke.kind, stroke.width]).toEqual(['stroke', 3]);
    expect(stroke.paint).toContain('--pele-series-1');
    // Mermaid gives a stroke colour no width unless one is set, so it does not show.
    expect(dot('E').map((s) => s.kind)).toEqual(['fill']);
    expect(radius(scene, 'E')).toBe(5);
  });

  it("rejects a style Mermaid rejects, with Mermaid's message", () => {
    expect(() => draw('quadrantChart\n A: [0.1, 0.1] radius: big')).toThrow(
      'value for radius big is invalid, please use a valid number'
    );
    expect(() => draw('quadrantChart\n A: [0.1, 0.1] color: red')).toThrow(
      'value for color red is invalid, please use a valid hex code'
    );
    expect(() => draw('quadrantChart\n classDef c fill: #fff')).toThrow('style named fill is not supported.');
    expect(() => draw('quadrantChart\n A: [1.2, 0.4]')).toThrow(PeleError);
    expect(() => draw('quadrantChart\n A: [0.2, 0.4')).toThrow(PeleError);
  });

  it('leaves out a point whose coordinate is not a number from 0 to 1', () => {
    // Mermaid's lexer takes `0x5` and `0,5` as coordinates; they are 5 and not a number.
    const { scene } = draw('quadrantChart\n A: [0x5, 0.5]\n B: [0,5, 0.5]\n C: [0.5, 0.5]');
    expect(points(scene).map((p) => p.id)).toEqual(['C']);
  });

  it('honours the size, radius, padding and axis position settings', () => {
    const src = 'quadrantChart\n y-axis Down --> Up\n A: [0.5, 0.5]';
    const config = (body: string): string => `---\nconfig:\n  quadrantChart:\n${body}\n---\n${src}`;
    const plain = draw(src);
    const sized = draw(config('    chartWidth: 400\n    chartHeight: 320'));
    expect([sized.width, sized.height]).toEqual([400, 320]);
    expect(radius(draw(config('    pointRadius: 9')).scene, 'A')).toBe(9);
    const cx = (result: typeof plain): number => centre(result.scene, 'A')[0];
    expect(cx(draw(config('    yAxisPosition: right')))).toBeLessThan(cx(plain));
    expect(cx(draw(config('    yAxisLabelPadding: 40')))).toBeGreaterThan(cx(plain));
    const same = (body: string): boolean => picture(draw(config(body)).scene) === picture(plain.scene);
    expect(same('    quadrantPadding: 30')).toBe(false);
    expect(same('    pointTextPadding: 30')).toBe(false);
    expect(same('    chartWidth: "wide"\n    pointRadius: -3')).toBe(true);
  });

  it('sizes text with the quadrantChart font size settings', () => {
    const src = `quadrantChart
  title Garden plan
  x-axis Low effort --> High effort
  y-axis Low value --> High value
  quadrant-1 Big bets
  Herb spiral: [0.3, 0.7]`;
    const config = (body: string): string => `---\nconfig:\n  quadrantChart:\n${body}\n---\n${src}`;
    const sizeOf = (scene: Scene, line: string): number => textNamed(scene, line).size;
    const plain = draw(src, { fontSize: 16 }).scene;
    expect(textNamed(plain, 'Garden plan').weight).toBe(700);
    expect(sizeOf(plain, 'Low effort')).toBe(14);
    expect(sizeOf(plain, 'Herb spiral')).toBe(12);
    const sized = draw(
      config(
        '    titleFontSize: 30\n    quadrantLabelFontSize: 20\n    xAxisLabelFontSize: 11\n' +
          '    yAxisLabelFontSize: 13\n    pointLabelFontSize: 9'
      ),
      { fontSize: 16 }
    ).scene;
    expect(sizeOf(sized, 'Garden plan')).toBe(30);
    expect(sizeOf(sized, 'Big bets')).toBe(20);
    expect(sizeOf(sized, 'Low effort')).toBe(11);
    expect(sizeOf(sized, 'High effort')).toBe(11);
    expect(sized.texts.filter((t) => t.angle === -90).map((t) => t.size)).toEqual([13, 13]);
    expect(sizeOf(sized, 'Herb spiral')).toBe(9);
    expect(picture(draw(config('    titleFontSize: "big"'), { fontSize: 16 }).scene)).toBe(picture(plain));
    expect(sizeOf(draw(config('    pointLabelFontSize: 0'), { fontSize: 16 }).scene, 'Herb spiral')).toBe(4);
  });

  it('keeps a point label on one line when it fits in the plot', () => {
    const name = 'Drip irrigation for the whole orchard and the vegetable beds';
    const { scene } = draw(`quadrantChart\n ${name}: [0.5, 0.5]`, { fontSize: 22 });
    expect(lines(scene)).toContain(name);
  });

  it('keeps point labels off each other and inside the chart', () => {
    const { scene } = draw('quadrantChart\n One: [0.5, 0]\n Two: [0.5, 0.02]\n Three: [1, 1]\n Four: [0, 0.5]');
    const labels = ['One', 'Two', 'Three', 'Four'].map((name) => textNamed(scene, name));
    for (const { x, y } of labels) {
      expect(x).toBeGreaterThan(8);
      expect(x).toBeLessThan(492);
      expect(y).toBeGreaterThan(8);
      expect(y).toBeLessThan(492);
    }
    expect(new Set(labels.map(({ x, y }) => `${Math.round(x / 20)},${Math.round(y / 10)}`)).size).toBe(4);
  });

  it('keeps a boundary point label below its quadrant title before using a crossing fallback', () => {
    const source = `quadrantChart
      title Q4 candidates by effort and impact
      x-axis Low effort --> High effort
      y-axis Low impact --> High impact
      quadrant-1 Plan carefully
      quadrant-2 Do first
      quadrant-3 Reconsider
      quadrant-4 Quick wins
      Chart gallery editor: [0.72, 0.85]
      First-run onboarding: [0.35, 0.78]
      Shared folders: [0.88, 0.70]
      Export to PDF: [0.30, 0.55]
      Custom themes: [0.45, 0.20]
      Calendar sync: [0.65, 0.30]
      Keyboard shortcut sheet: [0.12, 0.48]`;
    const { scene } = draw(source);
    const quadrant = itemById(scene, '3', 'pele-quadrant')!;
    const { box: rect } = shapesOf(scene, quadrant)[0];
    const [title] = textsOf(scene, quadrant);
    const label = textNamed(scene, 'Keyboard shortcut sheet');
    const halfWidth = metricsMeasurer.width('Keyboard shortcut sheet', 12, 0) / 2;
    expect(label.y).toBeGreaterThan(title.y + 12);
    expect(label.x - halfWidth).toBeGreaterThan(rect.x0);
    expect(label.x + halfWidth).toBeLessThan(rect.x1);
    expect(points(scene)).toHaveLength(7);
  });

  it('keeps a label beside its point when there is room before going below the quadrant title', () => {
    const source = `quadrantChart
      title Q4 candidates by effort and impact
      x-axis Low effort --> High effort
      y-axis Low impact --> High impact
      quadrant-1 Plan carefully
      quadrant-2 Do first
      quadrant-3 Reconsider
      quadrant-4 Quick wins
      Left edge: [0, 0.5]`;
    const { scene } = draw(source, { maxWidth: 320 });
    expect(textNamed(scene, 'Left edge').y).toBeLessThan(textNamed(scene, 'Reconsider').y);
  });

  it('lets point labels sit where an empty quadrant label would be', () => {
    const { scene } = draw('quadrantChart\n  P: [0.25, 0.4375]\n  Q: [0.25, 0.4175]');
    const [x, y] = centre(scene, 'P');
    const label = textNamed(scene, 'P');
    expect(label.x).toBeCloseTo(x);
    expect(label.y).toBeLessThan(y);
  });

  it('reads markdown strings and line breaks in labels', () => {
    const { scene } = draw('quadrantChart\n quadrant-1 "`**Bold** text`"\n "two<br>lines": [0.5, 0.5]');
    const bold = textNamed(scene, 'Bold text');
    expect(bold.spans.map((s) => [s.text, s.weight])).toEqual([['Bold', 700], [' text', undefined]]);
    expect(lines(scene)).toEqual(expect.arrayContaining(['two', 'lines']));
  });

  it('takes the title from front matter unless the chart sets one', () => {
    expect(lines(draw('---\ntitle: From front matter\n---\nquadrantChart\n A: [0.5, 0.5]').scene)).toContain('From front matter');
    expect(lines(draw('---\ntitle: From front matter\n---\nquadrantChart\n title Own').scene)).toContain('Own');
  });

  it('exposes the model', () => {
    const model = parse('quadrantChart\n x-axis a --> b\n quadrant-2 "`Do`"\n P:::k: [0.2, 0.8] radius: 3\n classDef k color: #abc');
    expect(model.type).toBe('quadrantChart');
    if (model.type === 'quadrantChart') {
      expect(model.xAxisLeft).toEqual({ text: 'a', type: 'text' });
      expect(model.xAxisRight).toEqual({ text: 'b', type: 'text' });
      expect(model.quadrants[1]).toEqual({ text: 'Do', type: 'markdown' });
      expect(model.points).toEqual([{ x: 0.2, y: 0.8, text: { text: 'P', type: 'text' }, className: 'k', radius: 3 }]);
      expect([...model.classes]).toEqual([['k', { color: '#abc' }]]);
    }
  });

  it('keeps the character before a comment', () => {
    const model = parse('quadrantChart\nquadrant-1 A%% note');
    expect(model.type === 'quadrantChart' && model.quadrants[0]).toEqual({ text: 'A', type: 'text' });
    expect(() => parse('quadrantChart\nquadrant-1 A:%% note')).toThrow(PeleError);
  });

  it('gives the same output for the same input', () => {
    expect(draw(CHART)).toEqual(draw(CHART));
  });
});
