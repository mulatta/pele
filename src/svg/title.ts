import { layoutLabel, type Label } from '../text/label.js';
import { withoutMath } from '../text/math.js';
import { Style, type TextMeasurer } from '../text/measurer.js';
import type { Out } from '../draw/out.js';
import { labelSvg, num } from './builder.js';

// Mermaid draws diagram titles as text, whatever they hold.
export function titleLabel(title: string | undefined, measurer: TextMeasurer, size: number, maxWidth: number): Label {
  return withoutMath(() => layoutLabel(title, false, measurer, size, maxWidth, Style.Bold));
}

export interface Titled {
  width: number;
  height: number;
  content: string;
}

// Where a diagram title goes above content that was laid out without one: the size with it, and
// how far the content moves.
interface Heading {
  label: Label;
  width: number;
  height: number;
  x: number;
  y: number;
}

function heading(title: string | undefined, measurer: TextMeasurer, size: number, pad: number, width: number, height: number): Heading | null {
  const label = titleLabel(title, measurer, size, 4000);
  if (label.height === 0) return null;
  const shift = label.height + 12;
  const full = Math.max(width, Math.ceil(label.width + 2 * pad));
  return { label, width: full, height: Math.ceil(height + shift), x: (full - width) / 2, y: shift };
}

// Draws a diagram title above content that was laid out without one, which is moved below it:
// call before the content's layers are made. Returns the size with the title.
export function titleAbove(
  out: Out,
  title: string | undefined,
  measurer: TextMeasurer,
  size: number,
  pad: number,
  width: number,
  height: number
): { width: number; height: number } {
  const head = heading(title, measurer, size, pad, width, height);
  if (!head) return { width, height };
  out.section('title');
  out.label(head.label, head.width / 2, pad + head.label.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
  out.frame(head.x, head.y);
  return { width: head.width, height: head.height };
}

export interface Titled {
  width: number;
  height: number;
  content: string;
}

// Puts a diagram title above content that was laid out without one.
export function withTitle(
  title: string | undefined,
  measurer: TextMeasurer,
  size: number,
  pad: number,
  width: number,
  height: number,
  content: string
): Titled {
  const head = heading(title, measurer, size, pad, width, height);
  if (!head) return { width, height, content };
  return {
    width: head.width,
    height: head.height,
    content:
      labelSvg(head.label, head.width / 2, pad + head.label.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      `<g transform="translate(${num(head.x)},${num(head.y)})">${content}</g>`,
  };
}
