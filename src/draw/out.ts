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
  // A rectangle, written as <rect x y width height{attrs}/>.
  rect(x: number, y: number, w: number, h: number, attrs: string): void;
  // One line of text, written as <text{attrs} x y{after}>text</text>.
  text(x: number, y: number, text: string, attrs: string, after?: string): void;
  // A path, with the numbers of its data when the caller has them.
  path(d: string, attrs: string, tokens?: number[]): void;
  // A measured label centered on (cx, cy).
  label(label: Label, cx: number, cy: number, attrs: string, icons?: IconResolver): void;
  // Markup only the SVG has (an image, an icon), which a scene leaves out.
  raw(svg: string): void;
  // Ends the drawing. Returns the SVG document, or '' for a scene.
  done(type: string, width: number, height: number, fontSize: number, options: RenderOptions, acc: Accessible): string;
}
