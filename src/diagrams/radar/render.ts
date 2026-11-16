import type { Config } from '../../preprocess.js';
import type { Out, Pen } from '../../draw/out.js';
import { escText, num, sourceAttrsFor } from '../../svg/builder.js';
import { seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { fitWidth, titleRoom } from '../common/fit-width.js';
import type { RadarModel } from './model.js';

const SWATCH = 12;
const ROW = 26;
const GAP = 24;

interface Point {
  x: number;
  y: number;
}

function option(config: Config, key: string, fallback: number, min: number, max: number): number {
  const value = (config.radar as Config | undefined)?.[key];
  return typeof value === 'number' && value >= min ? Math.min(value, max) : fallback;
}

export function relativeRadius(value: number, min: number, max: number, radius: number): number {
  const clipped = Math.min(Math.max(value, min), max);
  const scaled = radius * (clipped - min);
  // Keep the original rounding unless multiplication overflows.
  return Number.isFinite(scaled) ? scaled / (max - min) : radius * ((clipped - min) / (max - min));
}

// A closed Catmull-Rom spline through the points, as cubic Bézier segments.
export function closedRoundCurve(points: Point[], tension: number): string {
  const n = points.length;
  let d = `M${num(points[0].x)},${num(points[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    d +=
      ` C${num(p1.x + (p2.x - p0.x) * tension)},${num(p1.y + (p2.y - p0.y) * tension)}` +
      ` ${num(p2.x - (p3.x - p1.x) * tension)},${num(p2.y - (p3.y - p1.y) * tension)} ${num(p2.x)},${num(p2.y)}`;
  }
  return d + ' Z';
}

// The same curve as closedRoundCurve, as numbers for a scene.
function roundCurvePen(pen: Pen, points: Point[], tension: number): Pen {
  const n = points.length;
  pen.M(points[0].x, points[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    pen.C(p1.x + (p2.x - p0.x) * tension, p1.y + (p2.y - p0.y) * tension, p2.x - (p3.x - p1.x) * tension, p2.y - (p3.y - p1.y) * tension, p2.x, p2.y);
  }
  return pen.Z();
}

function flat(points: Point[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y);
  return out;
}

function polygonText(points: Point[]): string {
  let out = '';
  for (const p of points) out += (out ? ' ' : '') + num(p.x) + ',' + num(p.y);
  return out;
}

export function renderRadar(model: RadarModel, config: Config, options: RenderOptions, out: Out): Rendered {
  const natural = option(config, 'width', 320, 1, 4000);
  return fitWidth(options, natural, 160, (width, tight, o) => draw(o, model, config, options, width, (option(config, 'height', 320, 1, 4000) * width) / natural, tight), out);
}

// `tight` is set when the chart does not fit the width it has with its legend beside it.
function draw(out: Out, model: RadarModel, config: Config, options: RenderOptions, width: number, height: number, tight: boolean): Rendered {
  const srcAttrs = sourceAttrsFor({ sourceInfo: out.sources });
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  const axisScale = option(config, 'axisScaleFactor', 1, 0, 10);
  const labelFactor = option(config, 'axisLabelFactor', 1.05, 0, 10);
  const tension = option(config, 'curveTension', 0.17, 0, 1);
  const radius = Math.min(width, height) / 2;

  const { axes, curves } = model;
  const { ticks, graticule, min } = model.options;
  const count = axes.length;
  const unit: Point[] = axes.map((_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });

  let max = model.options.max;
  if (max === null) {
    max = -Infinity;
    for (const curve of curves) for (const value of curve.entries) if (value > max) max = value;
  }

  // The chart is drawn around the origin. Margins reserve space; labels and the legend widen it.
  let x0 = -width / 2 - option(config, 'marginLeft', 16, 0, 2000);
  let x1 = width / 2 + option(config, 'marginRight', 16, 0, 2000);
  let y0 = -height / 2 - option(config, 'marginTop', 16, 0, 2000);
  let y1 = height / 2 + option(config, 'marginBottom', 16, 0, 2000);

  const spokes = out.pen();
  const labels: { label: Label; cx: number; cy: number; i: number }[] = [];
  unit.forEach((u, i) => {
    const reach = radius * axisScale;
    spokes.M(0, 0).L(u.x * reach, u.y * reach);
    const label = layoutLabel(axes[i].label, false, measurer, small, 4000);
    const at = radius * labelFactor + 6;
    // Each label hangs off its axis on the side away from the center.
    const cx = u.x * at + (u.x > 0.01 ? label.width / 2 : u.x < -0.01 ? -label.width / 2 : 0);
    const cy = u.y * at + (u.y > 0.01 ? label.height / 2 : u.y < -0.01 ? -label.height / 2 : 0);
    labels.push({ label, cx, cy, i });
    x0 = Math.min(x0, cx - label.width / 2);
    x1 = Math.max(x1, cx + label.width / 2);
    y0 = Math.min(y0, cy - label.height / 2);
    y1 = Math.max(y1, cy + label.height / 2);
  });

  const shapes: { index: number; points: Point[] }[] = [];
  curves.forEach((curve, index) => {
    // Mermaid leaves out a curve that does not have a value for every axis.
    if (curve.entries.length !== count) return;
    const points = curve.entries.map((value, i) => {
      const r = relativeRadius(value, min, max, radius);
      const safe = Number.isFinite(r) ? r : 0;
      return { x: unit[i].x * safe, y: unit[i].y * safe };
    });
    shapes.push({ index, points });
  });

  const legend: Label[] = model.options.showLegend
    ? curves.map((curve) => layoutLabel(curve.label, false, measurer, small, 4000))
    : [];
  let legendWidth = 0;
  for (const label of legend) legendWidth = Math.max(legendWidth, label.width);
  const legendHeight = legend.length * ROW;
  const legendX = tight ? -(SWATCH + 8 + legendWidth) / 2 : x1 + GAP;
  const legendTop = tight ? y1 + GAP / 2 : -legendHeight / 2;
  if (legend.length > 0 && tight) {
    x0 = Math.min(x0, legendX);
    x1 = Math.max(x1, -legendX);
    y1 = legendTop + legendHeight;
  } else if (legend.length > 0) {
    x1 = legendX + SWATCH + 8 + legendWidth;
    y0 = Math.min(y0, -legendHeight / 2);
    y1 = Math.max(y1, legendHeight / 2);
  }
  const title = layoutLabel(model.title, false, measurer, size, titleRoom(options), Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 8 : 0;
  const bodyWidth = Math.max(x1 - x0, title.width);
  const totalWidth = Math.ceil(bodyWidth + 2 * pad);
  const totalHeight = Math.ceil(y1 - y0 + titleHeight + 2 * pad);

  out.label(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  out.shift(pad + (bodyWidth - (x1 - x0)) / 2 - x0, pad + titleHeight - y0);
  if (ticks > 0) {
    out.group({ cls: 'pele-graticule', attrs: ' fill="none" stroke="var(--_a)"' });
    for (let i = 0; i < ticks; i++) {
      const r = Math.min(radius, (radius * (i + 1)) / ticks);
      if (graticule === 'circle') out.circle(null, null, r, '');
      else out.polygon(flat(unit.map((u) => ({ x: u.x * r, y: u.y * r }))), '');
    }
    out.end();
  }
  if (count > 0) out.path(spokes, ' fill="none" stroke="var(--_b)"', undefined, { cls: 'pele-axes' });
  if (shapes.length > 0) {
    out.group({ cls: 'pele-curves', attrs: ' fill-opacity="0.2" stroke-width="1.5" stroke-linejoin="round"' });
    for (const { index, points } of shapes) {
      const curve = curves[index];
      const color = seriesColor(index);
      const attrs = ` class="pele-curve" data-id="${escText(curve.name)}"${srcAttrs(curve.source)} fill="${color}" stroke="${color}"`;
      // The SVG puts the fill before the geometry, which the typed shapes do not.
      const item = { cls: 'pele-curve', id: curve.name, source: curve.source };
      const paint = ` fill="${color}" stroke="${color}"`;
      out.both(
        () =>
          graticule === 'circle'
            ? `<path${attrs} d="${closedRoundCurve(points, tension)}"/>`
            : `<polygon${attrs} points="${polygonText(points)}"/>`,
        () => {
          if (graticule === 'circle') out.path(roundCurvePen(out.pen(), points, tension), paint, undefined, item);
          else out.polygon(flat(points), paint, item);
        }
      );
    }
    out.end();
  }
  if (labels.length > 0) {
    out.group({ cls: 'pele-axis-labels', attrs: ` font-size="${small}"` });
    for (const { label, cx, cy, i } of labels) {
      out.group({ cls: 'pele-axis-label', id: axes[i].name, source: axes[i].source });
      out.label(label, cx, cy, '');
      out.end();
    }
    out.end();
  }
  if (legend.length > 0) {
    out.group({ cls: 'pele-legend', attrs: ` font-size="${small}"` });
    legend.forEach((label, index) => {
      const y = legendTop + index * ROW + ROW / 2;
      const color = seriesColor(index);
      out.group({ cls: 'pele-legend-item', id: curves[index].name, source: curves[index].source });
      out.rect(legendX, y - SWATCH / 2, SWATCH, SWATCH, ` rx="2" fill="${color}" fill-opacity="0.4" stroke="${color}"`);
      out.label(label, legendX + SWATCH + 8 + label.width / 2, y, '');
      out.end();
    });
    out.end();
  }
  out.end();

  return { svg: out.done('radar', totalWidth, totalHeight, size, options, model), width: totalWidth, height: totalHeight, links: [] };
}
