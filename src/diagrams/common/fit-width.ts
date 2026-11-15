import type { Out } from '../../draw/out.js';
import type { RenderOptions, Rendered } from '../../types.js';

// Draws one attempt into a fresh output of the kind `out` is, when there is one.
function attempt(out: Out | undefined, draw: (out: Out) => Rendered): [Rendered, Out | undefined] {
  const fresh = out?.fork();
  return [draw(fresh as Out), fresh];
}

// Keeps the attempt that was chosen.
function keep(out: Out | undefined, [rendered, drawn]: [Rendered, Out | undefined]): Rendered {
  if (out && drawn) out.adopt(drawn);
  return rendered;
}

// Draws a chart whose plot can be any width so that the whole diagram fits the width the host
// has. What surrounds the plot (labels, a legend) is only known once it is drawn, so the plot
// gives up the overflow and is drawn again. `narrow` tells the chart that it did not fit at
// its own width, for a chart that then arranges itself differently.
export function fitWidth(
  options: RenderOptions,
  natural: number,
  least: number,
  draw: (plot: number, narrow: boolean, out: Out) => Rendered,
  out?: Out
): Rendered {
  let result = attempt(out, (o) => draw(natural, false, o));
  const available = options.maxWidth;
  if (available === undefined || !(available > 0) || result[0].width <= available) return keep(out, result);
  const floor = Math.min(least, natural);
  let plot = natural;
  result = attempt(out, (o) => draw(plot, true, o));
  for (let round = 0; round < 3 && result[0].width > available && plot > floor; round++) {
    plot = Math.max(floor, plot - (result[0].width - available));
    result = attempt(out, (o) => draw(plot, true, o));
  }
  return keep(out, result);
}

// The width a title may take before it wraps.
export function titleRoom(options: RenderOptions): number {
  const available = options.maxWidth;
  return available !== undefined && available > 0 ? Math.max(80, available - 2 * (options.padding ?? 8)) : 4000;
}

// For a chart that is drawn to a set width: its own, or the host's when that is smaller.
// `around` is what the chart adds outside that width.
export function capWidth(options: RenderOptions, natural: number, least: number, around = 0): number {
  const available = options.maxWidth;
  if (available === undefined || !(available > 0)) return natural;
  return Math.max(Math.min(least, natural), Math.min(natural, available - around));
}

const BREAKPOINT = 640;

// For a diagram that can run across or down: draws it across, and down instead when the host
// allows it, the width it has is under the breakpoint, across does not fit, and down is narrower.
export function turnToFit(options: RenderOptions, draw: (down: boolean, out: Out) => Rendered, out?: Out): Rendered {
  const across = attempt(out, (o) => draw(false, o));
  const available = options.maxWidth;
  if (options.autoDirection === false || available === undefined || !(available > 0) || across[0].width <= available) return keep(out, across);
  const breakpoint = options.directionBreakpoint;
  if (available >= (breakpoint !== undefined && breakpoint > 0 ? breakpoint : BREAKPOINT)) return keep(out, across);
  const down = attempt(out, (o) => draw(true, o));
  return keep(out, down[0].width < across[0].width ? down : across);
}

export function runsAcross(direction: string | undefined): boolean {
  return direction === 'LR' || direction === 'RL';
}

// Draws a diagram with room to spare, and tightly instead when that does not fit the width the
// host has and tight is narrower.
export function tighten(options: RenderOptions, draw: (tight: boolean, out: Out) => Rendered, out?: Out): Rendered {
  const loose = attempt(out, (o) => draw(false, o));
  const available = options.maxWidth;
  if (available === undefined || !(available > 0) || loose[0].width <= available) return keep(out, loose);
  const tight = attempt(out, (o) => draw(true, o));
  return keep(out, tight[0].width < loose[0].width ? tight : loose);
}
