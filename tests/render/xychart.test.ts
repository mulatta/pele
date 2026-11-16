import { describe, expect, it } from 'vitest';
import { tickStep, tickValue, ticksBetween } from '../../src/diagrams/xychart/ticks.js';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Scene, SceneShape } from '../../src/draw/scene.js';
import { draw, hasClass, items, lineOf, lines, shapesOf } from '../support/scene.js';

const CHART = `xychart
  title "Sales Revenue"
  x-axis "Month" [jan, feb, mar]
  y-axis "Revenue (in $)" 4000 --> 10000
  bar "2024" [5000, 6000, 7500]
  line "2025" [5500, 7000, 9000]`;

const configured = (body: string, chart: string): string => `---\nconfig:\n  xyChart:\n${body}\n---\n${chart}`;

// Where a source put a part moves with the lines the configuration takes; the drawing does not.
const drawn = (src: string): string => JSON.stringify(draw(src).scene, (key, value) => (['line', 'end', 'from', 'to', 'symbol'].includes(key) ? undefined : value));

const SERIES = 'var(--pele-series-';
// A path is op codes, each followed by its arguments: M, L, C, Q, A, Z.
const ARGS = [2, 2, 6, 4, 7, 0];
function opsOf(s: SceneShape): number[] {
  const ops: number[] = [];
  for (let i = 0; i < s.cmds.length; i += 1 + ARGS[s.cmds[i]]) ops.push(s.cmds[i]);
  return ops;
}
const isRect = (s: SceneShape): boolean => s.kind === 'fill' && !opsOf(s).includes(4) && opsOf(s).at(-1) === 5;
const isDot = (s: SceneShape): boolean => s.kind === 'fill' && opsOf(s).includes(4);
const inLegend = (scene: Scene, s: SceneShape): boolean => s.item >= 0 && hasClass(scene.items[s.item], 'pele-legend-item');

// Series are items only when they have a title, so the marks are told apart by their shape.
const bars = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => isRect(s) && s.paint.startsWith(SERIES) && !inLegend(scene, s));
const dots = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => isDot(s) && !inLegend(scene, s));
const width = (s: SceneShape): number => s.box.x1 - s.box.x0;
const height = (s: SceneShape): number => s.box.y1 - s.box.y0;
const centre = (s: SceneShape): number => (s.box.x0 + s.box.x1) / 2;

// The axis is the one stroke in the axis colour; its lines are segments of M, L pairs.
function axisSegments(scene: Scene): number[][] {
  const axis = scene.shapes.find((s) => s.kind === 'stroke' && s.paint === 'var(--_b)');
  const out: number[][] = [];
  for (let i = 0; axis && i < axis.cmds.length; i += 6) out.push([axis.cmds[i + 1], axis.cmds[i + 2], axis.cmds[i + 4], axis.cmds[i + 5]]);
  return out;
}
const longer = (segments: number[][], horizontal: boolean): number =>
  segments.filter(([x1, y1, x2, y2]) => (horizontal ? y1 === y2 && Math.abs(x2 - x1) > 100 : x1 === x2 && Math.abs(y2 - y1) > 100)).length;

function ticks(lo: number, hi: number, count: number): number[] {
  return ticksBetween(lo, hi, tickStep(hi - lo, count));
}

describe('tick selection', () => {
  it('steps by 1, 2 or 5 times a power of ten', () => {
    expect(ticks(0, 100, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(ticks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(4000, 11000, 7)).toEqual([4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000]);
    expect(ticks(0, 198.2, 8)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);
    expect(ticks(-6, 8, 7)).toEqual([-6, -4, -2, 0, 2, 4, 6, 8]);
    expect(ticks(3, 7, 2)).toEqual([4, 6]);
  });

  it('gives exact decimals', () => {
    expect(ticks(0, 1, 10)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(ticks(0.3, 0.7, 4)).toEqual([0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(ticks(-0.34, 2.4, 6)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(ticks(0, 0.0005, 5).map(String)).toEqual(['0', '0.0001', '0.0002', '0.0003', '0.0004', '0.0005']);
  });

  it('copes with huge and tiny ranges', () => {
    expect(ticks(0, 1e300, 5)).toEqual([0, 2e299, 4e299, 6e299, 8e299, 1e300]);
    expect(ticks(0, 1e-12, 2).length).toBeGreaterThan(1);
    expect(ticks(1e15, 1e15 + 10, 5).length).toBeGreaterThan(1);
    expect(tickValue(tickStep(1, 10), 3)).toBe(0.3);
  });
});

describe('XY chart rendering', () => {
  it('draws the title, axes, grid, a bar series, a line series and a legend', () => {
    const { scene, type, width, height } = draw(CHART);
    expect(type).toBe('xychart');
    expect(supports('xychart-beta\nline [1]')).toBe(true);
    expect([width, height]).toEqual([700, 500]);
    expect(scene.shapes.some((s) => s.kind === 'stroke' && s.paint === 'var(--_a)')).toBe(true);
    expect(axisSegments(scene).length).toBeGreaterThan(0);
    const [barSeries] = items(scene, 'pele-bars');
    expect(barSeries.id).toBe('2024');
    // Each bar is an item of its own, in its series.
    const barShapes = items(scene, 'pele-bar').filter((b) => b.id.startsWith('2024: ')).flatMap((b) => shapesOf(scene, b));
    expect(barShapes.every((s) => s.paint.startsWith(`${SERIES}1`))).toBe(true);
    expect(barShapes.filter(isRect).length).toBe(3);
    const [lineSeries] = items(scene, 'pele-line');
    expect(lineSeries.id).toBe('2025');
    const lineShapes = shapesOf(scene, lineSeries);
    expect(lineShapes.every((s) => s.paint.startsWith(`${SERIES}2`))).toBe(true);
    const path = lineShapes.find((s) => s.kind === 'stroke')!;
    expect(opsOf(path)).toEqual([0, 1, 1]);
    expect(lineShapes.filter(isDot).length).toBe(3);
    for (const text of ['Sales Revenue', 'Month', 'Revenue (in $)', 'jan', 'feb', 'mar', '4000', '7000', '10000', '2024', '2025']) {
      expect(lines(scene)).toContain(text);
    }
    expect(items(scene, 'pele-legend-item').length).toBe(2);
  });

  it('draws lines over bars, and colors each series by its place in the source', () => {
    const { scene } = draw('xychart\n line [1, 2]\n bar [2, 1]\n line [3, 3]\n bar [1, 1]');
    const marks = scene.shapes
      .filter((s) => s.paint.startsWith(SERIES) && (isRect(s) || s.kind === 'stroke'))
      .map((s) => (isRect(s) ? 'bars' : 'line') + /series-(\d)/.exec(s.paint)![1]);
    expect([...new Set(marks)]).toEqual(['bars2', 'bars4', 'line1', 'line3']);
  });

  it('scales bars to the range and sets them side by side', () => {
    const { scene } = draw('xychart\n x-axis [a, b]\n y-axis 0 --> 100\n bar [50, 100]\n bar [25, 75]');
    const rects = bars(scene).map((s) => [s.box.x0, s.box.y0, width(s), height(s)]);
    expect(rects).toHaveLength(4);
    const [a1, b1, a2, b2] = rects;
    expect(b1[3]).toBeCloseTo(a1[3] * 2, 1);
    expect(a2[3]).toBeCloseTo(a1[3] / 2, 1);
    expect(b2[3]).toBeCloseTo(a1[3] * 1.5, 1);
    expect(a1[1] + a1[3]).toBeCloseTo(b2[1] + b2[3], 1);
    expect(a2[0]).toBeGreaterThanOrEqual(a1[0] + a1[2]);
    expect(b1[0]).toBeGreaterThan(a2[0] + a2[2]);
  });

  it('stands bars on zero when the range comes from the data', () => {
    const heights = (src: string): number[] => bars(draw(src).scene).map(height);
    const [low, high] = heights('xychart\n bar [5000, 10000]');
    expect(high).toBeCloseTo(low * 2, 1);
    // Mermaid starts the axis at the smallest value, which leaves that bar with no height.
    expect(low).toBeGreaterThan(100);
    const mixed = bars(draw('xychart\n bar [4, -4]').scene).map((s) => s.box.y0);
    expect(mixed[1]).toBeGreaterThan(mixed[0]);
  });

  it('keeps an explicit range as written and cuts what falls outside it', () => {
    const { scene } = draw('xychart\n x-axis [a, b, c]\n y-axis 10 --> 20\n bar [5, 15, 40]\n line [0, 15, 30]');
    expect(lines(scene)).toContain('10');
    expect(lines(scene)).toContain('20');
    expect(lines(scene)).not.toContain('0');
    expect(lines(scene)).not.toContain('40');
    // The bar below the range has no height left to draw.
    const [inside, over] = bars(scene);
    expect(bars(scene)).toHaveLength(2);
    expect(height(over)).toBeCloseTo(height(inside) * 2, 1);
    const top = over.box.y0;
    const path = scene.shapes.find((s) => s.kind === 'stroke' && s.paint.startsWith(SERIES))!;
    for (let i = 2; i < path.cmds.length; i += 3) expect(path.cmds[i]).toBeGreaterThanOrEqual(Math.floor(top));
    expect(dots(scene)).toHaveLength(1);
  });

  it('spreads values over a numeric x axis', () => {
    const { scene } = draw('xychart\n x-axis "t" 0 --> 10\n line [1, 2, 3]');
    const xs = dots(scene).map(centre);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 1);
    for (const tick of ['0', '5', '10']) expect(lines(scene)).toContain(tick);
    const auto = draw('xychart\n line [5, 6, 7, 8]').scene;
    for (const tick of ['1', '2', '3', '4']) expect(lines(auto)).toContain(tick);
  });

  it('falls back to the data range when written y bounds clamp to the same value', () => {
    const big = (e: number): string => '1' + '0'.repeat(e);
    for (const range of [`${big(301)} --> ${big(302)}`, `-${big(302)} --> -${big(301)}`]) {
      expect(JSON.stringify(draw(`xychart\n x-axis [a, b]\n y-axis ${range}\n bar [3, 4]`).scene), range).not.toContain('NaN');
    }
  });

  it('leaves out values beyond the categories and categories without a value', () => {
    expect(bars(draw('xychart\n x-axis [a, b]\n bar [1, 2, 3, 4]').scene)).toHaveLength(2);
    const short = draw('xychart\n x-axis [a, b, c, d]\n bar [1, 2]\n line [1, 2]').scene;
    expect(bars(short)).toHaveLength(2);
    expect(dots(short)).toHaveLength(2);
    expect(JSON.stringify(short)).not.toContain('NaN');
    const late = draw('xychart\n line [1, 2, 3, 4, 5, 6]\n x-axis [a, b]');
    const xs = dots(late.scene).map(centre);
    expect(xs).toHaveLength(2);
    expect(Math.max(...xs)).toBeLessThan(late.width);
  });

  it('turns the chart on its side for the horizontal orientation', () => {
    const src = 'x-axis [a, b]\n y-axis 0 --> 10\n bar [5, 10]';
    const boxes = (chart: string): number[][] => bars(draw(chart).scene).map((s) => [s.box.x0, s.box.y0, width(s), height(s)]);
    const [a, b] = boxes('xychart\n ' + src);
    expect(b[3]).toBeCloseTo(a[3] * 2, 1);
    expect(b[2]).toBe(a[2]);
    expect(b[0]).toBeGreaterThan(a[0]);
    const [c, d] = boxes('xychart horizontal\n ' + src);
    expect(d[2]).toBeCloseTo(c[2] * 2, 1);
    expect(d[3]).toBe(c[3]);
    expect(d[0]).toBe(c[0]);
    expect(d[1]).toBeGreaterThan(c[1]);
    expect(drawn(configured('    chartOrientation: horizontal', 'xychart\n ' + src))).toBe(drawn('xychart horizontal\n ' + src));
    expect(drawn(configured('    chartOrientation: horizontal', 'xychart vertical\n ' + src))).toBe(drawn('xychart\n ' + src));
  });

  it('labels the points of a line', () => {
    const { scene } = draw('xychart\n x-axis [Q1, Q2, Q3]\n line [25 "Launch", 45, 72 "Target"]\n bar [1 "ignored", 2, 3]');
    // Point labels are the only text set at 12.
    expect(scene.texts.filter((t) => t.size === 12).map((t) => t.spans[0].text)).toEqual(['Launch', 'Target']);
    expect(lines(scene)).not.toContain('ignored');
  });

  it('honours the size and the show settings', () => {
    const plain = draw(CHART).scene;
    const sized = draw(configured('    width: 900\n    height: 400', CHART));
    expect([sized.width, sized.height]).toEqual([900, 400]);
    expect(lines(draw(configured('    showTitle: false', CHART)).scene)).not.toContain('Sales Revenue');
    expect(items(draw(configured('    showLegend: false', CHART)).scene, 'pele-legend-item')).toHaveLength(0);
    const noX = lines(draw(configured('    xAxis:\n      showLabel: false\n      showTitle: false', CHART)).scene);
    expect(noX).not.toContain('jan');
    expect(noX).not.toContain('Month');
    expect(noX).toContain('7000');
    const noY = lines(draw(configured('    yAxis:\n      showLabel: false\n      showTitle: false', CHART)).scene);
    expect(noY).not.toContain('7000');
    expect(noY).not.toContain('Revenue (in $)');
    expect(noY).toContain('jan');
    const marks = (body: string): number[][] => axisSegments(draw(configured(body, CHART)).scene);
    expect(marks('    xAxis:\n      showTick: false').length).toBeLessThan(axisSegments(plain).length);
    expect(marks('    yAxis:\n      showTick: false').length).toBeLessThan(axisSegments(plain).length);
    expect(longer(axisSegments(plain), true)).toBe(1);
    expect(longer(axisSegments(plain), false)).toBe(1);
    expect(longer(marks('    xAxis:\n      showAxisLine: false'), true)).toBe(0);
    expect(longer(marks('    xAxis:\n      showAxisLine: false'), false)).toBe(1);
    expect(longer(marks('    yAxis:\n      showAxisLine: false'), false)).toBe(0);
    expect(longer(marks('    yAxis:\n      showAxisLine: false'), true)).toBe(1);
    const bare = '    xAxis:\n      showTick: false\n      showAxisLine: false\n    yAxis:\n      showTick: false\n      showAxisLine: false';
    expect(marks(bare)).toEqual([]);
    expect(drawn(configured('    width: wide\n    showTitle: 3', CHART))).toBe(drawn(CHART));
  });

  it('writes the value of each bar with showDataLabel', () => {
    const chart = 'xychart\n x-axis [a, b, c]\n y-axis 0 --> 30\n bar [12, 2, 25]\n bar [7, 30, 1]';
    // Data labels are the only text set at 12.
    const labels = (scene: Scene): string[] => scene.texts.filter((t) => t.size === 12).map(lineOf);
    expect(labels(draw(chart).scene)).toEqual([]);
    const { scene } = draw(configured('    showDataLabel: true', chart));
    // Each series shows its own values; Mermaid repeats those of the first series.
    expect(labels(scene).sort()).toEqual(['1', '12', '2', '25', '30', '7']);
    // They are written past the end of the bars in the text color, whichever way Mermaid's setting is.
    expect(scene.texts.filter((t) => t.size === 12).every((t) => t.paint === 'var(--_fg)')).toBe(true);
    // The setting's own line moves where the bars are written.
    const unplaced = (s: Scene) => ({ ...s, items: s.items.map(({ line: _line, ...rest }) => rest) });
    for (const outside of ['true', 'false']) {
      expect(unplaced(draw(configured(`    showDataLabel: true\n    showDataLabelOutsideBar: ${outside}`, chart)).scene)).toEqual(unplaced(scene));
    }
  });

  it('thins out category labels that would run into each other', () => {
    const many = Array.from({ length: 200 }, (_, i) => `category${i}`);
    const { scene } = draw(`xychart\n x-axis [${many.join(', ')}]\n bar [${many.map((_, i) => i).join(', ')}]`);
    const shown = lines(scene).filter((t) => t.startsWith('category'));
    expect(shown.length).toBeGreaterThan(3);
    expect(shown.length).toBeLessThan(15);
    // The first value is 0, which leaves nothing to draw.
    expect(bars(scene)).toHaveLength(199);
  });

  it('refuses a chart with no series, as Mermaid does', () => {
    expect(() => draw('xychart\n title "Empty"')).toThrow('No Plot to render, please provide a plot with some data');
    expect(() => draw('xychart\n line [1, 2')).toThrow(PeleError);
    expect(() => draw('xychart\n x-axis [é]\n line [1]')).toThrow(PeleError);
  });

  it('takes the title from front matter unless the chart sets one', () => {
    expect(lines(draw('---\ntitle: From front matter\n---\nxychart\n line [1, 2]').scene)).toContain('From front matter');
    const own = lines(draw('---\ntitle: From front matter\n---\nxychart\n title Own\n line [1, 2]').scene);
    expect(own).toContain('Own');
    expect(own).not.toContain('From front matter');
  });

  it('exposes the model', () => {
    const model = parse('xychart horizontal\n title "T"\n x-axis "x" [a, b]\n y-axis "y" 0 --> 5\n bar "s" [1, 2, 3]\n line [2 "p", 1]');
    expect(model.type).toBe('xychart');
    if (model.type === 'xychart') {
      expect(model.title).toBe('T');
      expect(model.orientation).toBe('horizontal');
      expect(model.xAxis).toEqual({ type: 'band', title: 'x', categories: ['a', 'b'] });
      expect(model.yAxis).toEqual({ type: 'linear', title: 'y', min: 0, max: 5 });
      expect(model.plots).toEqual([
        { type: 'bar', title: 's', data: [['a', 1], ['b', 2]] },
        { type: 'line', title: '', data: [['a', 2], ['b', 1]], pointLabels: ['p', ''] },
      ]);
    }
  });

  it('keeps the character before a comment', () => {
    const model = parse('xychart-beta\nx-axis [a, b]\nbar [1,2]%% note');
    expect(model.type === 'xychart' && model.plots).toEqual([{ type: 'bar', title: '', data: [['a', 1], ['b', 2]] }]);
    expect(() => parse('xychart-beta\ntitle Sales:%% note\nbar [1,2]')).toThrow(PeleError);
  });

  it('gives the same output for the same input', () => {
    expect(draw(CHART).scene).toEqual(draw(CHART).scene);
  });

  // A bar is a part a host can point at, even one of nothing: it is still where its value is.
  it('makes every bar an item, a bar of nothing too', () => {
    const { scene } = draw('xychart\n  x-axis [a, b, c]\n  bar "Sales" [0, 2, 3]\n  bar [1, 0, 1]');
    const bars = items(scene, 'pele-bar');
    expect(bars.map((b) => b.id)).toEqual(['Sales: a', 'Sales: b', 'Sales: c', 'series 2: a', 'series 2: b', 'series 2: c']);
    const zero = bars[0].box!;
    expect(zero.y0).toBe(zero.y1);
    expect(zero.x1).toBeGreaterThan(zero.x0);
    expect(shapesOf(scene, bars[0])).toEqual([]);
    expect(shapesOf(scene, bars[1])).toHaveLength(1);
  });

});
