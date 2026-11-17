import { describe, expect, it } from 'vitest';
import { parse, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import type { Scene, SceneShape } from '../../src/draw/scene.js';
import { draw, itemById, items, lineOf, lines, sceneProblem, shapesOf, textOf } from '../support/scene.js';

const BASIC = 'radar-beta\n  axis A, B, C, D\n  curve one["First"]{1,2,3,4}\n  curve two{4,3,2,1}';

function config(radar: string, body: string): string {
  return `---\nconfig:\n  radar:\n${radar}\n---\n${body}`;
}

// The rings of the graticule are strokes of no item in the colour of the axes' guide lines.
const graticule = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'stroke' && s.item === -1 && s.paint === 'var(--_a)');

// The spokes, drawn from the centre outwards: a move to the centre, then a line to the end.
const axes = (scene: Scene): SceneShape => scene.shapes.find((s) => s.kind === 'stroke' && s.item === -1 && s.paint === 'var(--_b)')!;

// A ring is made of arcs, where a polygon is made of lines.
const isCircle = (s: SceneShape): boolean => s.cmds[3] === 4;

// How far a curve's first point is from the centre, straight up.
function top(src: string): number {
  const { scene } = draw(src);
  const [fill] = shapesOf(scene, itemById(scene, 'c', 'pele-curve')!);
  return axes(scene).cmds[2] - fill.cmds[2];
}

describe('radar rendering', () => {
  it('draws axes, labels, a graticule, curves and a legend', () => {
    const { scene, type } = draw(BASIC);
    expect(type).toBe('radar');
    expect(supports('radar-beta\naxis A')).toBe(true);
    const rings = graticule(scene);
    expect(rings).toHaveLength(5);
    expect(rings.every(isCircle)).toBe(true);
    expect(items(scene, 'pele-axis-label')).toHaveLength(4);
    expect(items(scene, 'pele-curve').map((i) => i.id)).toEqual(['one', 'two']);
    expect(items(scene, 'pele-legend-item')).toHaveLength(2);
    expect(lines(scene)).toContain('First');
    expect(lines(scene)).toContain('two');
    const [first, second] = items(scene, 'pele-curve').map((i) => shapesOf(scene, i));
    expect(first[0].paint).toMatch(/^var\(--pele-series-1,/);
    expect(second[0].paint).toMatch(/^var\(--pele-series-2,/);
    expect(first[0].opacity).toBe(0.2);
    // One move from the centre and one line out, for each of the four axes.
    expect(axes(scene).cmds.filter((c, i) => i % 6 === 0 && c === 0)).toHaveLength(4);
    expect(axes(scene).cmds).toHaveLength(24);
  });

  it('draws polygons for a polygon graticule, with the given number of ticks', () => {
    const { scene } = draw(BASIC + '\n  graticule polygon\n  ticks 3');
    const rings = graticule(scene);
    expect(rings).toHaveLength(3);
    expect(rings.some(isCircle)).toBe(false);
    // A polygon curve closes its outline with straight lines.
    for (const curve of items(scene, 'pele-curve')) expect(shapesOf(scene, curve)[0].cmds).toContain(5);
  });

  it('hides the legend with showLegend false', () => {
    const shown = draw(BASIC);
    const hidden = draw(BASIC + '\n  showLegend false');
    expect(items(shown.scene, 'pele-legend-item')).toHaveLength(2);
    expect(items(hidden.scene, 'pele-legend-item')).toHaveLength(0);
    expect(hidden.width).toBeLessThan(shown.width);
  });

  it('scales values between min and max', () => {
    const body = 'radar-beta\n axis A, B, C\n curve c{50, 0, 0}\n graticule polygon';
    expect(top(body)).toBe(160);
    expect(top(body + '\n max 100')).toBe(80);
    expect(top(body + '\n max 100\n min 20')).toBe(60);
    // Values outside the range are clipped to it.
    expect(top(body + '\n max 25')).toBe(160);
    expect(top(body + '\n min 60\n max 100')).toBe(0);
  });

  it('honours width, height, margins and the axis factors', () => {
    const base = draw(BASIC + '\n showLegend false');
    const large = draw(config('    width: 600\n    height: 600', BASIC + '\n showLegend false'));
    // The labels move out with the radius, so the picture grows by a little more than the chart.
    expect(large.width - base.width).toBeGreaterThanOrEqual(280);
    expect(large.width - base.width).toBeLessThan(300);
    expect(large.height - base.height).toBeGreaterThanOrEqual(280);
    const roomy = draw(config('    marginTop: 100\n    marginLeft: 120', BASIC + '\n showLegend false'));
    expect(roomy.height).toBeGreaterThan(base.height);
    expect(roomy.width).toBeGreaterThan(base.width);
    const spoke = (scene: Scene): number => axes(scene).cmds[2] - axes(scene).cmds[5];
    expect(spoke(draw(config('    axisScaleFactor: 0.5', BASIC)).scene)).toBe(80);
    expect(spoke(draw(BASIC).scene)).toBe(160);
    const far = draw(config('    axisLabelFactor: 1.5', BASIC));
    expect(far.height).toBeGreaterThan(base.height);
  });

  it('rounds curves by curveTension', () => {
    const straight = draw(config('    curveTension: 0', BASIC)).scene;
    const round = draw(config('    curveTension: 0.5', BASIC)).scene;
    expect(JSON.stringify(straight)).not.toBe(JSON.stringify(round));
    // With no tension every control point sits on an end point: from the first point, up from the
    // centre, a curve to the second, which is to the right of it.
    const [fill] = shapesOf(straight, itemById(straight, 'one', 'pele-curve')!);
    const [, x, y, op, ...rest] = fill.cmds;
    const { cmds } = axes(straight);
    const [cx, cy] = [cmds[1], cmds[2]];
    expect([x - cx, cy - y]).toEqual([0, 40]);
    expect(op).toBe(2);
    expect(rest.slice(0, 6).map((n, i) => (i % 2 === 0 ? n - cx : cy - n))).toEqual([0, 40, 80, 0, 80, 0]);
  });

  it('leaves out a curve without a value for every axis, but keeps it in the legend', () => {
    const { scene } = draw('radar-beta\n axis A, B, C\n curve full{1,2,3}\n curve short{1,2}');
    expect(items(scene, 'pele-curve').map((i) => i.id)).toEqual(['full']);
    expect(items(scene, 'pele-legend-item').map((i) => i.id)).toEqual(['full', 'short']);
  });

  it('orders named entries by axis, and rejects a missing one', () => {
    const model = parse('radar-beta\n axis A, B, C\n curve c{ C: 3, A: 1, B: 2 }');
    if (model.type === 'radar') expect(model.curves[0].entries).toEqual([1, 2, 3]);
    expect(() => draw('radar-beta\n axis A["Alpha"], B\n curve c{ B: 2 }')).toThrow('Missing entry for axis Alpha');
    expect(() => draw('radar-beta\n axis a["#35;x &amp;y"], b\n curve c{ b: 1 }')).toThrow('Missing entry for axis #35;x &amp;y');
    expect(() => draw('radar-beta\ncurve a{1 %% c\n')).toThrow(expect.objectContaining({ line: 2, column: 10 }));
    expect(() => draw('radar-beta\n curve c{ B: 2 }')).toThrow(
      'Axes must be populated before curves for reference entries'
    );
  });

  it('reads names that start with circle, polygon, true, false or title', () => {
    const model = parse('radar-beta\n axis circles, polygonal, trueNorth, falsey, titles\n curve titles{1, 2, 3, 4, 5}, circles{ circles: 1, polygonal 2, trueNorth: 3, falsey 4, titles: 5 }');
    expect(model.type).toBe('radar');
    if (model.type === 'radar') {
      expect(model.axes.map((a) => a.name)).toEqual(['circles', 'polygonal', 'trueNorth', 'falsey', 'titles']);
      expect(model.curves.map((c) => [c.name, c.entries])).toEqual([['titles', [1, 2, 3, 4, 5]], ['circles', [1, 2, 3, 4, 5]]]);
      expect(model.title).toBeUndefined();
    }
    const glued = parse('radar-beta\n axis a, b\n showLegend falsecurve x{1, 2}\n graticule polygonaxis c');
    if (glued.type === 'radar') {
      expect(glued.options).toMatchObject({ showLegend: false, graticule: 'polygon' });
      expect(glued.axes.map((a) => a.name)).toEqual(['a', 'b', 'c']);
    }
    expect(() => parse('radar-beta\n axis circle, b')).toThrow('Parse error');
  });

  it('uses the last value of a repeated option and caps ticks at 32', () => {
    const model = parse('radar-beta\n ticks 3\n ticks 100\n max 5\n max 7\n graticule polygon\n showLegend false');
    expect(model.type).toBe('radar');
    if (model.type === 'radar') {
      expect(model.options).toEqual({ showLegend: false, ticks: 32, max: 7, min: 0, graticule: 'polygon' });
    }
  });

  it('draws the title above, from the diagram or the front matter', () => {
    expect(lines(draw('---\ntitle: From front matter\n---\n' + BASIC).scene)).toContain('From front matter');
    const own = draw('---\ntitle: From front matter\n---\n' + BASIC + '\n title Own').scene;
    expect(lines(own)).toContain('Own');
    expect(textOf(own)).not.toContain('From front matter');
  });

  it('keeps every label inside the picture', () => {
    const { scene, width, height } = draw(
      'radar-beta\n axis a["Top"], b["A very long label on the right side"], c["Bottom"], d["A very long label on the left side"]\n curve c{1,2,3,4}'
    );
    // A label's item box is an estimate of its width, so the lines are measured.
    for (const text of scene.texts.filter((t) => t.item >= 0 && scene.items[t.item].kind.includes('pele-axis-label'))) {
      const half = metricsMeasurer.width(lineOf(text), text.size, 0) / 2;
      expect(text.x - half).toBeGreaterThanOrEqual(0);
      expect(text.x + half).toBeLessThanOrEqual(width);
      expect(text.y).toBeGreaterThan(0);
      expect(text.y).toBeLessThanOrEqual(height);
    }
    expect(width).toBeGreaterThan(320 + 2 * 200);
  });

  it('scales values near the largest double like small ones', () => {
    const huge = ['1' + '0'.repeat(308), '5' + '0'.repeat(307), '25' + '0'.repeat(306)].join(',');
    const curve = (values: string): number[] => {
      const { scene } = draw(`radar-beta\n axis A, B, C\n curve c{${values}}\n graticule polygon`);
      const [fill] = shapesOf(scene, itemById(scene, 'c', 'pele-curve')!);
      return fill.cmds.map((n) => Math.round(n * 1e6) / 1e6);
    };
    expect(curve(huge)).toEqual(curve('4,2,1'));
  });

  it('copes with no axes, no curves, one axis, and degenerate ranges', () => {
    for (const src of [
      'radar-beta',
      'radar-beta\n axis A, B, C',
      'radar-beta\n axis A\n curve c{5}',
      'radar-beta\n curve c{1,2,3}',
      'radar-beta\n axis A, B\n curve c{1,1}\n min 1\n max 1',
      'radar-beta\n axis A, B\n curve c{1,2}\n min 9\n max 2',
      'radar-beta\n axis A, B\n curve c{0,0}',
      'radar-beta\n axis A, B\n curve c{1,2}\n ticks 0',
      'radar-beta\n axis A, B\n curve c{1,2}\n ticks 0.3\n graticule polygon',
      'radar-beta\n axis A, B\n curve c{1,2}\n max ' + '9'.repeat(400),
      'radar-beta\n axis A, B\n curve c{' + '9'.repeat(400) + ',2}',
      config('    width: -5\n    height: "tall"\n    curveTension: 99\n    marginTop: -1', BASIC),
    ]) {
      const result = draw(src);
      expect(sceneProblem(result), src).toBeUndefined();
      expect(textOf(result.scene), src).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
