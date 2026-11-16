import type { Out } from '../../draw/out.js';
import { drawMarker, markerTrim } from '../../svg/edges.js';
import type { EndMarker } from './graph.js';

const TRIANGLE = 12;
const DIAMOND = 16;
const HALF = 6;
const RING = 5;

// How far the line stops short of the node so that it meets the back of the marker.
export function classMarkerTrim(type: EndMarker): number {
  switch (type) {
    case 'extension':
      return TRIANGLE;
    case 'composition':
    case 'aggregation':
      return DIAMOND;
    case 'lollipop':
      return 2 * RING;
    case 'dependency':
      return markerTrim('arrow_point');
  }
  return 0;
}

const MARKER = { cls: 'pele-marker' };
const ROUND = ' stroke-linejoin="round"';

// Draws an end marker whose tip is at (x, y), pointing along (dx, dy).
export function drawClassMarker(out: Out, type: EndMarker, x: number, y: number, dx: number, dy: number, color: string): void {
  const nx = -dy;
  const ny = dx;
  switch (type) {
    case 'extension': {
      const bx = x - dx * TRIANGLE;
      const by = y - dy * TRIANGLE;
      out.path(out.pen().M(x, y).L(bx + nx * HALF, by + ny * HALF).L(bx - nx * HALF, by - ny * HALF).Z(), ROUND, undefined, MARKER);
      return;
    }
    case 'composition':
    case 'aggregation': {
      const mx = x - (dx * DIAMOND) / 2;
      const my = y - (dy * DIAMOND) / 2;
      const half = HALF - 1;
      const pen = out.pen().M(x, y).L(mx + nx * half, my + ny * half).L(x - dx * DIAMOND, y - dy * DIAMOND).L(mx - nx * half, my - ny * half).Z();
      out.path(pen, type === 'composition' ? `${ROUND} fill="${color}"` : ROUND, undefined, MARKER);
      return;
    }
    case 'lollipop':
      out.circle(x - dx * RING, y - dy * RING, RING, '', MARKER);
      return;
    case 'dependency':
      drawMarker(out, 'arrow_point', x, y, dx, dy, color);
  }
}
