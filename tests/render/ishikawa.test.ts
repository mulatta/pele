import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports, type SceneResult } from '../../src/index.js';
import type { Scene, SceneText } from '../../src/draw/scene.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, itemById, items, lineOf, shapesOf, textOf, textsOf } from '../support/scene.js';

const corpus = loadCorpus('ishikawa', /ishikawa/i).filter((src) => /^\s*ishikawa/i.test(src));
const DOC = corpus.find((src) => src.includes('Beautification'))!;

const drawOf = (src: string): SceneResult => draw('ishikawa-beta\n' + src);

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  text: string;
}

// The box of every line of a cause's text, from its anchor, its size and the measurer. The
// causes are the texts of a category that are smaller than its name.
function textBoxes(scene: Scene): Box[] {
  const out: Box[] = [];
  for (const category of items(scene, 'pele-ishikawa-category')) {
    for (const t of textsOf(scene, category)) {
      if (t.size >= 16) continue;
      const text = lineOf(t);
      const width = metricsMeasurer.width(text, t.size, 0);
      const left = t.anchor === 'middle' ? t.x - width / 2 : t.anchor === 'end' ? t.x - width : t.x;
      const y = t.y - t.size * 0.35;
      out.push({ left, right: left + width, top: y - t.size / 2, bottom: y + t.size / 2, text });
    }
  }
  return out;
}

interface Category {
  id: string;
  // The bone of the category, then the bones of its causes and twigs: one move and one line each.
  bones: number[][];
  // The box holding its name.
  box: { x: number; y: number; w: number; h: number };
  texts: SceneText[];
}

// Each segment of a path of straight lines, as [x0, y0, x1, y1].
function segments(cmds: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < cmds.length; i += 6) out.push([cmds[i + 1], cmds[i + 2], cmds[i + 4], cmds[i + 5]]);
  return out;
}

function categories(scene: Scene): Category[] {
  return items(scene, 'pele-ishikawa-category').map((item) => {
    const own = shapesOf(scene, item);
    const bones = own.find((sh) => sh.kind === 'stroke' && sh.paint === 'var(--_l)')!;
    const { box } = own.find((sh) => sh.kind === 'fill' && sh.paint === 'var(--_s)')!;
    return { id: item.id, bones: segments(bones.cmds), box: { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }, texts: textsOf(scene, item) };
  });
}

function spine(scene: Scene): { from: number; to: number; y: number } {
  const line = scene.shapes.find((sh) => sh.item < 0 && sh.kind === 'stroke' && sh.paint === 'var(--_l)')!;
  return { from: line.cmds[1], y: line.cmds[2], to: line.cmds[4] };
}

describe('Ishikawa diagram rendering', () => {
  it('renders every corpus input, as a scene a host can take', () => {
    expect(corpus.length).toBeGreaterThan(0);
    for (const src of corpus) {
      const result = draw(src);
      assertSafe(result, src);
      expect(textOf(result.scene)).not.toMatch(/NaN|undefined|Infinity/);
      expect(draw(src).scene).toEqual(result.scene);
    }
  });

  it('is detected under both keywords, supported and typed', () => {
    for (const keyword of ['ishikawa-beta', 'ishikawa', 'Ishikawa-Beta']) {
      const src = `${keyword}\n  Effect\n    Cause\n`;
      expect(detectType(src)).toBe('ishikawa');
      expect(supports(src)).toBe(true);
      expect(draw(src).type).toBe('ishikawa');
    }
    const model = parse('ishikawa-beta\n  Effect\n    Cause\n      Sub\n');
    expect(model.type).toBe('ishikawa');
    if (model.type === 'ishikawa') {
      expect(model.root).toEqual({ text: 'Effect', children: [{ text: 'Cause', children: [{ text: 'Sub', children: [] }] }] });
    }
  });

  it('puts the effect in a head at the right end of a level spine', () => {
    const { scene } = drawOf('  Late delivery\n    People\n    Process\n');
    const s = spine(scene);
    expect(s.to).toBeGreaterThan(s.from);
    const head = itemById(scene, 'Late delivery', 'pele-ishikawa-head')!;
    expect(head).toBeDefined();
    expect(textsOf(scene, head).map((t) => [lineOf(t), t.weight])).toEqual([['Late delivery', 700]]);
    // The head starts where the spine's arrowhead ends, and every category is to its left.
    expect(head.box!.x0).toBeCloseTo(s.to + 7, 1);
    for (const category of categories(scene)) expect(category.box.x + category.box.w).toBeLessThan(head.box!.x0 + 1);
    // An arrowhead for the spine and one for each category.
    expect(scene.shapes.filter((sh) => sh.kind === 'fill' && sh.paint === 'var(--_l)')).toHaveLength(3);
  });

  it('draws only the head when the effect has no causes', () => {
    const { scene } = drawOf('  Just an effect\n');
    expect(items(scene, 'pele-ishikawa-category')).toHaveLength(0);
    expect(items(scene, 'pele-ishikawa-head')).toHaveLength(1);
    expect(spine(scene).to).toBeGreaterThan(spine(scene).from);
  });

  it('draws nothing but the frame when there is no effect', () => {
    const result = draw('ishikawa-beta%% only a comment');
    expect(items(result.scene, 'pele-ishikawa-head')).toHaveLength(0);
    expect(result.width).toBeGreaterThan(0);
  });

  it('hangs the categories off the spine by turns above and below it, slanting away from the head', () => {
    const { scene } = drawOf('  E\n    One\n    Two\n    Three\n    Four\n    Five\n');
    const s = spine(scene);
    const all = categories(scene);
    expect(all.map((c) => c.id)).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
    all.forEach((category, i) => {
      const [x0, y0, x1, y1] = category.bones[0];
      // It starts at the spine and ends farther from it and farther from the head.
      expect(Math.abs(y0 - s.y)).toBeLessThan(8);
      expect(x1).toBeLessThan(x0);
      if (i % 2 === 0) expect(y1).toBeLessThan(s.y);
      else expect(y1).toBeGreaterThan(s.y);
      // Its name sits in a box at the far end.
      expect(category.box.x + category.box.w / 2).toBeCloseTo(x1, 1);
      if (i % 2 === 0) expect(category.box.y + category.box.h).toBeCloseTo(y1, 1);
      else expect(category.box.y).toBeCloseTo(y1, 1);
    });
    // A pair shares its place on the spine, and each pair is farther from the head than the last.
    const starts = all.map((c) => c.bones[0][0]);
    expect(starts[0]).toBeCloseTo(starts[1], 1);
    expect(starts[2]).toBeCloseTo(starts[3], 1);
    expect(starts[2]).toBeLessThan(starts[0] - 20);
    expect(starts[4]).toBeLessThan(starts[2] - 20);
  });

  it('makes the spine longer for more and for larger categories', () => {
    const length = (src: string): number => {
      const s = spine(drawOf(src).scene);
      return s.to - s.from;
    };
    const two = length('  E\n    A\n    B\n');
    const six = length('  E\n    A\n    B\n    C\n    D\n    F\n    G\n');
    const wide = length('  E\n    A\n      A cause with a long description\n    B\n    C\n    D\n    F\n    G\n');
    expect(six).toBeGreaterThan(two + 60);
    expect(wide).toBeGreaterThan(six + 100);
  });

  it('draws causes as level bones off their category and sub-causes as slanted twigs off those', () => {
    const { scene } = drawOf('  E\n    Cat\n      Cause\n        Sub one\n        Sub two\n      Other\n');
    const [category] = categories(scene);
    const level = category.bones.filter(([, y0, , y1]) => y0 === y1);
    // The category's bone, two level bones and two twigs.
    expect(category.bones).toHaveLength(5);
    expect(level).toHaveLength(2);
    expect(category.bones.length - level.length).toBe(3);
    expect(category.texts.map(lineOf)).toContain('Cause');
    expect(category.texts.find((t) => lineOf(t) === 'Sub one')!.paint).toBe('var(--_m)');
    // A cause with sub-causes has a longer bone than one without, to hold their twigs.
    const lengths = level.map(([x0, , x1]) => x0 - x1);
    expect(Math.max(...lengths)).toBeGreaterThan(Math.min(...lengths) + 20);
  });

  it('reads the causes of a category from the top down on both sides of the spine', () => {
    const { scene } = drawOf('  E\n    Above\n      first\n      second\n      third\n    Below\n      first\n      second\n      third\n');
    const boxes = textBoxes(scene);
    for (const side of [boxes.slice(0, 3), boxes.slice(3)]) {
      const byY = [...side].sort((a, b) => a.top - b.top).map((b) => b.text);
      expect(byY).toEqual(['first', 'second', 'third']);
    }
  });

  it('never lets two texts overlap, and keeps all of them off the category boxes and inside the picture', () => {
    const outlines = [
      DOC,
      'ishikawa-beta\n  E\n    A\n      a1\n        a11\n          a111\n            a1111\n          a112\n        a12\n      a2\n    B\n      b1\n      b2\n      b3\n    C\n    D\n      d1\n        d11\n        d12\n        d13\n      d2\n        d21\n    F\n      a rather long cause that goes on\n        and a long sub cause as well\n',
      'ishikawa-beta\n  E\n' + Array.from({ length: 9 }, (_, c) => `    Category ${c}\n` + Array.from({ length: 1 + (c % 4) }, (_, k) => `      Cause ${c}.${k}\n        Sub ${c}.${k}.a\n        Sub ${c}.${k}.b\n`).join('')).join(''),
    ];
    for (const src of outlines) {
      const { scene } = draw(src);
      const boxes = textBoxes(scene);
      expect(boxes.length).toBeGreaterThan(8);
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        expect(a.left).toBeGreaterThanOrEqual(scene.x);
        expect(a.bottom).toBeLessThanOrEqual(scene.y + scene.h);
        expect(a.top).toBeGreaterThanOrEqual(scene.y);
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j];
          const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          expect(apart, `${a.text} and ${b.text}`).toBe(true);
        }
        for (const category of categories(scene)) {
          const box = category.box;
          const apart = a.right <= box.x || box.x + box.w <= a.left || a.bottom <= box.y || box.y + box.h <= a.top;
          expect(apart, `${a.text} and the box of ${category.id}`).toBe(true);
        }
      }
      const all = categories(scene);
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i].box;
          const b = all[j].box;
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${all[i].id} and ${all[j].id}`).toBe(true);
        }
      }
    }
  });

  it('wraps long text', () => {
    const { scene } = drawOf('  An effect described at such length that it has to be wrapped\n    A category with a name that is long as well\n      A cause that takes a good many words to state in full\n');
    expect(textsOf(scene, items(scene, 'pele-ishikawa-head')[0]).length).toBeGreaterThan(1);
    expect(textBoxes(scene).length).toBeGreaterThan(1);
  });

  it('nests by indentation relative to the first cause', () => {
    const model = parse('ishikawa-beta\n        Problem\n  A\n      A1\n    A2\n  B\n C\n');
    if (model.type !== 'ishikawa') throw new Error('wrong type');
    const outline = (node: { text: string; children: unknown[] }): unknown => [node.text, ...(node.children as { text: string; children: unknown[] }[]).map(outline)];
    expect(outline(model.root!)).toEqual(['Problem', ['A', ['A1'], ['A2']], ['B'], ['C']]);
  });

  it('draws the front matter title above the diagram', () => {
    const { scene } = draw('---\ntitle: Root causes\n---\nishikawa-beta\n  Effect\n    Cause\n');
    const title = scene.texts.find((t) => lineOf(t) === 'Root causes')!;
    expect(title).toBeDefined();
    expect(title.item).toBe(-1);
    for (const item of items(scene)) expect(item.box!.y0).toBeGreaterThan(title.y);
  });

  it('rejects what Mermaid rejects', () => {
    // A blank line between the keyword and an indented effect is one, as is the keyword alone.
    for (const src of ['ishikawa-beta', 'ishikawa-beta\n\n  Effect\n']) {
      expect(() => draw(src)).toThrow(PeleError);
    }
    expect(items(draw('ishikawa-beta\n').scene, 'pele-ishikawa-head')).toHaveLength(0);
    expect(() => draw('ishikawa-beta\n  Effect\n  ishikawa again\n')).toThrow(/Expecting 'SPACELINE', 'NL', 'EOF', 'TEXT', got 'ISHIKAWA'/);
  });
});
