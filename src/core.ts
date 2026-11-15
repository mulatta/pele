import { detectDiagram, type Detected, type DiagramType, type MermaidType } from './detect.js';
import { inputOffset, inputOffsets, locatingIn, PeleError, type Edit } from './errors.js';
import { decodeEntities, writtenCodes } from './text/entities.js';
import { withIcons } from './text/icons.js';
import { withMath } from './text/math.js';
import { cleanupComments, encodeEntities, normalizeLineBreaks, preprocess, type Config } from './preprocess.js';
import type { DiagramModel } from './models.js';
import { palette, withPalette } from './svg/palette.js';
import { mountWith, type MountOptions, type Mounted } from './mount.js';
import type { Diagram, RenderOptions, RenderResult } from './types.js';
import { SceneSink, withSink, type Scene } from './scene/sink.js';

export { PeleError } from './errors.js';
export type { PeleErrorCode } from './errors.js';
export type { DiagramType, MermaidType } from './detect.js';
export type { TextMeasurer } from './text/measurer.js';
export type { IconResolver, LinkInfo, MathMarkup, MathResolver, MonospacePart, RenderOptions, RenderResult, SourceInfo } from './types.js';
export type { Diagram } from './types.js';
export type { MountOptions, Mounted } from './mount.js';
export { forgetTextWidths } from './text/measurer.js';
export { enableZoom } from './zoom.js';
export type { Scene, SceneShape, SceneText, SceneItem } from './scene/sink.js';
export type { Zoom, ZoomOptions } from './zoom.js';

const diagrams = new Map<DiagramType, Diagram<unknown>>();

// Makes diagram types available to render() and parse(). The full entry point registers every
// type; an app that imports this module picks the ones it needs.
export function register(...list: Diagram<any>[]): void {
  for (const diagram of list) diagrams.set(diagram.type, diagram as Diagram<unknown>);
}

export function registered(type: DiagramType): boolean {
  return diagrams.has(type);
}

// Mermaid's default maxTextSize.
const DEFAULT_LIMIT = 50000;
// Mermaid has no limit on its output. A source within the limit can still describe a drawing
// of many megabytes, which would stall the page it is put into.
const DEFAULT_OUTPUT_LIMIT = 4_000_000;
// Mermaid stops at 500. Pele draws 5,000 edges in tens of milliseconds, and `A & B --> C & D`
// multiplies: without a limit, a few kilobytes of source ask for millions of edges.
const DEFAULT_MAX_EDGES = 5000;

// Deep nesting can exhaust the stack in a few recursive spots. Report it as a limit, not a crash.
function guarded<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) throw new PeleError('Diagram is nested too deeply.', 'limit');
    throw error;
  }
}

function tagErrors<T>(found: Detected, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) throw new PeleError('Diagram is nested too deeply.', 'limit', found);
    if (error instanceof PeleError) {
      error.type ??= found.type;
      error.mermaidType ??= found.mermaidType;
      const message = writtenCodes(error.message);
      if (message !== error.message) {
        error.stack = error.stack?.replace(error.message, () => message);
        error.message = message;
      }
      error.snippet = writtenCodes(error.snippet);
    }
    throw error;
  }
}

export type ParsedDiagramModel = DiagramModel & { readonly mermaidType: MermaidType };

interface Parsed extends Detected {
  diagram: Diagram<unknown>;
  model: unknown;
  config: Config;
}

const parsedModels = new WeakMap<object, Parsed>();

function parseSource(
  text: string,
  limit: number = DEFAULT_LIMIT,
  maxEdges: number = DEFAULT_MAX_EDGES,
  extra: Config | undefined,
  record = false
): Parsed {
  if (text.length > limit) {
    throw new PeleError(`Diagram source is longer than the limit of ${limit} characters.`, 'limit');
  }
  // With sources asked for, the preprocessing edits are kept as they are made, to map back through.
  const steps: Edit[][] | undefined = record ? [] : undefined;
  const pre = preprocess(text, steps);
  const found = detectDiagram(pre.text);
  if (found === null) {
    throw new PeleError('No diagram type detected for the given text.', 'unsupported-diagram');
  }
  const diagram = diagrams.get(found.type);
  if (diagram === undefined) {
    throw new PeleError(`Diagram type "${found.type}" is not supported yet.`, 'unsupported-diagram', found);
  }
  const config = extra ? { ...extra, ...pre.config } : pre.config;
  const keepComments = diagram.keepComments === true;
  const body = keepComments ? pre.withComments : steps ? cleanupComments(pre.withComments, steps) : pre.text;
  const parsed = encodeEntities(body, steps) + '\n';
  const where = steps ? recorded(text, steps) : { find: inSource(text, keepComments) };
  const model = tagErrors(found, () =>
    locatingIn({ parsed, ...where, record }, () =>
      diagram.parse(parsed, config, pre.title, pre.lineOffset, { maxEdges })
    )
  );
  return { ...found, diagram, model, config };
}

// Positions in the text as written, through the edits preprocessing recorded.
function recorded(text: string, steps: Edit[][]) {
  const source = normalizeLineBreaks(text) + '\n';
  return {
    find: (at: number): [string, number] => [source, inputOffset(steps, at)],
    findAll: (offsets: number[]): [string, number[]] => [source, inputOffsets(steps, offsets)],
  };
}

// Record preprocessing edits only when a source position is needed.
function inSource(text: string, keepComments: boolean): (at: number) => [source: string, offset: number] {
  let steps: Edit[][] | undefined;
  let source = '';
  return (at) => {
    if (steps === undefined) {
      steps = [];
      const pre = preprocess(text, steps);
      encodeEntities(keepComments ? pre.withComments : cleanupComments(pre.withComments, steps), steps);
      // Match the line break appended for parsing.
      source = normalizeLineBreaks(text) + '\n';
    }
    return [source, inputOffset(steps, at)];
  };
}

function parsedFrom(source: string | DiagramModel, options: ParseOptions): Parsed {
  if (typeof source === 'string') return parseSource(source, options.limit, options.maxEdges, options.config, options.sourceInfo);
  const parsed = parsedModels.get(source);
  if (parsed === undefined) throw new TypeError('render() takes diagram text or a model that parse() returned.');
  return parsed;
}

export function detectType(text: string): DiagramType | null {
  return detectDiagram(preprocess(text).text)?.type ?? null;
}

export function supports(text: string): boolean {
  try {
    const type = detectType(text);
    return type !== null && diagrams.has(type);
  } catch {
    return false;
  }
}

// The options that are read when the text is parsed. A render() that is given a model has
// nothing left to do with them.
export type ParseOptions = Pick<RenderOptions, 'limit' | 'maxEdges' | 'config' | 'sourceInfo'>;

export function parse(text: string, options: ParseOptions = {}): ParsedDiagramModel {
  return guarded(() => {
    const parsed = parseSource(text, options.limit, options.maxEdges, options.config, options.sourceInfo);
    const model = parsed.model as ParsedDiagramModel;
    Object.defineProperty(model, 'mermaidType', { value: parsed.mermaidType, enumerable: true });
    parsedModels.set(model, parsed);
    return model;
  });
}

export function render(source: string | DiagramModel, options: RenderOptions = {}): RenderResult {
  return guarded(() => {
    const { type, mermaidType, diagram, model, config } = parsedFrom(source, options);
    const section = config[diagram.section ?? type];
    const fixed = typeof section === 'object' && section !== null && !Array.isArray(section) && section.useMaxWidth === false;
    const responsive = options.responsive ?? !fixed;
    // The host's icon resolver and the ids in `links` see names as the author meant them, with
    // entity codes turned into their characters, as `data-icon` and `data-id` in the SVG do.
    const resolve = options.icons;
    const icons = resolve && ((name: string) => resolve(decodeEntities(name)));
    const rendered = tagErrors({ type, mermaidType }, () =>
      withPalette(palette(type, config), () =>
        withMath(diagram.math ? options.math : undefined, () =>
          withIcons(icons, () => diagram.render(model, config, { ...options, responsive, icons }))
        )
      )
    );
    const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
    if (rendered.svg.length > outputLimit) {
      throw new PeleError(`Diagram output is longer than the limit of ${outputLimit} characters.`, 'limit', {
        type,
        mermaidType,
      });
    }
    for (const link of rendered.links) link.id = decodeEntities(link.id);
    return { type, mermaidType, ...rendered };
  });
}

// Diagram types whose renderer draws straight into a scene.
const SCENE_TYPES = new Set<DiagramType>(['flowchart', 'class', 'state']);

// Whether renderScene() can draw this text without going through SVG.
export function sceneSupported(source: string | DiagramModel): boolean {
  try {
    const type = typeof source === 'string' ? detectType(source) : parsedFrom(source, {}).type;
    return type !== null && SCENE_TYPES.has(type) && diagrams.has(type);
  } catch {
    return false;
  }
}

export interface SceneResult {
  type: DiagramType;
  mermaidType: MermaidType;
  scene: Scene;
  width: number;
  height: number;
  links: RenderResult['links'];
}

// Draws a diagram as a renderer-neutral vector scene instead of SVG text. Throws a PeleError with
// code 'unsupported' for a type that cannot (see sceneSupported); render() still draws those.
export function renderScene(source: string | DiagramModel, options: RenderOptions = {}): SceneResult {
  return guarded(() => {
    const { type, mermaidType, diagram, model, config } = parsedFrom(source, { ...options, sourceInfo: true });
    if (!SCENE_TYPES.has(type)) {
      throw new PeleError(`${type} diagrams cannot be drawn as a scene yet.`, 'unsupported-diagram', { type, mermaidType });
    }
    const section = config[diagram.section ?? type];
    const fixed = typeof section === 'object' && section !== null && !Array.isArray(section) && section.useMaxWidth === false;
    const responsive = options.responsive ?? !fixed;
    const resolve = options.icons;
    const icons = resolve && ((name: string) => resolve(decodeEntities(name)));
    const sink = new SceneSink();
    const rendered = tagErrors({ type, mermaidType }, () =>
      withSink(sink, () =>
        withPalette(palette(type, config), () =>
          withMath(diagram.math ? options.math : undefined, () =>
            withIcons(icons, () => diagram.render(model, config, { ...options, responsive, icons }))
          )
        )
      )
    );
    if (!rendered.scene) throw new PeleError(`${type} drew no scene.`, 'unsupported-diagram', { type, mermaidType });
    for (const link of rendered.links) link.id = decodeEntities(link.id);
    return { type, mermaidType, scene: rendered.scene, width: rendered.width, height: rendered.height, links: rendered.links };
  });
}

// Renders into an element and draws again when the element's width calls for it. Text that
// cannot be drawn shows its error in the element.
export function mount(element: HTMLElement, text: string, options: MountOptions = {}): Mounted {
  return mountWith({ parse, render }, element, text, options);
}
