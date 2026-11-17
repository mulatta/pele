// What a renderer draws into: a vector scene (SceneOut). Styles are given as SVG presentation
// attributes, the vocabulary pele's renderers and themes are written in, and read into numbers.
import type { Label } from '../text/label.js';
import type { IconResolver, SourceInfo } from '../types.js';

// A group: a frame in the scene, and an item of the scene when it has an id.
export interface Group {
  // The class, and the item's kind.
  cls?: string;
  // Attributes read before `attrs`.
  before?: string;
  // The item's id.
  id?: string;
  // Where the item comes from in the text.
  source?: SourceInfo;
  // Presentation attributes, inherited by what the group holds.
  attrs?: string;
  // A move of what the group holds.
  x?: number;
  y?: number;
}

// Attributes a renderer uses again and again (a class of shape, a text style), read once and
// kept here.
export class Paint {
  look: unknown = undefined;
  constructor(readonly attrs: string) {}
}

// A shape that is a part of the diagram itself: an item of the scene.
export type Item = Pick<Group, 'cls' | 'id' | 'source'>;

// Attributes as text, or as a Paint made once. They paint; a transform goes on a group, where the
// scene reads it.
export type Attrs = string | Paint;

// Path data as numbers, in SVG's commands. Lower-case commands are relative to the current
// point.
export interface Pen {
  M(x: number, y: number): Pen;
  L(x: number, y: number): Pen;
  H(x: number): Pen;
  V(y: number): Pen;
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): Pen;
  Q(x1: number, y1: number, x: number, y: number): Pen;
  // An elliptical arc, with SVG's arguments.
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
}

// A run of text in a line, with attributes of its own when it has any.
export interface Run {
  text: string;
  attrs?: string;
}

export interface Out {
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
  // A link around what follows; its target goes in the result's links.
  link(): void;
  // Closes the latest group or link.
  end(): void;
  // SVG markup read into the scene: a shape's outline, a marker, a small piece drawn by a shared
  // helper.
  fragment(svg: string): void;
  // A rectangle; a null x or y is 0.
  rect(x: number | null, y: number | null, w: number, h: number, attrs: Attrs, item?: Item): void;
  // A null cx or cy is 0.
  circle(cx: number | null, cy: number | null, r: number, attrs: Attrs, item?: Item): void;
  // A null cx or cy is 0.
  ellipse(cx: number | null, cy: number | null, rx: number, ry: number, attrs: Attrs, item?: Item): void;
  line(x1: number, y1: number, x2: number, y2: number, attrs: Attrs, item?: Item): void;
  // x, y pairs.
  polygon(points: number[], attrs: Attrs, item?: Item): void;
  // One line of text; `after` is read after `attrs`, as an override.
  text(x: number, y: number, text: string, attrs: Attrs, after?: string): void;
  // One line of runs, each with attributes of its own over the line's.
  spans(x: number, y: number, runs: Run[], attrs: Attrs, after?: string): void;
  // Markup a scene cannot show (an icon's nested <svg>, an <image>), counted as skipped under `what`.
  opaque(svg: string, what: string): void;
  // A linear gradient a fill can use as `url(#id) fallback`, from (x1, y1) to (x2, y2) in the
  // current group, with stops as [offset 0..1, colour as attribute text].
  gradient(id: string, x1: number, y1: number, x2: number, y2: number, stops: [number, string][]): void;
  // New path data, to draw with path().
  pen(): Pen;
  // A path: data from pen(), or SVG path text, with the numbers of the text when the caller has
  // them.
  path(d: string | Pen, attrs: Attrs, tokens?: number[], item?: Item): void;
  // A measured label centered on (cx, cy).
  label(label: Label, cx: number, cy: number, attrs: Attrs, icons?: IconResolver): void;
  // Ends the drawing, width by height.
  done(width: number, height: number): void;
}
