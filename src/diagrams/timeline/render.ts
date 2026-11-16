import type { Config } from '../../preprocess.js';
import type { Out } from '../../draw/out.js';
import { ARROW, drawMarker } from '../../svg/edges.js';
import { seriesInkFill } from '../../svg/palette.js';
import { rounded, seriesColor } from '../../svg/theme.js';
import type { Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { turnToFit } from '../common/fit-width.js';
import { fitLabel, plainLabel } from '../common/fit.js';
import type { TimelineModel } from './db.js';

const PAD_X = 12;
const PAD_Y = 8;
const MIN_TEXT = 152;
const MAX_TEXT = 216;
const EVENT_TEXT_TD = 264;
const GAP = 20;
const AXIS = 20;
const SPINE = 14;
const EVENT_GAP = 8;
const SECTION_GAP = 8;
const TAIL = 12;
const ON_COLOR = ' fill="var(--_bg)"';
const LINE = ' fill="none" stroke="var(--_b)"';
const AXIS_LINE = ' fill="none" stroke="var(--_l)"';

interface Group {
  section: number;
  periods: number[];
}

export function renderTimeline(model: TimelineModel, config: Config, options: RenderOptions, out: Out): Rendered {
  if (model.direction === 'TD') return draw(out, model, config, options, true);
  return turnToFit(options, (down, o) => draw(o, model, config, options, down), out);
}

function draw(out: Out, model: TimelineModel, config: Config, options: RenderOptions, vertical: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const multicolor = (config.timeline as Config | undefined)?.disableMulticolor !== true;
  const periods = model.periods;
  const hasSections = model.sections.length > 0;

  // Mermaid draws nothing for periods that come before the first section; here they lead, in a neutral color.
  const groups: Group[] = model.sections.map((_, section) => ({ section, periods: [] }));
  const leading: Group = { section: -1, periods: [] };
  periods.forEach((period, i) => (groups[period.sectionIndex] ?? leading).periods.push(i));
  if (leading.periods.length > 0) groups.unshift(leading);

  // Columns widen, up to a point, for a word that would not fit; past that the word is cut.
  // Running down, the two columns share the width the host has.
  const room = vertical && options.maxWidth !== undefined && options.maxWidth > 0 ? options.maxWidth - 2 * pad : Infinity;
  const taken = AXIS + SPINE * 2 + 4 * PAD_X;
  const periodText = Math.min(MIN_TEXT, Math.max(80, Math.round((room - taken) * 0.38)));
  const eventText = Math.min(EVENT_TEXT_TD, Math.max(110, room - taken - periodText));
  let textW = periodText;
  const eventTextW = (): number => (vertical ? eventText : textW);
  let periodLabels = periods.map((p) => plainLabel(p.text, measurer, size, textW));
  let eventLabels = periods.map((p) => p.events.map((e) => plainLabel(e, measurer, small, eventTextW())));
  let widest = 0;
  for (const label of periodLabels) widest = Math.max(widest, label.width);
  if (!vertical) for (const labels of eventLabels) for (const label of labels) widest = Math.max(widest, label.width);
  let overflow = widest > textW;
  if (vertical) for (const labels of eventLabels) for (const label of labels) overflow ||= label.width > eventText;
  if (overflow) {
    textW = Math.min(Math.max(Math.ceil(widest), periodText), room === Infinity ? MAX_TEXT : periodText);
    periodLabels = periods.map((p) => fitLabel(p.text, measurer, size, textW));
    eventLabels = periods.map((p) => p.events.map((e) => fitLabel(e, measurer, small, eventTextW())));
  }

  const lineHeight = Math.round(size * 1.5);
  const colW = textW + 2 * PAD_X;
  const eventW = eventTextW() + 2 * PAD_X;
  const chipHeight = (label: Label): number => Math.max(label.height, lineHeight) + 2 * PAD_Y;
  const eventHeight = (label: Label): number => Math.max(label.height, Math.round(small * 1.5)) + 2 * PAD_Y;
  const seriesOf = (group: Group, period: number): number | undefined =>
    group.section >= 0 ? group.section : hasSections ? undefined : multicolor ? period : 0;
  const colorOf = (group: Group, period: number): string => {
    const series = seriesOf(group, period);
    return series === undefined ? 'var(--_m)' : seriesColor(series);
  };
  const onColor = (series: number | undefined): string => (series === undefined ? '' : seriesInkFill(series)) || ON_COLOR;

  let hasEvents = false;
  for (const labels of eventLabels) if (labels.length > 0) hasEvents = true;
  let slots = 0;
  for (const group of groups) slots += Math.max(group.periods.length, 1);

  const pitch = colW + GAP;
  const drawn = periods.length > 0;
  const bodyW = vertical
    ? colW + (hasEvents ? AXIS + SPINE * 2 + eventW : drawn ? AXIS + TAIL : 0)
    : slots > 0
      ? slots * pitch - GAP + (drawn ? TAIL + ARROW : 0)
      : 0;
  const title = fitLabel(model.title, measurer, size, Math.max(bodyW, 320), Style.Bold);
  const titleH = title.height > 0 ? title.height + 16 : 0;
  const width = Math.max(bodyW, title.width);
  const left = pad + (width - bodyW) / 2;
  const top = pad + titleH;

  const sectionLabel = (group: Group, w: number): Label =>
    fitLabel(model.sections[group.section], measurer, size, w - 2 * PAD_X, Style.Bold);
  const header = (group: Group, label: Label, x: number, y: number, w: number, h: number): void => {
    out.rect(x, y, w, h, rounded(` fill="${seriesColor(group.section)}"`));
    out.label(label, x + w / 2, y + h / 2, ' font-weight="var(--_hw)"' + onColor(group.section));
  };
  const period = (i: number, group: Group, color: string, x: number, y: number, h: number): void => {
    out.rect(x, y, colW, h, rounded(` fill="${color}"`));
    out.label(periodLabels[i], x + colW / 2, y + h / 2, onColor(seriesOf(group, i)));
  };
  const event = (label: Label, color: string, x: number, y: number, h: number): void => {
    out.group({ cls: 'pele-node pele-event' });
    out.rect(x, y, eventW, h, rounded(` fill="${color}" fill-opacity="0.16"`));
    out.label(label, x + eventW / 2, y + h / 2, ` font-size="${small}"`);
    out.end();
  };
  const dot = (x: number, y: number, color: string): void =>
    out.circle(x, y, 4, ` fill="${color}" stroke="var(--_bg)" stroke-width="2"`, { cls: 'pele-dot' });
  const open = (group: Group): void => {
    if (group.section >= 0)
      out.group({ cls: 'pele-cluster pele-section', id: model.sections[group.section].trim(), source: model.sectionSources?.[group.section] });
  };
  const openPeriod = (i: number): void => out.group({ cls: 'pele-node pele-period', id: periods[i].text.trim(), source: periods[i].source });
  // The title and the axis are known only after the body, and are painted before it.
  out.section('title');
  out.section('axis');
  out.section('body');
  let height: number;

  if (vertical) {
    const axisX = left + colW + AXIS;
    const spineX = axisX + SPINE;
    const eventsX = spineX + SPINE;
    let y = top;
    for (const group of groups) {
      open(group);
      if (group.section >= 0) {
        const label = sectionLabel(group, bodyW);
        const h = chipHeight(label);
        header(group, label, left, y, bodyW, h);
        y += h + SECTION_GAP + 4;
      }
      for (const i of group.periods) {
        const color = colorOf(group, i);
        const h = chipHeight(periodLabels[i]);
        // A period and its first event share one center line, so the line between them runs straight.
        const first = eventLabels[i].length > 0 ? eventHeight(eventLabels[i][0]) : h;
        const cy = y + Math.max(h, first) / 2;
        const d = out.pen().M(left + colW, cy).H(axisX);
        const events: [Label, number, number][] = [];
        let ey = cy - first / 2;
        let last = cy;
        for (const label of eventLabels[i]) {
          const eh = eventHeight(label);
          last = ey + eh / 2;
          d.M(spineX, last).H(eventsX);
          events.push([label, ey, eh]);
          ey += eh + EVENT_GAP;
        }
        if (events.length > 0) d.M(axisX, cy).H(spineX).V(last);
        openPeriod(i);
        period(i, group, color, left, cy - h / 2, h);
        out.path(d, LINE, undefined, { cls: 'pele-edge' });
        dot(axisX, cy, color);
        for (const [label, at, eh] of events) event(label, color, eventsX, at, eh);
        out.end();
        y = Math.max(cy + h / 2, ey - EVENT_GAP) + GAP;
      }
      if (group.periods.length === 0) y += GAP - SECTION_GAP - 4;
      if (group.section >= 0) out.end();
    }
    if (groups.length > 0) y -= GAP;
    if (drawn) {
      const tip = y + TAIL + ARROW;
      out.section('axis');
      out.path(out.pen().M(axisX, top).V(tip - ARROW + 1), AXIS_LINE, undefined, { cls: 'pele-axis' });
      drawMarker(out, 'arrow_point', axisX, tip, 0, 1, 'var(--_l)');
      y = tip;
    }
    height = y + pad;
  } else {
    let headerH = 0;
    const sectionLabels = groups.map((group) => {
      if (group.section < 0) return undefined;
      const label = sectionLabel(group, Math.max(group.periods.length, 1) * pitch - GAP);
      headerH = Math.max(headerH, chipHeight(label));
      return label;
    });
    let chipH = 0;
    for (const label of periodLabels) chipH = Math.max(chipH, chipHeight(label));
    const periodsY = top + (hasSections ? headerH + SECTION_GAP : 0);
    const axisY = periodsY + chipH + (chipH > 0 ? AXIS : 0);
    const eventsY = axisY + AXIS;
    let bottom = drawn ? axisY + TAIL : top + headerH;
    let slot = 0;
    groups.forEach((group, g) => {
      const span = Math.max(group.periods.length, 1);
      const gx = left + slot * pitch;
      open(group);
      const label = sectionLabels[g];
      if (label) header(group, label, gx, top, span * pitch - GAP, headerH);
      group.periods.forEach((i, k) => {
        const color = colorOf(group, i);
        const x = gx + k * pitch;
        const cx = x + colW / 2;
        const d = out.pen().M(cx, periodsY + chipH).V(eventLabels[i].length > 0 ? eventsY : axisY);
        const events: [Label, number, number][] = [];
        let ey = eventsY;
        for (const eventLabel of eventLabels[i]) {
          const eh = eventHeight(eventLabel);
          if (ey > eventsY) d.M(cx, ey - EVENT_GAP).V(ey);
          events.push([eventLabel, ey, eh]);
          ey += eh + EVENT_GAP;
        }
        bottom = Math.max(bottom, ey - EVENT_GAP);
        openPeriod(i);
        period(i, group, color, x, periodsY, chipH);
        out.path(d, LINE, undefined, { cls: 'pele-edge' });
        dot(cx, axisY, color);
        for (const [label, at, eh] of events) event(label, color, x, at, eh);
        out.end();
      });
      if (group.section >= 0) out.end();
      slot += span;
    });
    if (drawn) {
      const tip = left + bodyW;
      out.section('axis');
      out.path(out.pen().M(left, axisY).H(tip - ARROW + 1), AXIS_LINE, undefined, { cls: 'pele-axis' });
      drawMarker(out, 'arrow_point', tip, axisY, 1, 0, 'var(--_l)');
    }
    height = bottom + pad;
  }

  const totalWidth = Math.ceil(width + 2 * pad);
  const totalHeight = Math.ceil(Math.max(height, pad * 2));
  out.section('title');
  out.label(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  return {
    svg: out.done('timeline', totalWidth, totalHeight, size, options, model),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
