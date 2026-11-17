import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import type { Scene, SceneShape } from '../../src/draw/scene.js';
import { assertSafe, draw, itemById, items, lines, textOf } from '../support/scene.js';

const series = (s: SceneShape): string | undefined => /^var\(--pele-series-(\d)/.exec(s.paint)?.[1];
// A face is five shapes in a row: a disc, its outline, two eyes and a mouth, none of them items.
const faces = (scene: Scene): number[] => scene.shapes.flatMap((s, i) => (s.item === -1 && s.kind === 'fill' && s.paint === 'var(--_bg)' ? [i] : []));
const faceY = (scene: Scene): number[] => faces(scene).map((i) => scene.shapes[i].box.y0);
// A straight mouth is neutral; a curved one smiles or frowns by the way it is swept.
const moods = (scene: Scene): string[] =>
  faces(scene).map((i) => {
    const { cmds } = scene.shapes[i + 4];
    return cmds.length === 6 ? 'neutral' : cmds[8] === 0 ? 'happy' : 'sad';
  });
// The dots that mark actors on tasks, and the ones of the legend.
const dotsOn = (scene: Scene, cls: string): SceneShape[] =>
  scene.shapes.filter((s) => s.kind === 'fill' && series(s) !== undefined && s.item >= 0 && scene.items[s.item].kind.split(' ').includes(cls));

const DAY =
  'journey\n  title My working day\n  section Go to work\n    Make tea: 5: Me\n    Go upstairs: 3: Me\n    Do work: 1: Me, Cat\n  section Go home\n    Go downstairs: 5: Me\n    Sit down: 5: Me\n';

describe('journey rendering', () => {
  it('draws a title, section bands, a card and a face per task, and a legend of actors', () => {
    const { scene, type, links } = draw(DAY);
    expect(type).toBe('journey');
    expect(supports(DAY)).toBe(true);
    expect(links).toEqual([]);
    expect(lines(scene)).toContain('My working day');
    expect(items(scene, 'pele-section').length).toBe(2);
    expect(items(scene, 'pele-task').length).toBe(5);
    expect(moods(scene)).toEqual(['happy', 'neutral', 'sad', 'happy', 'happy']);
    expect(dotsOn(scene, 'pele-task').length).toBe(6);
    expect(items(scene, 'pele-legend-item').length).toBe(2);
    expect(itemById(scene, 'Go to work')).toBeDefined();
    expect(itemById(scene, 'Make tea')).toBeDefined();
    expect(lines(scene)).toContain('Do work');
  });

  it('places each face by its score', () => {
    const ys = faceY(draw('journey\n  a: 5\n  b: 4\n  c: 3\n  d: 2\n  e: 1\n').scene);
    expect(ys.length).toBe(5);
    for (let i = 1; i < 5; i++) expect(ys[i] - ys[i - 1]).toBe(ys[1] - ys[0]);
    expect(ys[1]).toBeGreaterThan(ys[0]);
  });

  it('keeps odd scores on the scale: out of range is clamped, not a number is neutral', () => {
    const { scene } = draw('journey\n  top: 5\n  mid: 3\n  low: 1\n  big: 100\n  neg: -7\n  zero: 0\n  word: abc\n  blank: \n  half: 3.5\n  inf: Infinity\n');
    const ys = faceY(scene);
    const [top, mid, low] = ys;
    expect(ys.slice(3)).toEqual([top, low, low, mid, low, (top + mid) / 2 + (mid - top) / 4, top]);
    expect(moods(scene)).toEqual(['happy', 'neutral', 'sad', 'happy', 'sad', 'sad', 'neutral', 'sad', 'happy', 'happy']);
  });

  it('draws a different mouth for each mood', () => {
    const { scene } = draw('journey\n  a: 5\n  b: 3\n  c: 1\n');
    const mouths = faces(scene).map((i) => JSON.stringify(scene.shapes[i + 4].cmds));
    expect(new Set(mouths).size).toBe(3);
  });

  it('colors actors by their place in the sorted list and marks them on each task', () => {
    const { scene } = draw(DAY);
    const legend = dotsOn(scene, 'pele-legend-item').map((s) => [scene.items[s.item].id, series(s)]);
    expect(legend).toEqual([['Cat', '1'], ['Me', '2']]);
    expect(dotsOn(scene, 'pele-task').map(series)).toEqual(['2', '2', '2', '1', '2', '2']);
  });

  it('leaves out the nameless actor of a task that ends in a colon', () => {
    const { scene } = draw('journey\n  a: 5:\n  b: 3: , Real,\n');
    expect(dotsOn(scene, 'pele-task').length).toBe(1);
    expect(items(scene, 'pele-legend-item').length).toBe(1);
    expect(items(draw('journey\n  a: 5:\n').scene, 'pele-legend-item')).toEqual([]);
  });

  it('spans each section band over its run of tasks, and draws no band for empty or missing sections', () => {
    const { scene } = draw('journey\n  first: 3\n  section A\n  section B\n    b1: 3\n    b2: 3\n  section C\n    c1: 3\n  section D\n');
    expect(items(scene, 'pele-section').map((i) => i.id)).toEqual(['B', 'C']);
    expect(lines(scene)).not.toContain('A');
    expect(lines(scene)).not.toContain('D');
    const band = itemById(scene, 'B')!.box!;
    const first = itemById(scene, 'first')!.box!;
    const b1 = itemById(scene, 'b1')!.box!;
    const b2 = itemById(scene, 'b2')!.box!;
    expect(band.x0).toBe(b1.x0);
    expect(band.x1).toBe(b2.x1);
    expect(band.y0).toBeLessThan(b1.y0);
    expect(first.y0).toBe(b1.y0);
  });

  it('merges consecutive sections of the same name into one band, as Mermaid does', () => {
    const { scene } = draw('journey\n  section A\n    a: 3\n  section A\n    b: 3\n  section B\n    c: 3\n  section A\n    d: 3\n');
    expect(items(scene, 'pele-section').length).toBe(3);
  });

  it('breaks lines at <br>, wraps long task names, and cuts long words', () => {
    const one = draw('journey\n  first second: 3\n');
    const two = draw('journey\n  first<br>second: 3\n');
    expect(two.height).toBeGreaterThan(one.height);
    expect(lines(two.scene).slice(5)).toEqual(['first', 'second']);
    const long = draw('journey\n  ' + 'several words that go on '.repeat(4) + ': 3\n');
    expect(long.width).toBe(one.width);
    const cut = draw('journey\n  ' + 'x'.repeat(200) + ': 3\n');
    expect(cut.width).toBeLessThanOrEqual(one.width + 80);
    const card = items(cut.scene, 'pele-task')[0].box!;
    const pieces = lines(cut.scene).filter((line) => line.startsWith('x'));
    expect(pieces.join('')).toBe('x'.repeat(200));
    for (const line of pieces) expect(metricsMeasurer.width(line, 14, 0)).toBeLessThanOrEqual(card.x1 - card.x0 - 20);
  });

  it('shows tags and icon names as written', () => {
    const { scene } = draw('journey\n  title fa:fa-check <u>T</u>\n  <b>bold</b> a<T>: 3: <i>Me</i>\n');
    expect(textOf(scene)).toContain('<u>T</u>');
    expect(textOf(scene)).toContain('<b>bold</b>');
    expect(textOf(scene)).toContain('fa:fa-check');
    expect(textOf(scene)).toContain('a<T>');
    expect(lines(scene)).toContain('<i>Me</i>');
    expect(items(scene, 'pele-icon')).toEqual([]);
  });

  it('keeps many actors inside their card', () => {
    const { scene } = draw('journey\n  crowd: 3: ' + Array.from({ length: 60 }, (_, i) => `p${i}`).join(',') + '\n');
    const card = items(scene, 'pele-task')[0].box!;
    const dots = dotsOn(scene, 'pele-task');
    expect(dots.length).toBe(60);
    for (const dot of dots) {
      expect(dot.box.x0).toBeGreaterThanOrEqual(card.x0);
      expect(dot.box.x1).toBeLessThanOrEqual(card.x1);
    }
  });

  it('keeps the legend inside the drawing', () => {
    const { scene, width } = draw('journey\n  one: 3: ' + Array.from({ length: 40 }, (_, i) => `Person number ${i}`).join(',') + '\n');
    const rows = new Set<number>();
    for (const dot of dotsOn(scene, 'pele-legend-item')) {
      rows.add(dot.box.y0);
      expect(dot.box.x0).toBeGreaterThan(0);
      expect(dot.box.x1).toBeLessThan(width);
    }
    expect(rows.size).toBeGreaterThan(5);
  });

  it('takes the title from front matter unless the diagram sets one', () => {
    expect(lines(draw('---\ntitle: From front matter\n---\njourney\n  a: 3\n').scene)).toContain('From front matter');
    const own = lines(draw('---\ntitle: From front matter\n---\njourney\n  title Own\n  a: 3\n').scene);
    expect(own).toContain('Own');
    expect(own).not.toContain('From front matter');
  });

  it('draws an empty journey, a lone title, and sections without tasks', () => {
    for (const src of ['journey', 'journey\n  title Only', 'journey\n  section S\n  section T']) {
      const result = draw(src);
      assertSafe(result, src);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.scene.shapes).toEqual([]);
    }
  });

  it('rejects what Mermaid rejects', () => {
    expect(() => draw('journey\n  A task\n')).toThrow(/Expecting 'taskData', got 'NEWLINE'/);
    expect(() => draw('journey\n  A task:\n')).toThrow(/got ':'/);
    expect(() => draw('journey\n  A; B: 3\n')).toThrow(/got 'INVALID'/);
    expect(() => draw('journey\n  : 5\n')).toThrow(PeleError);
    expect(() => draw('journey\n  accDescr {\n  never closed\n')).toThrow(PeleError);
  });

  it('treats a bare title as no title', () => {
    const model = parse('journey\ntitle\nsection Work\nTask: 5: Me');
    expect(model.type).toBe('journey');
    if (model.type === 'journey') {
      expect(model.title).toBeUndefined();
      expect(model.sections).toEqual(['Work']);
    }
    expect(parse('journey\n  title\u00a0Kept\n  Task: 5: Me').title).toBe('Kept');
  });

  it('keeps the character before a comment', () => {
    const model = parse('journey\nA%% label: 5: Me');
    expect(model.type).toBe('journey');
    if (model.type === 'journey') expect(model.tasks.map((t) => t.task)).toEqual(['A%% label']);
    expect(() => draw('journey\n  Task: 5: Me;%% c\n')).toThrow(/got 'INVALID'/);
  });

  it('exposes the model', () => {
    const model = parse('journey\n  title T\n  First: 2\n  section S\n    A task: 5: Bob, Alice\n    B task: x:\n');
    expect(model.type).toBe('journey');
    if (model.type === 'journey') {
      expect(model.title).toBe('T');
      expect(model.sections).toEqual(['S']);
      expect(model.tasks).toEqual([
        { task: 'First', score: 2, people: [], section: '' },
        { task: 'A task', score: 5, people: ['Bob', 'Alice'], section: 'S' },
        { task: 'B task', score: NaN, people: [''], section: 'S' },
      ]);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(draw(DAY).scene)).toBe(JSON.stringify(draw(DAY).scene));
  });
});
