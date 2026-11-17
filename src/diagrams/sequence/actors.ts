import type { Out } from '../../draw/out.js';
import type { IconResolver } from '../../svg/builder.js';
import { ROUNDED } from '../../svg/theme.js';
import type { Label } from '../../text/label.js';

const PAD_X = 16;
const PAD_Y = 10;
const GLYPH = 34;
const GLYPH_GAP = 4;
const STACK = 5;
const CAP = 6;
const SHAPE = ' fill="var(--_s)" stroke="var(--_b)"';
const LINE = ' fill="none" stroke="var(--_b)"';
const SHAPE_ROUNDED = SHAPE + ROUNDED;

const KINDS = new Set(['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue']);
const FIGURES = new Set(['actor', 'boundary', 'control', 'entity', 'database']);

export interface ActorSize {
  w: number;
  h: number;
}

export function actorKind(type: string): string {
  return KINDS.has(type) ? type : 'participant';
}

// A figure stands above its label. The other kinds hold the label inside.
export function isFigure(kind: string): boolean {
  return FIGURES.has(kind);
}

export function actorSize(kind: string, label: Label, minW: number, minH: number, paddingX = PAD_X): ActorSize {
  if (isFigure(kind)) return { w: Math.max(40, label.width + 8), h: GLYPH + (label.height > 0 ? GLYPH_GAP + label.height : 0) };
  const extra = kind === 'collections' ? STACK : kind === 'queue' ? 2 * CAP : 0;
  return {
    w: Math.max(minW, label.width + 2 * paddingX) + extra,
    h: Math.max(minH, label.height + 2 * PAD_Y) + (kind === 'collections' ? STACK : 0),
  };
}

function drawFigure(out: Out, kind: string, cx: number, top: number): void {
  switch (kind) {
    case 'actor':
      out.circle(cx, top + 7, 6, SHAPE);
      out.path(out.pen().M(cx, top + 13).V(top + 24).M(cx - 10, top + 17).H(cx + 10).M(cx - 8, top + 34).L(cx, top + 24).L(cx + 8, top + 34), LINE);
      return;
    case 'boundary':
      out.path(out.pen().M(cx - 19, top + 6).V(top + 28).M(cx - 19, top + 17).H(cx - 8), LINE);
      out.circle(cx + 3, top + 17, 11, SHAPE);
      return;
    case 'control':
      out.circle(cx, top + 21, 11, SHAPE);
      out.path(out.pen().M(cx + 5, top + 5).L(cx - 1, top + 10).L(cx + 5, top + 15), LINE);
      return;
    case 'entity':
      out.circle(cx, top + 15, 11, SHAPE);
      out.path(out.pen().M(cx - 11, top + 30).H(cx + 11), LINE);
      return;
    default: {
      const l = cx - 14;
      const r = cx + 14;
      out.path(out.pen().M(l, top + 7).V(top + 27).A(14, 5, 0, 0, 0, r, top + 27).V(top + 7).A(14, 5, 0, 0, 0, l, top + 7).Z(), SHAPE);
      out.path(out.pen().M(l, top + 7).A(14, 5, 0, 0, 0, r, top + 7), LINE);
    }
  }
}

// Draws a participant whose bounding box has its top center at (cx, top).
export function drawActor(
  out: Out,
  kind: string,
  cx: number,
  top: number,
  size: ActorSize,
  label: Label,
  icons: IconResolver | undefined,
  // The fill attribute for a figure's label, which sits on whatever is behind the figure.
  ink = ''
): void {
  const { w, h } = size;
  const text = ' class="pele-label"';
  if (isFigure(kind)) {
    drawFigure(out, kind, cx, top);
    out.label(label, cx, top + GLYPH + GLYPH_GAP + label.height / 2, text + ink, icons);
    return;
  }
  const left = cx - w / 2;
  if (kind === 'collections') {
    const bw = w - STACK;
    const bh = h - STACK;
    out.rect(left + STACK, top, bw, bh, SHAPE_ROUNDED);
    out.rect(left, top + STACK, bw, bh, SHAPE_ROUNDED);
    out.label(label, left + bw / 2, top + STACK + bh / 2, text, icons);
    return;
  }
  if (kind === 'queue') {
    const l = left + CAP;
    const r = left + w - CAP;
    const b = top + h;
    const ry = h / 2;
    out.path(out.pen().M(l, top).H(r).A(CAP, ry, 0, 0, 1, r, b).H(l).A(CAP, ry, 0, 0, 1, l, top).Z(), SHAPE);
    out.path(out.pen().M(r, top).A(CAP, ry, 0, 0, 0, r, b), LINE);
    out.label(label, cx - CAP / 2, top + h / 2, text, icons);
    return;
  }
  out.rect(left, top, w, h, SHAPE_ROUNDED);
  out.label(label, cx, top + h / 2, text, icons);
}
