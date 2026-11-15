import type { Scene } from './draw/scene.js';
import type { Out } from './draw/out.js';
import type { DiagramType, MermaidType } from './detect.js';
import type { Config } from './preprocess.js';
import type { TextMeasurer } from './text/measurer.js';

export type IconResolver = (name: string) => string | null | undefined;

// Dimensions are in pixels. HTML requires the typesetter's CSS.
export type MathMarkup = { svg: string; width: number; height: number } | { html: string; width: number; height: number };

// TeX excludes the $$ delimiters; font size is in pixels.
export type MathResolver = (tex: string, size: number) => MathMarkup | null | undefined;

export type MonospacePart = 'members' | 'attributes' | 'files' | 'messages';

export interface RenderOptions {
  measurer?: TextMeasurer;
  // The fonts labels are measured in, and drawn in where the page sets no --pele-font or
  // --pele-font-mono.
  fontFamily?: string;
  fontFamilyMono?: string;
  monospace?: readonly MonospacePart[];
  fontSize?: number;
  idPrefix?: string;
  responsive?: boolean;
  // The width the host has for the diagram, in pixels. A type that can draw itself narrower
  // does, so that its text is not shrunk with it.
  maxWidth?: number;
  // Whether a diagram that runs across may be drawn running down when it does not fit
  // `maxWidth`, and the width under which that is done. On by default, under 640 pixels.
  autoDirection?: boolean;
  directionBreakpoint?: number;
  padding?: number;
  limit?: number;
  outputLimit?: number;
  // The most edges a flowchart may have. One short line can ask for millions of them.
  maxEdges?: number;
  // Schemes a link or an image may use besides a relative address.
  linkSchemes?: string[];
  imageSchemes?: string[];
  links?: boolean;
  images?: boolean;
  // Link `rel` attribute. Defaults to `noopener`; an empty string omits it.
  linkRel?: string;
  icons?: IconResolver;
  math?: MathResolver;
  config?: Config;
  // The time gantt charts treat as now. Defaults to the current time.
  now?: number | Date;
  // Adds where each element comes from to its `data-id` group (see SourceInfo), for a host that
  // maps what is drawn back to the text. Parsing records it only when asked, so parse() takes it
  // too: a model parsed without it has none to add. renderScene() asks for it when it parses.
  sourceInfo?: boolean;
}

// Where a drawn element comes from in the text as written, front matter and comments included:
// its first line (and last, for a block that spans several), the name the author gave it, and
// for a connection the names of its two ends. Types that do not record it leave it out.
export interface SourceInfo {
  line?: number;
  end?: number;
  symbol?: string;
  from?: string;
  to?: string;
}

export interface LinkInfo {
  id: string;
  href: string;
  internal: boolean;
}

export interface Rendered {
  svg: string;
  width: number;
  height: number;
  links: LinkInfo[];
  // Set instead of `svg` when the diagram was drawn with a scene sink.
  scene?: Scene;
}

export interface RenderResult extends Rendered {
  type: DiagramType;
  mermaidType: MermaidType;
}

// What a diagram type provides. `source` has been through preprocessing and entity encoding
// and ends with a newline, as Mermaid's parsers expect.
// Limits set by the host. A diagram's own configuration cannot change them.
export interface ParseLimits {
  maxEdges: number;
}

export interface Diagram<Model> {
  type: DiagramType;
  // The name of this type's section in Mermaid's config, when it is not the type's own name.
  section?: string;
  // A diagram that reports source positions is given the text with its `%%` comment lines kept.
  // `lineOffset` is the number of front matter lines that were removed before that text.
  keepComments?: boolean;
  // Enables $$...$$ in labels.
  math?: boolean;
  parse(source: string, config: Config, title: string | undefined, lineOffset: number, limits: ParseLimits): Model;
  // Draws into `out`, which makes SVG for render() and a scene for renderScene(). The SVG goes in
  // `svg`; for a scene, `svg` is empty.
  render(model: Model, config: Config, options: RenderOptions, out: Out): Rendered;
}
