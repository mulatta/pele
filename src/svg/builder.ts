import { decodeEntities } from '../text/entities.js';
import { Style } from '../text/measurer.js';
import type { Label } from '../text/label.js';
import type { IconResolver, MathMarkup } from '../types.js';

export type { IconResolver };

const RE_NEEDS_ESC = /[&<>"\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff\ufffe\uffff]/u;
const RE_ESC = /[&<>"]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff\ufffe\uffff]+/gu;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// Removing these characters in esc() can make validated values unsafe.
export const RE_INVALID_XML = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff\ufffe\uffff]/u;

// Escapes text for XML and drops invalid XML characters and DEL.
export function esc(text: string): string {
  return RE_NEEDS_ESC.test(text) ? text.replace(RE_ESC, (c) => ESC[c] ?? '') : text;
}

// Escapes text that is only ever read as text: a tooltip, an accessible name, a `data-id`. Entity
// codes are turned into their characters first. A value that was checked before it is written,
// such as a style, a colour or a URL, must go through esc() instead, so that what was checked is
// what is written.
export function escText(text: string): string {
  return esc(decodeEntities(text));
}

// The two decimals of a coordinate, by hundredths. Building the string from integers is much
// faster than converting a double.
const FRACTION: string[] = [];
for (let i = 0; i < 100; i++) FRACTION.push(i === 0 ? '' : i % 10 === 0 ? '.' + i / 10 : '.' + (i < 10 ? '0' + i : i));

export function num(value: number): string {
  const n = Math.round(value * 100);
  if (n === 0) return '0';
  if (n > 0) {
    if (n < 1e11) {
      const q = Math.floor(n / 100);
      return q + FRACTION[n - q * 100];
    }
  } else if (n > -1e11) {
    const m = -n;
    const q = Math.floor(m / 100);
    return '-' + q + FRACTION[m - q * 100];
  }
  return String(n / 100);
}

const RE_FILL = / fill="([^"]*)"/;
const RE_STROKE = / stroke="([^"]*)"/;
const RE_STYLE = / style="([^"]*)"/;
const RE_STYLE_FILL = /(?:^|;)\s*fill:([^;]*)/;
const RE_STYLE_OPACITY = /(?:^|;)\s*opacity:([^;]*)/;

// Copy only color and opacity to preserve measured math dimensions.
// Use a solid patch for the cluster title's outline to hide edges behind math.
interface MathLook {
  attrs: string;
  halo?: string;
}

function mathLook(attrs: string): MathLook {
  const style = RE_STYLE.exec(attrs)?.[1] ?? '';
  const fill = (RE_STYLE_FILL.exec(style)?.[1] ?? RE_FILL.exec(attrs)?.[1] ?? '').trim();
  if (fill === 'none') return { attrs: '', halo: RE_STROKE.exec(attrs)?.[1] ?? 'none' };
  const opacity = RE_STYLE_OPACITY.exec(style)?.[1].trim();
  return { attrs: (fill === '' ? '' : ` color="${fill}"`) + (opacity ? ` opacity="${opacity}"` : '') };
}

// A math span from x, centred on mid, as a label writes it: the resolver's markup in a box, or, on
// a label with no fill (a cluster title's outline), a patch of the outline's colour.
export function mathMarkup(math: MathMarkup, x: number, mid: number, size: number, attrs: string): string {
  const box = `x="${num(x)}" y="${num(mid - math.height / 2)}" width="${num(math.width)}" height="${num(math.height)}"`;
  const look = mathLook(attrs);
  return look.halo === undefined ? mathSvg(math, box, size, look.attrs) : `<rect ${box} rx="2" fill="${look.halo}"/>`;
}

// Resolver markup is trusted.
function mathSvg(math: MathMarkup, box: string, size: number, attrs: string): string {
  if ('svg' in math) return `<svg class="pele-math" ${box} overflow="visible"${attrs}>${math.svg}</svg>`;
  return (
    `<foreignObject class="pele-math" ${box} overflow="visible"${attrs}>` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${num(size)}px;line-height:normal;white-space:nowrap">${math.html}</div>` +
    '</foreignObject>'
  );
}

const BOLD = ' font-weight="var(--_w)"';
const ITALIC = ' font-style="italic"';
const UNDERLINE = ' text-decoration="underline"';
const MONO = ' font-family="var(--_fm)"';
const SUB = ' baseline-shift="sub" font-size="smaller"';
const SUP = ' baseline-shift="super" font-size="smaller"';

export function spanStyle(style: number): string {
  return (
    (style & Style.Bold ? BOLD : '') +
    (style & Style.Italic ? ITALIC : '') +
    (style & Style.Mono ? MONO : '') +
    (style & Style.Underline ? UNDERLINE : '') +
    (style & Style.Sub ? SUB : style & Style.Sup ? SUP : '')
  );
}

// The emphasis every span of a label has. It is written once, on the text element, where a
// CSS rule for the label reaches it.
export function sharedStyle(label: Label): number {
  let shared = Style.Bold | Style.Italic | Style.Mono;
  let any = false;
  for (const line of label.lines) {
    for (const span of line) {
      if (span.icon !== undefined || span.text === '') continue;
      shared &= span.style;
      any = true;
    }
  }
  return any ? shared : 0;
}

// Adds that emphasis to a text element's attributes, unless they give a weight of their own.
export function textStyle(attrs: string, shared: number): string {
  return (
    attrs +
    (shared & Style.Bold && !attrs.includes(' font-weight="') ? BOLD : '') +
    (shared & Style.Italic && !attrs.includes(' font-style="') ? ITALIC : '') +
    (shared & Style.Mono && !attrs.includes(' font-family="') ? MONO : '')
  );
}
