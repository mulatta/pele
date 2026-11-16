// What a renderer draws into. It writes a diagram once, through these calls, and the output it
// is given turns them into SVG text (SvgOut) or a vector scene (SceneOut).
import type { Accessible } from '../svg/root.js';
import type { Label } from '../text/label.js';
import type { IconResolver, RenderOptions, SourceInfo } from '../types.js';

// A group: `<g>` in SVG, a frame in a scene, and an item of the scene when it has an id.
export interface Group {
  // The class, and the item's kind.
  cls?: string;
  // Attributes written right after the class.
  before?: string;
  // The `data-id`.
  id?: string;
  // Where the item comes from, written as `data-` attributes when the host asks for them.
  source?: SourceInfo;
  // Attributes written as they are after those. Presentation attributes are inherited.
  attrs?: string;
  // A move, written last as transform="translate(x,y)".
  x?: number;
  y?: number;
}

// Attributes a renderer writes again and again (a class of shape, a text style): the SVG text,
// and what a scene reads from it, read once and kept here.
export class Paint {
  look: unknown = undefined;
  constructor(readonly attrs: string) {}
}

// A shape that is a part of the diagram itself, written before its geometry as
// class="{cls}" data-id="{id}" and the source attributes.
export type Item = Pick<Group, 'cls' | 'id' | 'source'>;

// Attributes as text, or as a Paint made once. They paint; a transform goes on a group, where the
// scene reads it.
export type Attrs = string | Paint;

// Path data. SVG gets `M1,2L3,4C1,2 3,4 5,6`, each command as its letter and its numbers
// joined the same way; a scene gets the numbers, with no text to read back. Lower-case commands
// are relative to the current point, as in SVG.
export interface Pen {
  M(x: number, y: number): Pen;
  L(x: number, y: number): Pen;
  H(x: number): Pen;
  V(y: number): Pen;
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): Pen;
  Q(x1: number, y1: number, x: number, y: number): Pen;
  // Written `A{rx},{ry} {rotation} {large} {sweep} {x},{y}`.
  A(rx: number, ry: number, rotation: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): Pen;
  Z(): Pen;
  // Smooth curves: the first control point mirrors the previous curve's last one.
  S(x2: number, y2: number, x: number, y: number): Pen;
  T(x: number, y: number): Pen;
  m(dx: number, dy: number): Pen;
  l(dx: number, dy: number): Pen;
  h(dx: number): Pen;
  v(dy: number): Pen;
  c(dx1: number, dy1: number, dx2: number, dy2: number, dx: number, dy: number): Pen;
  s(dx2: number, dy2: number, dx: number, dy: number): Pen;
  q(dx1: number, dy1: number, dx: number, dy: number): Pen;
  t(dx: number, dy: number): Pen;
  a(rx: number, ry: number, rotation: number, large: 0 | 1, sweep: 0 | 1, dx: number, dy: number): Pen;
  z(): Pen;
  // Commands whose SVG text has a form of its own (a sign written apart from its number): SVG gets
  // `svg`, a scene what `scene` draws on the pen.
  both(svg: string, scene: (pen: Pen) => void): Pen;
}

// A run of text in a line: plain, or a <tspan> with its own attributes.
export interface Run {
  text: string;
  attrs?: string;
}

export interface Out {
  // Whether every part is to say where it comes from: always for a scene, and for SVG when the
  // host asks for sources. A renderer that writes its own `data-` attributes checks it.
  readonly sources: boolean;
  // Whether the output takes paths as numbers, so that a helper may skip writing their data.
  readonly numbers: boolean;
  // A new, empty output of the same kind, for one attempt of a renderer that draws more than once.
  fork(): Out;
  // Takes the drawing of the attempt that was kept.
  adopt(attempt: Out): void;
  // Switches to a layer of the picture, made on first use with its group's attributes. Layers are
  // painted in the order they are made; an empty one is left out unless `always` is set. A layer
  // made `within` another is written in that one's group, after what it holds.
  section(name: string, attrs?: string, always?: boolean, within?: string): void;
  // Moves the layers made after the first call by (x, y), all in one group: what is below a title.
  // A later call changes the move, for a renderer that knows it only once it has drawn.
  frame(x: number, y: number): void;
  // Draws in another layer and comes back.
  into(name: string, attrs: string, draw: () => void): void;
  group(g: Group): void;
  // A group that only moves what is in it.
  shift(x: number, y: number): void;
  // A link around what follows, as an `<a>` with these attributes.
  link(attrs: string): void;
  // Closes the latest group or link.
  end(): void;
  // A tooltip for the group it is in.
  tooltip(text: string): void;
  // An SVG fragment: a shape's outline, a marker, a small piece drawn by a shared helper.
  fragment(svg: string): void;
  // A rectangle, written as <rect x y width height{attrs}/>; a null x or y is left out (0).
  rect(x: number | null, y: number | null, w: number, h: number, attrs: Attrs, item?: Item): void;
  // Written as <circle cx cy r{attrs}/>; a null cx or cy is left out (0).
  circle(cx: number | null, cy: number | null, r: number, attrs: Attrs, item?: Item): void;
  // Written as <ellipse cx cy rx ry{attrs}/>; a null cx or cy is left out (0).
  ellipse(cx: number | null, cy: number | null, rx: number, ry: number, attrs: Attrs, item?: Item): void;
  // Written as <line x1 y1 x2 y2{attrs}/>.
  line(x1: number, y1: number, x2: number, y2: number, attrs: Attrs, item?: Item): void;
  // x, y pairs, written as <polygon points="x,y x,y"{attrs}/>.
  polygon(points: number[], attrs: Attrs, item?: Item): void;
  // One line of text, written as <text{attrs} x y{after}>text</text>.
  text(x: number, y: number, text: string, attrs: Attrs, after?: string): void;
  // One line of runs, written as <text{attrs} x y{after}>run<tspan{attrs}>run</tspan></text>.
  spans(x: number, y: number, runs: Run[], attrs: Attrs, after?: string): void;
  // Markup a scene cannot show (an icon's nested <svg>, an <image>), counted as skipped under `what`.
  opaque(svg: string, what: string): void;
  // A piece whose SVG has a form of its own: SVG gets `svg()`, a scene what `scene` draws through
  // the typed calls. For markup kept byte for byte until the SVG output goes.
  both(svg: () => string, scene: () => void): void;
  // New path data, to draw with path().
  pen(): Pen;
  // A path, written as <path d{attrs}/>: data from pen(), or text, with the numbers of the text
  // when the caller has them.
  path(d: string | Pen, attrs: Attrs, tokens?: number[], item?: Item): void;
  // A measured label centered on (cx, cy).
  label(label: Label, cx: number, cy: number, attrs: Attrs, icons?: IconResolver): void;
  // Markup that shows nothing, such as a title; what a scene cannot draw goes through opaque.
  raw(svg: string): void;
  // Ends the drawing. Returns the SVG document, or '' for a scene.
  done(type: string, width: number, height: number, fontSize: number, options: RenderOptions, acc: Accessible): string;
}
