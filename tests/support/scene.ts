import { expect } from 'vitest';
import { PeleError, SCENE_VERSION, renderScene, type RenderOptions, type SceneResult } from '../../src/index.js';
import type { Box, Scene, SceneItem, SceneShape, SceneText } from '../../src/draw/scene.js';
import { metricsMeasurer } from '../../src/text/measurer.js';

// What tests read a scene with. Scenes are measured with the fixed metrics, so that numbers do
// not depend on the fonts of the machine.
export const options: RenderOptions = { measurer: metricsMeasurer };

export function draw(src: string, extra: RenderOptions = {}): SceneResult {
  return renderScene(src, { ...options, ...extra });
}

// The scene of a source, or undefined when pele refuses it; anything else it throws is a bug.
export function tryDraw(src: string, extra: RenderOptions = {}): SceneResult | undefined {
  try {
    return draw(src, extra);
  } catch (error) {
    if (error instanceof PeleError) return undefined;
    throw error;
  }
}

// A text line as written: its runs joined.
export const lineOf = (t: SceneText): string => t.spans.map((s) => s.text).join('');

// Every line of text, in drawing order.
export const lines = (scene: Scene): string[] => scene.texts.map(lineOf);

// All the text, one line per text.
export const textOf = (scene: Scene): string => lines(scene).join('\n');

// Whether an item's class list names `cls`.
export const hasClass = (item: SceneItem, cls: string): boolean => item.kind.split(' ').includes(cls);

// The items with a class, in drawing order.
export const items = (scene: Scene, cls?: string): SceneItem[] => (cls === undefined ? scene.items : scene.items.filter((i) => hasClass(i, cls)));

export const itemById = (scene: Scene, id: string, cls?: string): SceneItem | undefined => items(scene, cls).find((i) => i.id === id);

const indexOf = (scene: Scene, item: SceneItem | number): number => (typeof item === 'number' ? item : scene.items.indexOf(item));

// What an item draws itself; parts inside it that are items of their own are theirs.
export const shapesOf = (scene: Scene, item: SceneItem | number): SceneShape[] => {
  const at = indexOf(scene, item);
  return scene.shapes.filter((s) => s.item === at);
};

export const textsOf = (scene: Scene, item: SceneItem | number): SceneText[] => {
  const at = indexOf(scene, item);
  return scene.texts.filter((t) => t.item === at);
};

// Whether two boxes share any area.
export const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Every paint the scene uses: fills, strokes, text and run paints, outlines and gradient stops.
export function paints(scene: Scene): string[] {
  const out: string[] = [];
  for (const s of scene.shapes) out.push(s.paint);
  for (const t of scene.texts) {
    out.push(t.paint);
    if (t.stroke !== undefined) out.push(t.stroke);
    for (const s of t.spans) if (s.paint !== undefined) out.push(s.paint);
  }
  for (const g of Object.values(scene.gradients ?? {})) for (const s of g.stops) out.push(s.paint);
  return out;
}

// A host puts paints in its own style and follows links, so neither may carry script, a
// stylesheet, or a way to load anything. Numbers must be numbers.
const RE_SCRIPT_URL = /^[\s\u0000-\u001f]*(?:javascript|vbscript|data)\s*:/i;
const RE_ALLOWED_URL = /^(?:(?:https?|mailto|tel):|(?![\\/]{2}|[a-z][a-z0-9+.-]*:))/i;
const RE_UNSAFE_PAINT = /url\s*\(|expression|javascript:|@import|[<>{};\\]/i;

const finite = (...values: number[]): boolean => values.every(Number.isFinite);

// The first thing about a scene a host could not take as it is, or undefined when there is none.
export function sceneProblem(result: SceneResult): string | undefined {
  const { scene } = result;
  if (scene.version !== SCENE_VERSION) return `version ${scene.version}`;
  if (!finite(result.width, result.height, scene.x, scene.y, scene.w, scene.h)) return 'size is not a number';
  for (const p of paints(scene)) if (RE_UNSAFE_PAINT.test(p)) return `paint ${JSON.stringify(p)}`;
  for (const s of scene.shapes) {
    if (!finite(...s.cmds, s.opacity, s.box.x0, s.box.y0, s.box.x1, s.box.y1)) return 'shape number is not a number';
    if (s.width !== undefined && !finite(s.width)) return 'stroke width is not a number';
    if (s.item < -1 || s.item >= scene.items.length) return `shape item ${s.item}`;
    if (s.gradient !== undefined && scene.gradients?.[s.gradient] === undefined) return `gradient ${s.gradient}`;
  }
  for (const t of scene.texts) {
    if (!finite(t.x, t.y, t.size, t.weight)) return 'text number is not a number';
    if (t.item < -1 || t.item >= scene.items.length) return `text item ${t.item}`;
  }
  for (const i of scene.items) {
    if (typeof i.id !== 'string') return 'item id is not a string';
    if (i.box && !finite(i.box.x0, i.box.y0, i.box.x1, i.box.y1)) return 'item box is not a number';
  }
  // An internal link is a note name the host looks up, never followed as an address, so it holds
  // whatever the text says.
  for (const link of result.links) {
    if (link.internal) continue;
    if (RE_SCRIPT_URL.test(link.href)) return `link ${JSON.stringify(link.href)} can run script`;
    // What a browser makes of the value: tabs and line breaks dropped, then leading spaces and controls.
    const seen = link.href.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '');
    if (!RE_ALLOWED_URL.test(seen)) return `link ${JSON.stringify(link.href)} has a scheme that is not allowed`;
  }
  return undefined;
}

// Checked with plain conditions: an assertion call per value would make these tests many times
// slower than the drawing they check.
export function assertSafe(result: SceneResult, where: string): void {
  const problem = sceneProblem(result);
  if (problem !== undefined) expect.fail(`${where}: ${problem}`);
}
