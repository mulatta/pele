import { Paint, type Out } from '../../draw/out.js';

// How far a marker reaches back along its line from the box it touches.
export const MARKER_LENGTH = 18;

const BAR = 5;
const FOOT = 6;
const FOOT_LENGTH = 10;
const RING = 3.5;

const MARKER = { cls: 'pele-marker' };
const HOLLOW = new Paint(' fill="var(--_bg)"');

// Draws a crow's foot cardinality marker over the end of a line that meets a box at (x, y)
// while travelling along the unit vector (dx, dy). Types are Mermaid's lower-cased cardinalities.
// `hollow` is the color inside rings; a casing drops the marker's class so marker styles skip it.
export function drawErMarker(out: Out, type: string, x: number, y: number, dx: number, dy: number, hollow = 'var(--_bg)', cls = true): void {
  const item = cls ? MARKER : undefined;
  const pen = out.pen();
  // A point `back` along the line from the box and `side` across it.
  const px = (back: number, side: number): number => x - dx * back - dy * side;
  const py = (back: number, side: number): number => y - dy * back + dx * side;
  const fill = hollow === 'var(--_bg)' ? HOLLOW : ` fill="${hollow}"`;
  switch (type) {
    case 'only_one':
      pen.M(px(6, -BAR), py(6, -BAR)).L(px(6, BAR), py(6, BAR)).M(px(10, -BAR), py(10, -BAR)).L(px(10, BAR), py(10, BAR));
      out.path(pen, '', undefined, item);
      return;
    case 'zero_or_one':
      pen.M(px(6, -BAR), py(6, -BAR)).L(px(6, BAR), py(6, BAR));
      out.path(pen, '', undefined, item);
      out.circle(x - dx * 13.5, y - dy * 13.5, RING, fill, item);
      return;
    case 'one_or_more':
      pen.M(px(0, -FOOT), py(0, -FOOT)).L(px(FOOT_LENGTH, 0), py(FOOT_LENGTH, 0)).L(px(0, FOOT), py(0, FOOT));
      pen.M(px(FOOT_LENGTH + 3.5, -BAR), py(FOOT_LENGTH + 3.5, -BAR)).L(px(FOOT_LENGTH + 3.5, BAR), py(FOOT_LENGTH + 3.5, BAR));
      out.path(pen, '', undefined, item);
      return;
    case 'zero_or_more': {
      pen.M(px(0, -FOOT), py(0, -FOOT)).L(px(FOOT_LENGTH, 0), py(FOOT_LENGTH, 0)).L(px(0, FOOT), py(0, FOOT));
      out.path(pen, '', undefined, item);
      const back = FOOT_LENGTH + RING + 0.5;
      out.circle(x - dx * back, y - dy * back, RING, fill, item);
      return;
    }
    case 'md_parent':
      out.path(pen.M(px(0, 0), py(0, 0)).L(px(6, 4), py(6, 4)).L(px(12, 0), py(12, 0)).L(px(6, -4), py(6, -4)).Z(), fill, undefined, item);
  }
}
