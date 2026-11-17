import { PeleError } from '../../errors.js';
import type { Out } from '../../draw/out.js';
import type { Config } from '../../preprocess.js';
import { num } from '../../svg/builder.js';
import { seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { capWidth } from '../common/fit-width.js';
import type { XyChartModel } from './db.js';
import { tickIndex, tickStep, tickValue, ticksBetween } from './ticks.js';

const TICK = 4;
const SWATCH = 12;
const ROW = 26;
const LEGEND_GAP = 24;
const LIMIT = 1e300;

interface Mark {
  at: number;
  label: Label;
}

function record(value: unknown): Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Config) : {};
}

function on(config: Config, key: string, fallback = true): boolean {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function dimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? Math.round(Math.min(Math.max(value, 100), 4000)) : fallback;
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && isFinite(value) ? Math.min(Math.max(value, -LIMIT), LIMIT) : undefined;
}

function widest(marks: Mark[]): number {
  let width = 0;
  for (const mark of marks) width = Math.max(width, mark.label.width);
  return width;
}

// Draws a label with its left edge, center or right edge at x. A plain one-line label keeps
// its place when the text is wider or narrower than measured.
function aligned(out: Out, label: Label, x: number, y: number, anchor: 'start' | 'middle' | 'end'): void {
  const line = label.lines.length === 1 ? label.lines[0] : undefined;
  if (line && line.length === 1 && line[0].icon === undefined && line[0].style === 0) {
    out.text(x, y + label.size * 0.35, line[0].text, '', ` text-anchor="${anchor}"`);
    return;
  }
  out.label(label, x + (anchor === 'start' ? label.width / 2 : anchor === 'end' ? -label.width / 2 : 0), y, '');
}

export function renderXyChart(model: XyChartModel, config: Config, options: RenderOptions, out: Out): Rendered {
  if (model.plots.length === 0) {
    throw new PeleError('No Plot to render, please provide a plot with some data', 'semantic', { type: 'xychart' });
  }
  const chart = record(config.xyChart);
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.75);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const natural = dimension(chart.width, 700);
  const width = capWidth(options, natural, 240);
  // A narrower chart is not as much shorter, so that the plot keeps room for its marks.
  const height = Math.round(dimension(chart.height, 500) * Math.max(0.6, width / natural));
  const horizontal = (model.orientation ?? chart.chartOrientation) === 'horizontal';
  // The value of a bar is always written past its end, which is what showDataLabelOutsideBar asks
  // for in Mermaid. Inside, whether it fits changes from bar to bar and with the width of the chart.
  const showValues = on(chart, 'showDataLabel', false);
  const x = model.xAxis;
  const plots = model.plots;
  const text = (raw: string | undefined, fontSize: number, max: number): Label =>
    layoutLabel(raw, false, measurer, fontSize, max);
  const lineHeight = text('0', small, 4000).height;
  const tinyHeight = text('0', tiny, 4000).height;

  const title = layoutLabel(on(chart, 'showTitle') ? model.title : undefined, false, measurer, size, width - 2 * pad, Style.Bold);
  const titleSpace = title.height > 0 ? title.height + 12 : 0;

  const legend: { index: number; label: Label }[] = [];
  let legendWidth = 0;
  if (on(chart, 'showLegend')) {
    plots.forEach((plot, index) => {
      if (plot.title === '') return;
      const label = text(plot.title, small, width * 0.3);
      legend.push({ index, label });
      legendWidth = Math.max(legendWidth, label.width + SWATCH + 8);
    });
  }
  const legendSpace = legend.length > 0 ? legendWidth + LEGEND_GAP : 0;

  // The value range: as written, or taken from the data, where bars stand on zero and the
  // range grows to whole steps.
  const bars = plots.filter((plot) => plot.type === 'bar').length;
  let lo = finite(model.yAxis.min) ?? Infinity;
  let hi = finite(model.yAxis.max) ?? -Infinity;
  const exact = model.hasSetYAxis && isFinite(lo) && isFinite(hi) && lo !== hi;
  if (!exact) {
    lo = Infinity;
    hi = -Infinity;
    for (const plot of plots) {
      for (const [, raw] of plot.data) {
        const value = finite(raw);
        if (value === undefined) continue;
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    if (lo > hi) lo = hi = 0;
    if (bars > 0) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    if (lo === hi) {
      if (lo === 0) hi = 1;
      else {
        lo -= Math.abs(lo) / 2;
        hi += Math.abs(hi) / 2;
      }
    }
  }

  const valueMarks = (length: number, spacing: number): Mark[] => {
    const step = tickStep(Math.abs(hi - lo), Math.max(2, Math.min(10, Math.floor(length / spacing))));
    if (!exact) {
      lo = tickValue(step, Math.floor(tickIndex(step, lo) + 1e-9));
      hi = tickValue(step, Math.ceil(tickIndex(step, hi) - 1e-9));
    }
    return ticksBetween(Math.min(lo, hi), Math.max(lo, hi), step).map((value) => ({
      at: (value - lo) / (hi - lo),
      label: text(String(value), small, 4000),
    }));
  };

  // Places along the category axis are fractions of its length. Categories and bars sit in the
  // middle of equal slots; the points of a line on a numeric axis run from end to end.
  let count = 1;
  if (x.type === 'band') count = Math.max(x.categories.length, 1);
  else for (const plot of plots) count = Math.max(count, plot.data.length);
  const slot = 1 / count;
  const inset = x.type === 'band' || bars > 0 ? slot / 2 : 0;
  const x0 = finite(x.type === 'linear' ? x.min : undefined);
  const x1 = finite(x.type === 'linear' ? x.max : undefined);
  const ranged = x0 !== undefined && x1 !== undefined && x0 !== x1;
  const place = (i: number, n: number): number =>
    x.type === 'band' ? (i + 0.5) * slot : inset + (n > 1 ? i / (n - 1) : ranged ? 0 : 0.5) * (1 - 2 * inset);

  const categoryConf = record(chart.xAxis);
  const valueConf = record(chart.yAxis);
  const leftConf = horizontal ? categoryConf : valueConf;
  const bottomConf = horizontal ? valueConf : categoryConf;
  const leftTitle = text(on(leftConf, 'showTitle') ? (horizontal ? x.title : model.yAxis.title) : undefined, small, height * 0.8);
  const bottomTitle = text(on(bottomConf, 'showTitle') ? (horizontal ? model.yAxis.title : x.title) : undefined, small, width * 0.8);
  const leftTick = on(leftConf, 'showTick') ? TICK : 0;
  const bottomTick = on(bottomConf, 'showTick') ? TICK : 0;
  const leftLabels = on(leftConf, 'showLabel');
  const bottomLabels = on(bottomConf, 'showLabel');

  const wrapAt = horizontal ? width * 0.3 : Math.max(48, (width - 2 * pad - 64 - legendSpace) * slot - 8);
  const categories =
    x.type === 'band' && on(categoryConf, 'showLabel') ? x.categories.map((category) => text(category, small, wrapAt)) : [];
  let categoryWidth = 0;
  let categoryHeight = 0;
  for (const label of categories) {
    categoryWidth = Math.max(categoryWidth, label.width);
    categoryHeight = Math.max(categoryHeight, label.height);
  }

  // The labelled places of the category axis. Labels that would run into each other are thinned out.
  const categoryMarks = (length: number): Mark[] => {
    const marks: Mark[] = [];
    if (x.type === 'band') {
      const need = categories.length === 0 ? 8 : horizontal ? categoryHeight : categoryWidth + 12;
      const every = Math.max(1, Math.ceil(need / (length * slot)));
      for (let i = 0; i < x.categories.length; i += every) {
        marks.push({ at: (i + 0.5) * slot, label: categories[i] ?? text(undefined, small, 0) });
      }
    } else if (ranged) {
      const step = tickStep(Math.abs(x1 - x0), Math.max(2, Math.min(10, Math.floor(length / (horizontal ? 32 : 80)))));
      for (const value of ticksBetween(Math.min(x0, x1), Math.max(x0, x1), step)) {
        marks.push({ at: inset + ((value - x0) / (x1 - x0)) * (1 - 2 * inset), label: text(String(value), small, 4000) });
      }
    } else if (x0 !== undefined) {
      marks.push({ at: 0.5, label: text(String(x0), small, 4000) });
    }
    return marks;
  };

  // Room past the end of the value axis for what is written beside a point or a bar.
  let pointLabelWidth = 0;
  let valueWidth = 0;
  for (const plot of plots) {
    for (const label of plot.pointLabels ?? []) pointLabelWidth = Math.max(pointLabelWidth, measurer.width(label, tiny, 0));
    if (showValues && horizontal && plot.type === 'bar') {
      for (const [, value] of plot.data) valueWidth = Math.max(valueWidth, measurer.width(String(finite(value) ?? ''), tiny, 0));
    }
  }

  const bottomLabelHeight = !bottomLabels ? 0 : horizontal || x.type !== 'band' ? lineHeight : categoryHeight;
  const bottomSpace =
    bottomTick + (bottomLabelHeight > 0 ? bottomLabelHeight + 4 : 0) + (bottomTitle.height > 0 ? bottomTitle.height + 4 : 0);
  const headroom = horizontal ? 0 : pointLabelWidth > 0 || showValues ? tinyHeight + 4 : leftLabels ? lineHeight / 2 : 0;
  const top = pad + titleSpace + headroom;
  const plotHeight = Math.max(1, height - pad - bottomSpace - top);
  const bottom = top + plotHeight;

  const leftMarks = horizontal ? categoryMarks(plotHeight) : valueMarks(plotHeight, 56);
  const leftLabelWidth = leftLabels ? widest(leftMarks) : 0;
  const left =
    pad + (leftTitle.height > 0 ? leftTitle.height + 6 : 0) + (leftLabelWidth > 0 ? leftLabelWidth + 6 : 0) + leftTick;
  const beside = Math.max(pointLabelWidth > 0 ? pointLabelWidth + 12 : 0, valueWidth > 0 ? valueWidth + 8 : 0);
  const reach = horizontal ? Math.min(width * 0.25, beside) : 0;
  let plotWidth = Math.max(1, width - pad - left - legendSpace - reach);
  const bottomMarks = horizontal ? valueMarks(plotWidth, 80) : categoryMarks(plotWidth);
  if (bottomLabels && legendSpace + reach === 0) {
    let over = 0;
    for (const mark of bottomMarks) over = Math.max(over, mark.at * plotWidth + mark.label.width / 2 - plotWidth);
    plotWidth = Math.max(1, plotWidth - over);
  }
  const right = left + plotWidth;

  const px = (c: number, v: number): number => (horizontal ? left + v * plotWidth : left + c * plotWidth);
  const py = (c: number, v: number): number => (horizontal ? top + c * plotHeight : bottom - v * plotHeight);
  const scale = (value: number): number => (value - lo) / (hi - lo);
  const clamp = (v: number): number => Math.min(Math.max(v, 0), 1);

  // A line across the plot at a place on the value axis.
  const rule = (v: number): string =>
    horizontal ? `M${num(px(0, v))},${num(top)}V${num(bottom)}` : `M${num(left)},${num(py(0, v))}H${num(right)}`;

  out.label(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  // Layers are painted in the order they are made; empty ones are left out.
  out.section('grid');
  out.section('plot', ' class="pele-plot"', true);
  out.section('axis');
  out.section('labels', ` class="pele-axis-labels" font-size="${small}" fill="var(--_m)"`);
  out.section('titles', ` class="pele-axis-titles" font-size="${small}"`);
  out.section('data-labels', ` class="pele-data-labels" font-size="${tiny}"`);
  out.section('point-labels', ` class="pele-point-labels" font-size="${tiny}"`);
  out.section('legend', ` class="pele-legend" font-size="${small}"`);

  const gridMarks = horizontal ? bottomMarks : leftMarks;
  if (gridMarks.length > 0) {
    const grid = out.pen();
    for (const mark of gridMarks) {
      if (horizontal) grid.M(px(0, mark.at), top).V(bottom);
      else grid.M(left, py(0, mark.at)).H(right);
    }
    out.section('grid');
    out.path(grid, ' stroke="var(--_a)"', undefined, { cls: 'pele-grid' });
  }

  let axis = '';
  out.section('labels');
  if (on(leftConf, 'showAxisLine')) axis += `M${num(left)},${num(top)}V${num(bottom)}`;
  if (on(bottomConf, 'showAxisLine')) axis += `M${num(left)},${num(bottom)}H${num(right)}`;
  for (const mark of leftMarks) {
    const y = horizontal ? top + mark.at * plotHeight : bottom - mark.at * plotHeight;
    if (leftTick) axis += `M${num(left)},${num(y)}h${-leftTick}`;
    if (leftLabels) aligned(out, mark.label, left - leftTick - 6, y, 'end');
  }
  for (const mark of bottomMarks) {
    const at = left + mark.at * plotWidth;
    if (bottomTick) axis += `M${num(at)},${num(bottom)}v${bottomTick}`;
    if (bottomLabels) aligned(out, mark.label, at, bottom + bottomTick + 4 + mark.label.height / 2, 'middle');
  }

  const span = (horizontal ? plotHeight : plotWidth) * slot;
  const group = span * 0.7;
  const thickness = group / Math.max(bars, 1);
  const gap = bars > 1 ? Math.min(2, thickness * 0.2) : 0;
  const base = clamp(scale(0));
  // Bars that go both ways get a line to stand on.
  if (bars > 0 && base > 0 && base < 1) axis += rule(base);
  // Lines are drawn over the bars wherever they were declared, as a bar would hide part of one
  // under it. A series keeps the color of its place in the source.
  const dataLabels: { x: number; y: number; text: string; anchor: string }[] = [];
  const pointLabels: (() => void)[] = [];
  const lines: (() => void)[] = [];
  let bar = 0;
  out.section('plot');
  plots.forEach((plot, index) => {
    const color = seriesColor(index);
    const own = plot.title ? { id: plot.title, source: plot.source } : {};
    // A series declared before the categories can hold more values than there are categories.
    const n = x.type === 'band' ? Math.min(plot.data.length, count) : plot.data.length;
    if (plot.type === 'bar') {
      const offset = (bar++ - (bars - 1) / 2) * thickness - (thickness - gap) / 2;
      out.group({ cls: 'pele-series pele-bars', ...own, attrs: ` fill="${color}"` });
      for (let i = 0; i < n; i++) {
        const value = finite(plot.data[i][1]);
        if (value === undefined) continue;
        const c = place(i, n);
        const v = clamp(scale(value));
        const from = Math.min(base, v);
        const to = Math.max(base, v);
        const bx = horizontal ? px(c, from) : px(c, 0) + offset;
        const by = horizontal ? py(c, 0) + offset : py(c, to);
        const bw = horizontal ? (to - from) * plotWidth : thickness - gap;
        const bh = horizontal ? thickness - gap : (to - from) * plotHeight;
        const category = x.type === 'band' ? x.categories[i] : String(plot.data[i][0]);
        out.rect(bx, by, bw, bh, '', { cls: 'pele-bar', id: `${plot.title || `series ${index + 1}`}: ${category}`, source: plot.source });
        if (!showValues) continue;
        const label = String(value);
        const w = measurer.width(label, tiny, 0);
        // Towards the end of the bar: 1 when it runs up or right from the baseline, -1 the other way.
        const dir = v >= base ? 1 : -1;
        let tx = bx + bw / 2;
        let ty = by + bh / 2;
        let anchor = 'middle';
        if (horizontal) {
          if (bh < tiny) continue;
          tx = (dir > 0 ? bx + bw : bx) + dir * 6;
          anchor = dir > 0 ? 'start' : 'end';
        } else {
          if (w + 2 > span / bars) continue;
          ty = (dir > 0 ? by : by + bh) - dir * (tinyHeight / 2 + 2);
        }
        dataLabels.push({ x: tx, y: ty + tiny * 0.35, text: label, anchor });
      }
      out.end();
      return;
    }

    // A line is cut where it leaves the value range, so it stays inside the plot.
    const d = out.pen();
    let drawn = false;
    const dots: [number, number][] = [];
    let pen = false;
    let pc = 0;
    let pv = NaN;
    for (let i = 0; i < n; i++) {
      const value = finite(plot.data[i][1]);
      if (value === undefined) {
        pv = NaN;
        continue;
      }
      const c = place(i, n);
      const v = scale(value);
      const visible = v >= 0 && v <= 1;
      if (pv !== pv) {
        if (visible) {
          d.M(px(c, v), py(c, v));
          drawn = true;
        }
        pen = visible;
      } else {
        const dv = v - pv;
        let t0 = 0;
        let t1 = 1;
        if (dv !== 0) {
          const a = -pv / dv;
          const b = (1 - pv) / dv;
          t0 = Math.max(t0, Math.min(a, b));
          t1 = Math.min(t1, Math.max(a, b));
        } else if (!visible) {
          t0 = 2;
        }
        if (t0 <= t1) {
          const c0 = pc + (c - pc) * t0;
          const v0 = pv + dv * t0;
          const c1 = pc + (c - pc) * t1;
          const v1 = pv + dv * t1;
          if (!pen || t0 > 0) d.M(px(c0, v0), py(c0, v0));
          d.L(px(c1, v1), py(c1, v1));
          drawn = true;
        }
        pen = visible;
      }
      pc = c;
      pv = v;
      if (!visible) continue;
      const cx = px(c, v);
      const cy = py(c, v);
      if (span >= 12) dots.push([cx, cy]);
      const label = text(plot.pointLabels?.[i], tiny, 4000);
      if (label.height > 0) {
        const half = label.width / 2;
        pointLabels.push(() =>
          horizontal
            ? aligned(out, label, cx + 10, cy, 'start')
            : aligned(out, label, Math.max(Math.min(cx, right - half), left + half), cy - 6 - label.height / 2, 'middle')
        );
      }
    }
    lines.push(() => {
      out.group({ cls: 'pele-series pele-line', ...own, attrs: ` fill="${color}"` });
      if (drawn) out.path(d, ` fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`);
      for (const [cx, cy] of dots) out.circle(cx, cy, 3, '');
      out.end();
    });
  });
  for (const draw of lines) draw();

  if (axis) {
    out.section('axis');
    out.path(axis, ' fill="none" stroke="var(--_b)"', undefined, { cls: 'pele-axis' });
  }
  out.section('titles');
  if (leftTitle.height > 0) {
    const turn = ` transform="translate(${num(pad + leftTitle.height / 2)},${num(top + plotHeight / 2)}) rotate(-90)"`;
    out.group({ attrs: turn });
    out.label(leftTitle, 0, 0, '');
    out.end();
  }
  out.label(bottomTitle, left + plotWidth / 2, height - pad - bottomTitle.height / 2, '');

  out.section('data-labels');
  for (const l of dataLabels) out.text(l.x, l.y, l.text, '', ` text-anchor="${l.anchor}"`);
  out.section('point-labels');
  for (const draw of pointLabels) draw();

  out.section('legend');
  let legendHeight = 0;
  for (const item of legend) legendHeight += Math.max(ROW, item.label.height + 6);
  let ly = top + Math.max(0, (plotHeight - legendHeight) / 2);
  const lx = right + reach + LEGEND_GAP;
  for (const { index, label } of legend) {
    const row = Math.max(ROW, label.height + 6);
    if (ly + row > height) break;
    const y = ly + row / 2;
    const color = seriesColor(index);
    out.group({ cls: 'pele-legend-item', id: plots[index].title, source: plots[index].source });
    if (plots[index].type === 'bar') out.rect(lx, y - SWATCH / 2, SWATCH, SWATCH, ` rx="2" fill="${color}"`);
    else out.path(out.pen().M(lx, y).h(SWATCH), ` stroke="${color}" stroke-width="2" stroke-linecap="round"`);
    out.label(label, lx + SWATCH + 8 + label.width / 2, y, '');
    out.end();
    ly += row;
  }

  out.done(width, height);
  return { width, height, links: [] };
}
