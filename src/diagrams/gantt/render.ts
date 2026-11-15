import type { Config } from '../../preprocess.js';
import type { Out } from '../../draw/out.js';
import { esc, escText, labelSvg, num, sourceAttrsFor } from '../../svg/builder.js';
import { CRITICAL, ROUNDED, resolveStyle } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { LinkInfo, RenderOptions, Rendered, SourceInfo } from '../../types.js';
import { capWidth } from '../common/fit-width.js';
import { linkUrl, relAttr } from '../../util/url.js';
import { autoTicks, intervalTicks, timeFormat } from './axis.js';
import { add, addDays } from './dates.js';
import { clock, type GanttDb } from './db.js';
import type { GanttTask } from './types.js';

const WIDTH = 800;
const MIN_PLOT = 240;
const LABEL_GAP = 8;
const RE_BREAK = /<br\s*\/?>/gi;

function setting(config: Config, key: string, min: number, max: number): number | undefined {
  const value = (config.gantt as Config | undefined)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
}

function text(config: Config, key: string): string | undefined {
  const value = (config.gantt as Config | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function flag(config: Config, key: string): boolean {
  return (config.gantt as Config | undefined)?.[key] === true;
}

// A task label sits on one row, so only its first line is kept.
function oneLine(raw: string, measurer: TextMeasurer, size: number): Label {
  const label = layoutLabel(raw.replace(RE_BREAK, ' '), false, measurer, size, 4000);
  if (label.lines.length <= 1) return label;
  return { ...label, lines: [label.lines[0]], widths: [label.widths[0]], width: label.widths[0], height: label.lineHeight };
}

// Whether scheduling gave the task a start and an end. One that waits on a task that never resolves has neither.
function scheduled(task: GanttTask): boolean {
  return Number.isFinite(+task.startTime!) && Number.isFinite(+task.endTime!);
}

// Mermaid's compact mode: within a section, a task goes on the first row that is free when it starts.
function packRows(tasks: GanttTask[], offset: number, rowOf: Map<GanttTask, number>): number {
  const sorted = tasks.filter(scheduled).sort((a, b) => +a.startTime! - +b.startTime! || a.order - b.order);
  const free: number[] = [];
  for (const task of sorted) {
    const start = +task.startTime!;
    let row = 0;
    while (row < free.length && start < free[row]) row++;
    free[row] = +task.endTime!;
    rowOf.set(task, offset + row);
  }
  let rows = free.length;
  for (const task of tasks) if (!rowOf.has(task)) rowOf.set(task, offset + rows++);
  return Math.max(rows, 1);
}

interface Bar {
  task: GanttTask;
  label: Label;
  row: number;
  x0: number;
  x1: number;
  labelX: number;
  inside: boolean;
}

export function renderGantt(model: GanttDb, config: Config, options: RenderOptions, out: Out): Rendered {
  const srcAttrs = sourceAttrsFor({ sourceInfo: out.sources });
  const size = options.fontSize ?? 16;
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const now = clock(options.now);

  const labelSize = setting(config, 'fontSize', 4, 72) ?? Math.round(size * 0.8125);
  const sectionSize = setting(config, 'sectionFontSize', 4, 72) ?? labelSize;
  const tickSize = Math.round(size * 0.75);
  const barHeight = setting(config, 'barHeight', 4, 400) ?? Math.round(labelSize * 1.85);
  const barGap = setting(config, 'barGap', 0, 400) ?? Math.round(barHeight / 4);
  const rowHeight = barHeight + barGap;
  const sectionStyles = Math.round(setting(config, 'numberSectionStyles', 1, 1000) ?? 4);
  const compact = model.displayMode === 'compact';
  const topAxis = model.topAxis || flag(config, 'topAxis');

  const tasks = model.getTasks(now);
  const rowTasks = tasks.filter((task) => !task.vert);
  const verts = tasks.filter((task) => task.vert && scheduled(task));

  const categories = new Map<string, number>();
  for (const task of rowTasks) if (!categories.has(task.section)) categories.set(task.section, categories.size);

  const rowOf = new Map<GanttTask, number>();
  const rowSection: string[] = [];
  // The section statement of each row's first task. A run of rows is labelled by its first row's.
  const rowSource: (SourceInfo | undefined)[] = [];
  if (compact) {
    const groups = new Map<string, GanttTask[]>();
    for (const task of rowTasks) {
      const group = groups.get(task.section);
      if (group) group.push(task);
      else groups.set(task.section, [task]);
    }
    for (const [section, group] of groups) {
      const rows = packRows(group, rowSection.length, rowOf);
      for (let i = 0; i < rows; i++) {
        rowSection.push(section);
        rowSource.push(group[0].sectionSource);
      }
    }
  } else {
    for (const task of rowTasks) {
      rowOf.set(task, rowSection.length);
      rowSection.push(task.section);
      rowSource.push(task.sectionSource);
    }
  }
  const rowCount = rowSection.length;

  let start = Infinity;
  let stop = -Infinity;
  for (const task of tasks) {
    if (!scheduled(task)) continue;
    start = Math.min(start, +task.startTime!);
    stop = Math.max(stop, +task.endTime!);
  }
  const hasPlot = start <= stop;

  const title = layoutLabel(model.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 16 : 0;

  if (!hasPlot) {
    const width = Math.ceil(Math.max(title.width, 1) + 2 * pad);
    const height = Math.ceil(Math.max(title.height, 1) + 2 * pad);
    out.label(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
    return { svg: out.done('gantt', width, height, size, options, model), width, height, links: [] };
  }

  const sectionLabels = new Map<string, Label>();
  let sectionWidth = 0;
  for (const section of categories.keys()) {
    const label = layoutLabel(section, false, measurer, sectionSize, 180);
    sectionLabels.set(section, label);
    sectionWidth = Math.max(sectionWidth, label.width);
  }

  const axisFormat =
    model.axisFormat || (model.dateFormat === 'D' ? '%d' : (text(config, 'axisFormat') ?? '%Y-%m-%d'));
  const tickLabel = (t: number): string => timeFormat(axisFormat, new Date(t));
  const sampleWidth = Math.max(measurer.width(tickLabel(start), tickSize, 0), measurer.width(tickLabel(stop), tickSize, 0));

  const left = pad + (setting(config, 'leftPadding', 0, 2000) ?? Math.max(sectionWidth > 0 ? sectionWidth + 24 : 0, sampleWidth / 2));
  const rightPadding = setting(config, 'rightPadding', 0, 2000) ?? Math.max(16, sampleWidth / 2);
  const target = capWidth(options, setting(config, 'useWidth', 100, 20000) ?? WIDTH, 280);
  const plotWidth = Math.max(MIN_PLOT, target - left - rightPadding - pad);
  const right = left + plotWidth;
  const scale = stop > start ? plotWidth / (stop - start) : 0;
  const x = (t: number): number => (scale === 0 ? left + plotWidth / 2 : left + (t - start) * scale);

  const tickHeight = Math.round(tickSize * 1.75);
  const topPadding = setting(config, 'topPadding', 0, 2000);
  const gridStart = setting(config, 'gridLineStartPadding', 0, 2000);
  const headHeight = pad + titleHeight + (topAxis ? tickHeight : 0);
  const plotTop = Math.max(headHeight, topPadding ?? 0);
  // Mermaid starts its grid lines above the first row by the difference between these two settings.
  // Here that only uses room a larger `topPadding` leaves free.
  const gridLead =
    topPadding !== undefined && gridStart !== undefined
      ? Math.max(0, Math.min(topPadding - gridStart, plotTop - headHeight))
      : 0;
  const plotHeight = Math.max(rowCount, 1) * rowHeight;
  const plotBottom = plotTop + plotHeight;

  // Bars and where their labels go: inside when they fit, otherwise beside the bar on the side with room.
  const bars: Bar[] = [];
  let extent = right + rightPadding;
  for (const task of rowTasks) {
    const label = oneLine(task.task, measurer, labelSize);
    const row = rowOf.get(task)!;
    if (!scheduled(task)) {
      const labelX = left + LABEL_GAP + label.width / 2;
      extent = Math.max(extent, labelX + label.width / 2);
      bars.push({ task, label, row, x0: NaN, x1: NaN, labelX, inside: false });
      continue;
    }
    let x0 = x(+task.startTime!);
    let x1 = Math.max(x(+(task.renderEndTime ?? task.endTime!)), x0 + (task.milestone ? 0 : 2));
    if (task.milestone) {
      const mid = x0 + (x(+task.endTime!) - x0) / 2;
      x0 = mid - barHeight / 2;
      x1 = mid + barHeight / 2;
    }
    const inside = !task.milestone && label.width + 2 * LABEL_GAP <= x1 - x0;
    let labelX = (x0 + x1) / 2;
    if (!inside) {
      const fitsRight = x1 + LABEL_GAP + label.width <= right + rightPadding;
      const fitsLeft = x0 - LABEL_GAP - label.width >= left;
      labelX = fitsRight || !fitsLeft ? x1 + LABEL_GAP + label.width / 2 : x0 - LABEL_GAP - label.width / 2;
      extent = Math.max(extent, labelX + label.width / 2);
    }
    bars.push({ task, label, row, x0, x1, labelX, inside });
  }

  const interval = model.tickInterval || text(config, 'tickInterval') || '';
  const weekday = model.weekday ?? text(config, 'weekday') ?? 'sunday';
  const count = Math.max(2, Math.min(10, Math.floor(plotWidth / (sampleWidth + 24))));
  const ticks = intervalTicks(interval, weekday, start, stop, Math.ceil(plotWidth / 3)) ?? autoTicks(start, stop, count);

  const grid = out.pen();
  const axisBottom: [number, number, string][] = [];
  const axisTop: [number, number, string][] = [];
  let lastRight = -Infinity;
  let lastLabel = '';
  const bottomY = plotBottom + tickHeight / 2 + 2;
  const topY = plotTop - gridLead - tickHeight / 2 - 2;
  for (const t of ticks) {
    const tx = x(t);
    grid.M(tx, plotTop - gridLead).V(plotBottom);
    const label = tickLabel(t);
    const width = measurer.width(label, tickSize, 0);
    // A label is skipped when it would run into the one before it or only repeat it; its grid line stays.
    if (tx - width / 2 < lastRight + 8 || label === lastLabel) continue;
    lastRight = tx + width / 2;
    lastLabel = label;
    extent = Math.max(extent, lastRight);
    axisBottom.push([tx, bottomY + tickSize * 0.35, label]);
    if (topAxis) axisTop.push([tx, topY + tickSize * 0.35, label]);
  }

  // Vertical markers take no row. Their labels go under the axis, on as many lines as it takes to keep them apart.
  const verticals: [GanttTask, Label, number, number, number][] = [];
  const vertEnds: number[] = [];
  const vertTop = plotBottom + tickHeight + 4;
  const vertLine = Math.round(labelSize * 1.5);
  for (const task of [...verts].sort((a, b) => +a.startTime! - +b.startTime!)) {
    const vx = x(+task.startTime!);
    const label = oneLine(task.task, measurer, labelSize);
    const cx = Math.max(pad + label.width / 2, vx);
    let line = 0;
    while (line < vertEnds.length && cx - label.width / 2 < vertEnds[line] + 8) line++;
    vertEnds[line] = cx + label.width / 2;
    extent = Math.max(extent, vertEnds[line]);
    verticals.push([task, label, vx, cx, vertTop + line * vertLine + vertLine / 2]);
  }

  const width = Math.ceil(Math.max(extent, pad + title.width) + pad);
  const height = Math.ceil(plotBottom + tickHeight + (vertEnds.length > 0 ? 4 + vertEnds.length * vertLine : 0) + pad);

  // Layers are painted in this order; each is filled as its data is at hand.
  out.label(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  out.section('sections', ' class="pele-sections"');
  out.section('excluded', ' class="pele-excluded" fill="var(--_a)"');
  out.section('grid', ' class="pele-grid" fill="none"', true);
  out.section('verts', ' class="pele-verts" fill="none" stroke="var(--_l)" stroke-width="1.5" stroke-dasharray="4 3"');
  out.section('today', ' class="pele-today"');
  out.section('tasks', ` class="pele-tasks" font-size="${num(labelSize)}"`, true);
  out.section('section-labels', ` class="pele-section-labels" font-size="${num(sectionSize)}"`, true);
  out.section('axis', ` class="pele-axis" font-size="${tickSize}" fill="var(--_m)"`, true);
  out.section('vert-labels', ` class="pele-vert-labels" font-size="${num(labelSize)}"`);

  // Section bands, one per run of rows that share a section, shaded on alternate sections.
  for (let row = 0; row < rowCount; ) {
    const section = rowSection[row];
    let end = row + 1;
    while (end < rowCount && rowSection[end] === section) end++;
    const index = categories.get(section)! % sectionStyles;
    const y = plotTop + row * rowHeight;
    const h = (end - row) * rowHeight;
    if (categories.size > 1 || section !== '') {
      out.section('sections');
      out.rect(0, y, width, h, ` fill="${index % 2 === 0 ? 'var(--_s)' : 'none'}"`, { cls: `pele-section pele-section-${index}` });
    }
    const label = sectionLabels.get(section)!;
    out.section('section-labels');
    // A label that is an item itself: a typed label has no data-id.
    out.fragment(labelSvg(label, pad + 8 + label.width / 2, y + h / 2, ` class="pele-section-label" data-id="${escText(section)}"${srcAttrs(rowSource[row])}`, options.icons));
    row = end;
  }

  // Excluded days, as Mermaid marks them: a day at a time from the first task's start, and not at all
  // when the chart spans more than five years.
  if ((model.excludes.length > 0 || model.includes.length > 0) && +add(new Date(start), 6, 'y') > stop) {
    let from: Date | undefined;
    let to: Date | undefined;
    const flush = (): void => {
      if (!from || !to) return;
      const dayStart = new Date(from);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(to);
      dayEnd.setHours(23, 59, 59, 999);
      const ex0 = Math.max(left, x(+dayStart));
      const ex1 = Math.min(right, x(+dayEnd));
      if (ex1 > ex0) {
        out.section('excluded');
        out.rect(ex0, plotTop, ex1 - ex0, plotHeight, '');
      }
      from = to = undefined;
    };
    for (let day = new Date(start); +day <= stop; day = addDays(day, 1)) {
      if (model.isInvalidDate(day)) {
        from ??= day;
        to = day;
      } else {
        flush();
      }
    }
    flush();
  }

  const links: LinkInfo[] = [];
  out.section('tasks');
  for (const bar of bars) {
    const task = bar.task;
    const cy = plotTop + bar.row * rowHeight + rowHeight / 2;
    const state = task.active ? 'active' : task.done ? 'done' : '';
    let classes = 'pele-task';
    if (state) classes += ' pele-' + state;
    if (task.crit) classes += ' pele-crit';
    if (task.milestone) classes += ' pele-milestone';
    if (task.classes.includes('clickable')) classes += ' pele-clickable';

    let shape: (() => void) | undefined;
    let textFill = '';
    if (Number.isNaN(bar.x0)) {
      classes += ' pele-unscheduled';
      textFill = ' fill="var(--_m)"';
    } else {
      // A critical task takes the critical color in place of the accent. Done, it keeps the fill
      // of finished work and only its border is in that color.
      const color = task.crit ? CRITICAL : 'var(--_c)';
      const paint =
        state === 'done' ? 'fill="var(--_a)"' : state === 'active' ? `fill="${color}" fill-opacity="0.25"` : `fill="${color}"`;
      const stroke = `stroke="${state === 'done' && !task.crit ? 'var(--_b)' : color}"`;
      if (task.milestone) {
        const cx = (bar.x0 + bar.x1) / 2;
        const r = barHeight / 2;
        shape = () => out.path(out.pen().M(cx, cy - r).L(cx + r, cy).L(cx, cy + r).L(cx - r, cy).Z(), ` ${paint} ${stroke} stroke-linejoin="round"`);
      } else {
        shape = () => out.rect(bar.x0, cy - barHeight / 2, bar.x1 - bar.x0, barHeight, ` ${paint} ${stroke}${ROUNDED}`);
      }
      if (bar.inside) textFill = state === '' ? ' fill="var(--_bg)"' : '';
      else if (state === 'done') textFill = ' fill="var(--_m)"';
    }

    out.group({ cls: classes, id: task.id, source: task.source });
    const url = model.links.get(task.id);
    const href = url === undefined ? undefined : linkUrl(url, options);
    if (href !== undefined) {
      links.push({ id: task.id, href, internal: false });
      out.link(` href="${esc(href)}"${relAttr(options)}`);
    }
    shape?.();
    out.label(bar.label, bar.labelX, cy, ` class="pele-label"${textFill}`);
    if (href !== undefined) out.end();
    out.end();
  }

  if (model.todayMarker !== 'off' && now >= start && now <= stop && stop > start) {
    const tx = x(now);
    const top = plotTop - gridLead;
    const style = model.todayMarker ? resolveStyle(model.todayMarker.split(',')).line : '';
    out.section('today');
    out.path(out.pen().M(tx, top).V(plotBottom), ` fill="none" stroke="var(--_c)" stroke-width="2"${style}`);
    if (!style) out.path(out.pen().M(tx - 4, top - 5).H(tx + 4).L(tx, top + 1).Z(), ' fill="var(--_c)"');
  }

  out.section('grid');
  out.path(grid, ' stroke="var(--_b)" stroke-dasharray="1 3"');
  const axisLine = out.pen().M(left, plotBottom).H(right);
  if (topAxis) axisLine.M(left, plotTop - gridLead).H(right);
  out.path(axisLine, ' stroke="var(--_b)"');

  out.section('verts');
  for (const [task, , vx] of verticals) {
    out.path(out.pen().M(vx, plotTop - gridLead).V(plotBottom), '', undefined, { cls: 'pele-vert', id: task.id, source: task.source });
  }
  out.section('axis');
  for (const [tx, ty, label] of axisBottom) out.text(tx, ty, label, '', ' text-anchor="middle"');
  for (const [tx, ty, label] of axisTop) out.text(tx, ty, label, '', ' text-anchor="middle"');
  out.section('vert-labels');
  for (const [task, label, , cx, cy] of verticals) {
    out.fragment(labelSvg(label, cx, cy, ` class="pele-vert-label" data-id="${escText(task.id)}"${srcAttrs(task.source)}`));
  }

  return { svg: out.done('gantt', width, height, size, options, model), width, height, links };
}
