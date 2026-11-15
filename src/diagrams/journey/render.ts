import type { Config } from '../../preprocess.js';
import { Paint, type Out } from '../../draw/out.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { ROUNDED, seriesColor } from '../../svg/theme.js';
import type { Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered, SourceInfo } from '../../types.js';
import { turnToFit } from '../common/fit-width.js';
import { fitLabel, plainLabel } from '../common/fit.js';
import { journeyActors, type JourneyModel } from './db.js';

const PAD_X = 10;
const PAD_Y = 8;
const MIN_TEXT = 124;
const MAX_TEXT = 200;
const GAP = 12;
const BAND_PAD = 6;
const GUTTER = 24;
const LEVEL = 26;
const FACE = 11;
const DOT = 5;
const DOT_STEP = 13;
const LEGEND_GAP = 20;

const CARD = new Paint(` fill="var(--_s)" stroke="var(--_b)"${ROUNDED}`);
const BAND = new Paint(` fill="var(--_a)"${ROUNDED}`);

const EYES = '<circle cx="-3.6" cy="-2.8" r="1.3"/><circle cx="3.6" cy="-2.8" r="1.3"/>';
const MOUTHS = { happy: 'M-5,2A6,6 0 0 0 5,2', neutral: 'M-4.5,4.5H4.5', sad: 'M-5,6.5A6,6 0 0 1 5,6.5' };

function face(x: number, y: number, mood: keyof typeof MOUTHS): string {
  return (
    `<g class="pele-face pele-face-${mood}" transform="translate(${num(x)},${num(y)})">` +
    `<circle r="${FACE}" fill="var(--_bg)" stroke="var(--_l)"/>` +
    `<g fill="var(--_l)">${EYES}</g>` +
    `<path d="${MOUTHS[mood]}" fill="none" stroke="var(--_l)" stroke-linecap="round"/>` +
    '</g>'
  );
}

export function renderJourney(model: JourneyModel, _config: Config, options: RenderOptions, out: Out): Rendered {
  return turnToFit(options, (down, o) => draw(o, model, _config, options, down), out);
}

function draw(out: Out, model: JourneyModel, _config: Config, options: RenderOptions, down: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.75);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  if (down) return verticalJourney(out, model, options);
  const tasks = model.tasks;
  const n = tasks.length;

  // `Task: 5:` names an actor with no name; Mermaid gives it a dot and an empty legend row.
  const names = journeyActors(tasks).filter((name) => name !== '');
  const actor = new Map<string, number>();
  names.forEach((name, i) => actor.set(name, i));
  // An actor is only named, by tasks; its legend entry comes from the first task that names it.
  const named = new Map<string, SourceInfo>();
  if (out.sources) {
    for (const task of tasks) {
      const line = task.source?.line;
      if (line === undefined) continue;
      for (const name of task.people) if (name !== '' && !named.has(name)) named.set(name, { line, symbol: name });
    }
  }

  // Cards widen, up to a point, for a word that would not fit; past that the word is cut.
  let textW = MIN_TEXT;
  let labels = tasks.map((task) => plainLabel(task.task, measurer, small, textW));
  let widest = 0;
  for (const label of labels) widest = Math.max(widest, label.width);
  if (widest > textW) {
    textW = Math.min(Math.ceil(widest), MAX_TEXT);
    labels = tasks.map((task) => fitLabel(task.task, measurer, small, textW));
  }

  const cardW = textW + 2 * PAD_X;
  const pitch = cardW + GAP;
  const plotW = n > 0 ? n * pitch - GAP : 0;

  const lineH = Math.round(small * 1.5);
  const limit = Math.max(plotW, 240);
  const legend: { name: string; label: Label; x: number; y: number; h: number }[] = [];
  let legendW = 0;
  let legendH = 0;
  let lx = 0;
  for (const name of names) {
    const label = fitLabel(name, measurer, small, limit - 2 * DOT - 6);
    const w = 2 * DOT + 6 + label.width;
    if (lx > 0 && lx + w > limit) {
      lx = 0;
      legendH += 4;
    }
    const y = lx > 0 ? legend[legend.length - 1].y : legendH;
    const h = Math.max(label.height, lineH);
    legend.push({ name, label, x: lx, y, h });
    lx += w;
    legendW = Math.max(legendW, lx);
    legendH = Math.max(legendH, y + h);
    lx += LEGEND_GAP;
  }

  const bodyW = n > 0 ? GUTTER + plotW : 0;
  const title = fitLabel(model.title, measurer, size, Math.max(bodyW, 320), Style.Bold);
  const titleH = title.height > 0 ? title.height + 16 : 0;
  const width = Math.max(bodyW, title.width, n > 0 ? GUTTER + legendW : 0);
  const left = pad + (width - bodyW) / 2 + GUTTER;
  const top = pad + titleH;

  // A band covers a run of tasks that share a section, as in Mermaid; a section with no tasks draws nothing.
  const runs: { start: number; count: number; label: Label | undefined }[] = [];
  let bandH = 0;
  for (let i = 0; i < n; ) {
    let end = i + 1;
    while (end < n && tasks[end].section === tasks[i].section) end++;
    let label: Label | undefined;
    if (tasks[i].section !== '') {
      label = fitLabel(tasks[i].section, measurer, small, (end - i) * pitch - GAP - 2 * PAD_X, Style.Bold);
      bandH = Math.max(bandH, Math.max(label.height, lineH) + 2 * BAND_PAD);
    }
    runs.push({ start: i, count: end - i, label });
    i = end;
  }

  let textH = lineH;
  for (const label of labels) textH = Math.max(textH, label.height);
  const dotsH = names.length > 0 ? 2 * DOT + 6 : 0;
  const cardH = textH + dotsH + 2 * PAD_Y;
  const cardsY = top + (bandH > 0 ? bandH + BAND_PAD : 0);
  const chartTop = cardsY + cardH + FACE + 16;
  const chartBottom = chartTop + 4 * LEVEL;
  const right = left + plotW;

  out.label(title, pad + width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  let bottom = top;
  if (n > 0) {
    const grid = out.pen();
    const scale: [number, number, string][] = [];
    for (let score = 5; score >= 1; score--) {
      const y = chartTop + (5 - score) * LEVEL;
      grid.M(left - 6, y).H(right);
      scale.push([left - 12, y + tiny * 0.35, String(score)]);
    }
    out.path(grid, ' fill="none" stroke="var(--_a)"', undefined, { cls: 'pele-grid' });
    out.group({ cls: 'pele-scale', attrs: ` font-size="${tiny}" text-anchor="end" fill="var(--_m)"` });
    for (const [x, y, s] of scale) out.text(x, y, s, '');
    out.end();

    const line = out.pen();
    const stems = out.pen();
    const faces: [number, number, keyof typeof MOUTHS][] = [];
    const cards: (() => void)[] = [];
    tasks.forEach((task, i) => {
      const x = left + i * pitch;
      const cx = x + cardW / 2;
      const score = task.score;
      const level = Number.isNaN(score) ? 3 : Math.min(5, Math.max(1, score));
      const y = chartTop + (5 - level) * LEVEL;
      if (i === 0) line.M(cx, y);
      else line.L(cx, y);
      stems.M(cx, cardsY + cardH).V(y - FACE);
      faces.push([cx, y, score > 3 ? 'happy' : score < 3 ? 'sad' : 'neutral']);

      const people = task.people.filter((name) => name !== '');
      const step = Math.min(DOT_STEP, (cardW - 2 * PAD_X - 2 * DOT) / Math.max(people.length - 1, 1));
      cards.push(() => {
        out.group({ cls: 'pele-node pele-task', id: task.task.trim(), source: task.source });
        out.rect(x, cardsY, cardW, cardH, CARD);
        out.label(labels[i], cx, cardsY + PAD_Y + textH / 2, ` font-size="${small}"`);
        people.forEach((name, k) => {
          out.at(cx + (k - (people.length - 1) / 2) * step, cardsY + cardH - PAD_Y - DOT, (px, py) =>
            `<circle class="pele-actor" cx="${num(px)}" cy="${num(py)}" r="${DOT}" fill="${seriesColor(actor.get(name) ?? 0)}" stroke="var(--_s)"><title>${escText(name)}</title></circle>`
          );
        });
        out.end();
      });
    });
    out.path(stems, ' fill="none" stroke="var(--_b)" stroke-dasharray="2 3"', undefined, { cls: 'pele-stems' });
    if (n > 1) out.path(line, ' fill="none" stroke="var(--_l)" stroke-linejoin="round"', undefined, { cls: 'pele-edge' });
    for (const [fx, fy, mood] of faces) out.at(fx, fy, (x, y) => face(x, y, mood));

    for (const run of runs) {
      if (!run.label) {
        for (let k = run.start; k < run.start + run.count; k++) cards[k]();
        continue;
      }
      const x = left + run.start * pitch;
      const w = run.count * pitch - GAP;
      // A band over tasks of sections of one name, one after another, comes from the first of them.
      const first = tasks[run.start];
      out.group({ cls: 'pele-cluster pele-section', id: first.section.trim(), source: first.sectionSource });
      out.rect(x, top, w, bandH, BAND);
      out.label(run.label, x + w / 2, top + bandH / 2, ` font-size="${small}" font-weight="var(--_hw)"`);
      for (let k = run.start; k < run.start + run.count; k++) cards[k]();
      out.end();
    }
    bottom = chartBottom + FACE;

    if (legend.length > 0) {
      const x0 = left + (plotW - legendW) / 2;
      const y0 = bottom + 16;
      out.group({ cls: 'pele-legend', attrs: ` font-size="${small}"` });
      for (const item of legend) {
        const cy = y0 + item.y + item.h / 2;
        out.group({ cls: 'pele-legend-item', id: item.name, source: named.get(item.name) });
        out.circle(x0 + item.x + DOT, cy, DOT, ` fill="${seriesColor(actor.get(item.name) ?? 0)}"`);
        out.label(item.label, x0 + item.x + 2 * DOT + 6 + item.label.width / 2, cy, '');
        out.end();
      }
      out.end();
      bottom = y0 + legendH;
    }
  }

  const totalWidth = Math.ceil(width + 2 * pad);
  const totalHeight = Math.ceil(Math.max(bottom, pad) + pad);
  return {
    svg: out.done('journey', totalWidth, totalHeight, size, options, model),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}

function verticalJourney(out: Out, model: JourneyModel, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const room = Math.max(140, (options.maxWidth ?? 320) - 2 * pad);
  const title = fitLabel(model.title, measurer, size, room, Style.Bold);
  const names = journeyActors(model.tasks).filter(name => name !== '');
  const actors = new Map(names.map((name, i) => [name, i]));
  let y = pad + (title.height ? title.height + 16 : 0);
  let section: string | undefined;
  // The title is known after the body and painted before it.
  out.section('title');
  out.section('body');
  let width = title.width;
  model.tasks.forEach((task, index) => {
    if (task.section !== section) {
      section = task.section;
      const head = fitLabel(section, measurer, size, room - 16, Style.Bold);
      if (head.height) {
        out.label(head, pad + 8 + head.width / 2, y + head.height / 2, ' class="pele-cluster-label" font-weight="var(--_hw)"');
        width = Math.max(width, head.width + 16);
        y += head.height + 8;
      }
    }
    const label = fitLabel(task.task, measurer, small, room - 72);
    const people = task.people.filter(name => name !== '').map(name => ({ name, label: fitLabel(name, measurer, small, room - 44) }));
    const textH = Math.max(label.height, 42);
    let h = 2 * PAD_Y + textH;
    for (const person of people) h += Math.max(16, person.label.height) + 4;
    const w = Math.max(room, label.width + 72);
    out.group({ cls: 'pele-node pele-journey-step', id: `${index}`, source: task.source });
    out.rect(pad, y, w, h, CARD);
    // Measured at the small size but drawn at the inherited one, which a typed label would not reproduce.
    out.fragment(labelSvg(label, pad + PAD_X + label.width / 2, y + PAD_Y + label.height / 2, ' class="pele-label"'));
    const cx = pad + w - 28;
    out.at(cx, y + PAD_Y + FACE, (x, yy) => face(x, yy, task.score > 3 ? 'happy' : task.score < 3 ? 'sad' : 'neutral'));
    if (!Number.isNaN(task.score))
      out.text(cx, y + PAD_Y + 2 * FACE + small, num(Math.min(5, Math.max(1, task.score))), ' class="pele-journey-score"', ` font-size="${small}" text-anchor="middle"`);
    let py = y + PAD_Y + textH + 4;
    for (const person of people) {
      const ph = Math.max(16, person.label.height);
      out.circle(pad + 16, py + ph / 2, DOT, ` fill="${seriesColor(actors.get(person.name)!)}"`, { cls: 'pele-actor' });
      out.label(person.label, pad + 28 + person.label.width / 2, py + ph / 2, ` class="pele-journey-actor" font-size="${small}"`);
      py += ph + 4;
    }
    out.end();
    y += h;
    if (index + 1 < model.tasks.length) out.path(`M${num(pad + w / 2)},${num(y)}v16`, ' fill="none" stroke="var(--_l)"', undefined, { cls: 'pele-edge' });
    y += 16;
    width = Math.max(width, w);
  });
  const totalWidth = Math.ceil(width + 2 * pad);
  const height = Math.ceil(Math.max(pad + title.height, y - (model.tasks.length ? 16 : 0)) + pad);
  out.section('title');
  out.label(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  return { svg: out.done('journey', totalWidth, height, size, options, model), width: totalWidth, height, links: [] };
}
