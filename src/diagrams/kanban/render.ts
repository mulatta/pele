import type { Config } from '../../preprocess.js';
import { Paint, type Out } from '../../draw/out.js';
import { titleLabel } from '../../svg/title.js';
import { num, textStyle, type IconResolver } from '../../svg/builder.js';
import { CRITICAL, ROUNDED, classNames } from '../../svg/theme.js';
import { labelLine, layoutLabel, lineMiddle, withHeights, type Label, type Span } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import { linkUrl, safeUrl } from '../../util/url.js';
import type { LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { titleRoom } from '../common/fit-width.js';
import { iconMarkup } from '../../text/icons.js';
import { iconSvg } from '../common/icon.js';
import type { KanbanModel, KanbanNode } from './db.js';

// Read once, however many columns and cards use them.
const COLUMN = new Paint(` fill="var(--_s)"${ROUNDED}`);
const CARD = new Paint(` fill="var(--_bg)" stroke="var(--_b)"${ROUNDED}`);

const COLUMN_GAP = 12;
const COLUMN_PAD = 8;
const CARD_PAD = 10;
const CARD_GAP = 8;
const META_GAP = 4;
const ICON_GAP = 6;

// Mermaid names five priorities and gives Medium no color. Matching here ignores case. The high
// ones are marked in the critical color and the low ones in the muted one, the nearer to Medium
// the fainter. They are not series colors, as a theme may put those in any order.
const PRIORITY = new Map([
  ['very high', `stroke="${CRITICAL}"`],
  ['high', `stroke="${CRITICAL}" opacity="0.5"`],
  ['low', 'stroke="var(--_m)" opacity="0.5"'],
  ['very low', 'stroke="var(--_m)"'],
]);

// Lays out text for a fixed width. A word too long for a line is broken between characters,
// because a card cannot grow sideways to hold it.
function fitLabel(
  raw: string | undefined,
  markdown: boolean,
  measurer: TextMeasurer,
  size: number,
  max: number,
  base = 0
): Label {
  const label = layoutLabel(raw, markdown, measurer, size, max, base);
  if (label.width <= max) return label;
  const lines: Span[][] = [];
  const widths: number[] = [];
  let widest = 0;
  let line: Span[] = [];
  let width = 0;
  const commit = (): void => {
    lines.push(line);
    widths.push(width);
    widest = Math.max(widest, width);
    line = [];
    width = 0;
  };
  for (let i = 0; i < label.lines.length; i++) {
    if (label.widths[i] <= max) {
      line = label.lines[i];
      width = label.widths[i];
      commit();
      continue;
    }
    for (const span of label.lines[i]) {
      if (span.icon !== undefined || span.math) {
        if (width > 0 && width + span.width > max) commit();
        line.push(span);
        width += span.width;
        continue;
      }
      let text = '';
      let from = width;
      for (const ch of span.text) {
        const w = measurer.width(ch, size, span.style);
        if (width > 0 && width + w > max) {
          if (text) line.push({ text, style: span.style, width: width - from });
          commit();
          text = '';
          from = 0;
        }
        text += ch;
        width += w;
      }
      if (text) line.push({ text, style: span.style, width: width - from });
    }
    commit();
  }
  const fitted = { ...label, lines, widths, width: widest, height: lines.length * label.lineHeight };
  return label.heights ? withHeights(fitted) : fitted;
}

// Draws a label with every line starting at x, or ending there, and the first line's box starting at y.
function textBlock(out: Out, label: Label, x: number, y: number, attrs: string, icons: IconResolver | undefined, end = false): void {
  for (let i = 0; i < label.lines.length; i++) {
    const line = label.lines[i];
    const cy = y + lineMiddle(label, i);
    if (line.length === 1 && line[0].icon === undefined && line[0].math === undefined && (line[0].style & (Style.Sub | Style.Sup | Style.Underline)) === 0) {
      out.text(x, cy + label.size * 0.35, line[0].text, textStyle(attrs, line[0].style), end ? ' text-anchor="end"' : '');
    } else {
      const width = label.widths[i];
      out.label(labelLine(label, i), x + (end ? -width : width) / 2, cy, attrs, icons);
    }
  }
}

interface Card {
  item: KanbanNode;
  label: Label;
  ticket: Label;
  assigned: Label;
  // Height of the rows under the text that hold the ticket and the assignee.
  meta: number;
  height: number;
}

const has = (name: string | undefined): boolean => !!name && iconMarkup(name) !== '';

export function renderKanban(model: KanbanModel, config: Config, options: RenderOptions, out: Out): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const line = Math.round(size * 1.5);
  const smallLine = Math.round(small * 1.5);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const icons = options.icons;
  const conf = (config.kanban ?? {}) as Config;
  const sectionWidth = conf.sectionWidth;
  const glyph = small * 1.25;
  // Math can't break across lines, so columns widen to hold the widest expression.
  let mathWidth = 0;
  const holds = (raw: string | undefined, fontSize: number, reserved: number): void => {
    if (!raw || !raw.includes('$$')) return;
    for (const spans of layoutLabel(raw, true, measurer, fontSize, Infinity).lines) {
      for (const span of spans) if (span.math) mathWidth = Math.max(mathWidth, span.math.width + reserved);
    }
  };
  for (const section of model.sections) {
    const count = measurer.width(String(section.items.length), small, 0);
    holds(section.label, size, 2 * COLUMN_PAD + 8 + count + 12 + (has(section.icon) ? glyph + ICON_GAP : 0));
    for (const item of section.items) {
      const reserved = 2 * (COLUMN_PAD + CARD_PAD);
      holds(item.label, small, reserved + (has(item.icon) ? glyph + ICON_GAP : 0));
      holds(item.ticket, small, reserved);
      holds(item.assigned, small, reserved);
    }
  }
  const ownWidth = Math.max(
    typeof sectionWidth === 'number' && sectionWidth > 0 ? Math.min(Math.max(sectionWidth, 80), 2000) : 200,
    Math.ceil(mathWidth)
  );
  // A board wider than the width the host has is folded into rows of columns, which then
  // share the row between them.
  const room = options.maxWidth !== undefined && options.maxWidth > 0 ? options.maxWidth - 2 * pad : Infinity;
  const count = model.sections.length;
  const fits = count * (ownWidth + COLUMN_GAP) - COLUMN_GAP <= room;
  const perRow = fits ? Math.max(count, 1) : Math.max(1, Math.floor((room + COLUMN_GAP) / (ownWidth + COLUMN_GAP)));
  const columnWidth = fits
    ? ownWidth
    : Math.max(Math.min(ownWidth, room), Math.min(Math.floor((room + COLUMN_GAP) / perRow) - COLUMN_GAP, ownWidth * 2), Math.ceil(mathWidth));
  const baseUrl = typeof conf.ticketBaseUrl === 'string' ? conf.ticketBaseUrl : '';
  const cardWidth = columnWidth - 2 * COLUMN_PAD;
  const textWidth = cardWidth - 2 * CARD_PAD;
  const links: LinkInfo[] = [];

  const sections = model.sections;
  const titles: Label[] = [];
  const countWidths: number[] = [];
  const cards: Card[][] = [];
  let headHeight = line;
  const bodyHeights: number[] = [];
  for (const section of sections) {
    const countWidth = measurer.width(String(section.items.length), small, 0);
    const reserved = countWidth + 12 + (has(section.icon) ? glyph + ICON_GAP : 0);
    const title = fitLabel(section.label, true, measurer, size, cardWidth - 8 - reserved, Style.Bold);
    headHeight = Math.max(headHeight, title.height);
    countWidths.push(countWidth);
    titles.push(title);

    const list: Card[] = [];
    let height = 0;
    for (const item of section.items) {
      const label = fitLabel(item.label, true, measurer, small, textWidth - (has(item.icon) ? glyph + ICON_GAP : 0));
      const ticket = fitLabel(item.ticket, false, measurer, small, textWidth);
      const assigned = fitLabel(item.assigned, false, measurer, small, textWidth);
      const meta =
        ticket.width + assigned.width + 8 > textWidth
          ? ticket.height + assigned.height
          : Math.max(ticket.height, assigned.height);
      const cardHeight = 2 * CARD_PAD + Math.max(label.height, smallLine) + (meta ? META_GAP + meta : 0);
      list.push({ item, label, ticket, assigned, meta, height: cardHeight });
      height += cardHeight + CARD_GAP;
    }
    cards.push(list);
    bodyHeights.push(height);
  }
  headHeight += 2 * COLUMN_PAD;
  const rowHeights: number[] = [];
  const rowTops: number[] = [];
  for (let first = 0, y = 0; first < sections.length; first += perRow) {
    let tallest = CARD_GAP;
    for (let index = first; index < Math.min(first + perRow, sections.length); index++) tallest = Math.max(tallest, bodyHeights[index]);
    rowTops.push(y);
    rowHeights.push(headHeight + tallest);
    y += headHeight + tallest + COLUMN_GAP;
  }
  const boardHeight = rowHeights.length > 0 ? rowTops[rowTops.length - 1] + rowHeights[rowHeights.length - 1] : 0;

  const title = titleLabel(model.title, measurer, size, titleRoom(options));
  const titleHeight = title.height > 0 ? title.height + 16 : 0;
  const boardWidth = Math.max(Math.min(sections.length, perRow) * (columnWidth + COLUMN_GAP) - COLUMN_GAP, 0);
  const width = Math.max(boardWidth, title.width);
  const left = pad + (width - boardWidth) / 2;
  const edge = columnWidth - COLUMN_PAD - 4;

  const totalWidth = Math.ceil(width + 2 * pad);
  const totalHeight = Math.ceil(boardHeight + titleHeight + 2 * pad);
  out.label(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');

  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const row = Math.floor(index / perRow);
    out.group({
      cls: 'pele-cluster pele-column' + classNames(section.cssClasses ?? ''),
      id: section.id,
      source: section.source,
      x: left + (index % perRow) * (columnWidth + COLUMN_GAP),
      y: pad + titleHeight + rowTops[row],
    });
    out.rect(null, null, columnWidth, rowHeights[row], COLUMN);
    textBlock(out, titles[index], COLUMN_PAD + 4, COLUMN_PAD, ' class="pele-cluster-label" font-weight="var(--_hw)"', icons);
    out.text(edge, COLUMN_PAD + line / 2 + small * 0.35, String(section.items.length), ' class="pele-count"', ` text-anchor="end" font-size="${small}" fill="var(--_m)"`);
    if (has(section.icon)) {
      out.opaque(iconSvg(section.icon!, edge - countWidths[index] - ICON_GAP - glyph, COLUMN_PAD + (line - glyph) / 2, glyph, icons), 'icon');
    }

    let y = headHeight;
    for (const card of cards[index]) {
      const item = card.item;
      const priority = (item.priority ?? '').trim().toLowerCase();
      const color = PRIORITY.get(priority);
      // The transform comes before the font size, which a group's own move would not.
      out.group({
        cls: `pele-node pele-card${color === undefined ? '' : ' pele-priority-' + priority.replace(' ', '-')}${classNames(item.cssClasses ?? '')}`,
        id: item.id,
        source: item.source,
        attrs: ` transform="translate(${COLUMN_PAD},${num(y)})" font-size="${small}"`,
      });
      out.rect(null, null, cardWidth, card.height, CARD);
      if (color !== undefined) {
        out.path(out.pen().M(2.5, 5).V(card.height - 5), ` fill="none" ${color} stroke-width="3" stroke-linecap="round"`, undefined, { cls: 'pele-priority' });
      }
      textBlock(out, card.label, CARD_PAD, CARD_PAD, ' class="pele-label"', icons);
      if (has(item.icon)) {
        out.opaque(iconSvg(item.icon!, cardWidth - CARD_PAD - glyph, CARD_PAD + (smallLine - glyph) / 2, glyph, icons), 'icon');
      }
      const bottom = card.height - CARD_PAD;
      if (item.ticket) {
        const top = bottom - card.meta;
        const href = baseUrl ? linkUrl(safeUrl(baseUrl.replace('#TICKET#', () => item.ticket!)), options) : undefined;
        if (href === undefined) {
          textBlock(out, card.ticket, CARD_PAD, top, ' class="pele-ticket" fill="var(--_m)"', icons);
        } else {
          out.link();
          textBlock(out, card.ticket, CARD_PAD, top, ' class="pele-ticket" fill="var(--_c)"', icons);
          out.end();
          links.push({ id: item.id, href, internal: false });
        }
      }
      if (item.assigned) {
        textBlock(out, card.assigned, cardWidth - CARD_PAD, bottom - card.assigned.height, ' class="pele-assigned" fill="var(--_m)"', icons, true);
      }
      out.end();
      y += card.height + CARD_GAP;
    }
    out.end();
  }

  out.done(totalWidth, totalHeight);
  return {
    width: totalWidth,
    height: totalHeight,
    links,
  };
}
