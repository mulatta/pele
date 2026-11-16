import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { Box, Scene, SceneItem, SceneShape } from '../../src/draw/scene.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { draw, itemById, items, lines, sceneProblem, shapesOf, textOf } from '../support/scene.js';

// What is drawn, without where in the source each part was written.
const picture = (scene: Scene): string => JSON.stringify([scene.shapes, scene.texts]);

// The boxes a period draws: its own, then one for each event under it. The dot on the line is
// round, so it is left out.
const boxesOf = (scene: Scene, period: SceneItem): { box: Box; shape: SceneShape }[] =>
  shapesOf(scene, period)
    .filter((s) => s.kind === 'fill' && s.cmds[3] === 1)
    .map((shape) => ({ box: shape.box, shape }));

// The events of a period are the boxes drawn faint.
const eventsOf = (scene: Scene, period: SceneItem): Box[] =>
  boxesOf(scene, period)
    .filter(({ shape }) => shape.opacity < 1)
    .map(({ box }) => box);

// The dots on the line are the circles with an outline in the background colour.
const dots = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'stroke' && s.paint === 'var(--_bg)');

// The line the periods hang on is the only stroke of no item in the line colour.
const axes = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'stroke' && s.item === -1 && s.paint === 'var(--_l)');

// The arrow at its end.
const markers = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'fill' && s.item === -1 && s.paint === 'var(--_l)');

const SOCIAL = 'timeline\n  title History of Social Media\n  2002 : LinkedIn\n  2004 : Facebook : Google\n  2005 : YouTube\n';

describe('timeline rendering', () => {
  it('draws a title, a period per time period, and its events beneath', () => {
    const { scene, type, links } = draw(SOCIAL);
    expect(type).toBe('timeline');
    expect(supports(SOCIAL)).toBe(true);
    expect(links).toEqual([]);
    expect(lines(scene)).toContain('History of Social Media');
    const periods = items(scene, 'pele-period');
    expect(periods).toHaveLength(3);
    expect(periods.map((p) => eventsOf(scene, p).length)).toEqual([1, 2, 1]);
    expect(dots(scene)).toHaveLength(3);
    expect(axes(scene)).toHaveLength(1);
    expect(markers(scene)).toHaveLength(1);
    expect(lines(scene)).toEqual(['History of Social Media', '2002', 'LinkedIn', '2004', 'Facebook', 'Google', '2005', 'YouTube']);
    expect(itemById(scene, '2004', 'pele-period')).toBeDefined();
  });

  it('places periods left to right and events below their period', () => {
    const { scene } = draw(SOCIAL);
    // 2002, LinkedIn, 2004, Facebook, Google, 2005, YouTube
    const [x, y] = [
      (b: Box) => b.x0,
      (b: Box) => b.y0,
    ].map((at) => items(scene, 'pele-period').flatMap((p) => boxesOf(scene, p).map(({ box }) => at(box))));
    expect(x[0]).toBe(x[1]);
    expect(x[2]).toBeGreaterThan(x[0]);
    expect(x[3]).toBe(x[2]);
    expect(x[4]).toBe(x[2]);
    expect(x[5]).toBeGreaterThan(x[2]);
    expect(y[2]).toBe(y[0]);
    expect(y[1]).toBeGreaterThan(y[0]);
    expect(y[4]).toBeGreaterThan(y[3]);
  });

  it('gives each period its own series color, or one color with disableMulticolor', () => {
    const colors = (scene: Scene): string[] => items(scene, 'pele-period').map((p) => shapesOf(scene, p)[0].paint);
    expect(colors(draw(SOCIAL).scene).map((c) => /series-(\d)/.exec(c)![1])).toEqual(['1', '2', '3']);
    const single = draw('---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\n' + SOCIAL).scene;
    expect(new Set(colors(single)).size).toBe(1);
    expect(colors(single)[0]).toMatch(/series-1,/);
    const directive = draw('%%{init: {"timeline": {"disableMulticolor": true}}}%%\n' + SOCIAL).scene;
    expect(picture(directive)).toBe(picture(draw(SOCIAL, { config: { timeline: { disableMulticolor: true } } }).scene));
    expect(new Set(colors(directive)).size).toBe(1);
  });

  it('colors by section and draws a header over each section', () => {
    const { scene } = draw('timeline\n  section One\n    A : a\n    B : b\n  section Two\n    C : c\n');
    expect(items(scene, 'pele-section')).toHaveLength(2);
    expect(itemById(scene, 'One', 'pele-section')).toBeDefined();
    expect(lines(scene)).toContain('One');
    expect(scene.shapes.some((s) => s.paint.includes('series-3,'))).toBe(false);
    const header = shapesOf(scene, itemById(scene, 'One', 'pele-section')!)[0];
    const a = shapesOf(scene, itemById(scene, 'A', 'pele-period')!)[0];
    const b = shapesOf(scene, itemById(scene, 'B', 'pele-period')!)[0];
    expect(header.box.x0).toBe(a.box.x0);
    expect(header.box.x1).toBe(b.box.x1);
    expect(a.paint).toBe(header.paint);
    expect(b.paint).toBe(header.paint);
  });

  it('keeps periods that come before the first section, and gives each section its own periods', () => {
    const { scene } = draw('timeline\n  Early : e\n  section Same\n    A\n  section Empty\n  section Same\n    B\n');
    expect(items(scene, 'pele-period')).toHaveLength(3);
    expect(items(scene, 'pele-section')).toHaveLength(3);
    expect(shapesOf(scene, itemById(scene, 'Early', 'pele-period')!)[0].paint).toBe('var(--_m)');
    expect(lines(scene).indexOf('Early')).toBeLessThan(lines(scene).indexOf('Same'));
  });

  it('runs top to bottom with TD', () => {
    const lr = draw(SOCIAL);
    const td = draw(SOCIAL.replace('timeline', 'timeline TD'));
    expect(picture(draw(SOCIAL.replace('timeline', 'timeline LR')).scene)).toBe(picture(lr.scene));
    expect(td.height).toBeGreaterThan(lr.height);
    expect(td.width).toBeLessThan(lr.width);
    const periods = items(td.scene, 'pele-period');
    expect(periods).toHaveLength(3);
    expect(periods.reduce((n, p) => n + eventsOf(td.scene, p).length, 0)).toBe(4);
    const [first, second] = periods.map((p) => boxesOf(td.scene, p)[0].box);
    expect(second.y0).toBeGreaterThan(first.y0);
    // Events sit to the right of their period.
    const [event] = eventsOf(td.scene, periods[0]);
    expect(event.x0).toBeGreaterThan(first.x0);
  });

  it('runs the line from a period to its first event straight, TD, whichever box is taller', () => {
    const source = 'timeline TD\n  2002 : LinkedIn\n  2004 : Facebook : Google\n  2005<br>and on<br>and on : YouTube\n  2006 : first<br>second<br>third<br>fourth\n';
    const { scene } = draw(source);
    const middle = (b: Box): number => (b.y0 + b.y1) / 2;
    const rows = items(scene, 'pele-period');
    expect(rows).toHaveLength(4);
    let above = 0;
    for (const row of rows) {
      const boxes = boxesOf(scene, row).map(({ box }) => box);
      const [period, event] = boxes;
      expect(middle(event)).toBe(middle(period));
      // The line is a stub out of the period and one into the event; the first is level with both.
      const stub = shapesOf(scene, row).find((s) => s.kind === 'stroke' && s.paint === 'var(--_b)')!;
      expect([stub.cmds[2], stub.cmds[8]]).toEqual([middle(period), middle(period)]);
      expect(Math.min(...boxes.map((b) => b.y0))).toBeGreaterThan(above);
      above = Math.max(...boxes.map((b) => b.y1));
    }
  });

  it('breaks lines at <br> and wraps long text to the column', () => {
    const one = draw('timeline\n  2001 : first second\n');
    const two = draw('timeline\n  2001 : first<br>second\n');
    expect(two.height).toBeGreaterThan(one.height);
    expect(two.width).toBe(one.width);
    expect(lines(two.scene)).toEqual(['2001', 'first', 'second']);
    expect(lines(draw('timeline\n  2001 : a<br/>b<br />c\n').scene)).toEqual(['2001', 'a', 'b', 'c']);
    const long = draw('timeline\n  2001 : ' + 'several words that go on '.repeat(6) + '\n');
    expect(long.width).toBe(one.width);
    expect(lines(long.scene).length).toBeGreaterThan(6);
    for (const line of lines(long.scene)) expect(metricsMeasurer.width(line, 14, 0)).toBeLessThanOrEqual(152);
  });

  it('widens columns for a long word, then cuts it', () => {
    const base = draw('timeline\n  2001 : short\n');
    const word = 'Supercalifragilisticexpiali';
    expect(metricsMeasurer.width(word, 14, 0)).toBeGreaterThan(152);
    expect(metricsMeasurer.width(word, 14, 0)).toBeLessThan(216);
    const wider = draw(`timeline\n  2001 : ${word}\n`);
    const cut = draw('timeline\n  2001 : ' + 'x'.repeat(300) + '\n');
    expect(wider.width).toBeGreaterThan(base.width);
    expect(lines(wider.scene)).toEqual(['2001', word]);
    expect(cut.width).toBeLessThanOrEqual(base.width + 64);
    expect(lines(cut.scene).slice(1).join('')).toBe('x'.repeat(300));
    const [event] = eventsOf(cut.scene, items(cut.scene, 'pele-period')[0]);
    for (const line of lines(cut.scene).slice(1)) {
      expect(metricsMeasurer.width(line, 14, 0)).toBeLessThanOrEqual(event.x1 - event.x0 - 24);
    }
  });

  it('decodes entities and shows tags, links and icon names as written', () => {
    const { scene } = draw('timeline\n  2001 : #35;1 &amp; <b>bold</b> [link](http://example.com) fa:fa-check a<T>\n');
    expect(lines(scene).slice(1).join(' ')).toBe('#1 & <b>bold</b> [link](http://example.com) fa:fa-check a<T>');
    expect(scene.skipped).toEqual({});
    expect(scene.texts.every((t) => t.spans.every((s) => s.mono !== true))).toBe(true);
  });

  it('takes the title from front matter unless the diagram sets one', () => {
    expect(lines(draw('---\ntitle: From front matter\n---\ntimeline\n  2001\n').scene)).toContain('From front matter');
    const own = draw('---\ntitle: From front matter\n---\ntimeline\n  title Own\n  2001\n').scene;
    expect(lines(own)).toContain('Own');
    expect(textOf(own)).not.toContain('From front matter');
  });

  it('draws an empty timeline, a lone title, and sections without periods', () => {
    for (const src of ['timeline', 'timeline TD', 'timeline\n  title Only', 'timeline\n  section S', 'timeline TD\n  section S\n  section T']) {
      const result = draw(src);
      expect(sceneProblem(result), src).toBeUndefined();
      expect(textOf(result.scene), src).not.toMatch(/NaN|Infinity|undefined/);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(axes(result.scene), src).toHaveLength(0);
    }
  });

  it('rejects what Mermaid rejects', () => {
    expect(() => draw('timeline\n  : orphan event\n')).toThrow(PeleError);
    expect(() => draw('timeline\n  2001 :no space\n')).toThrow(/Expecting .* got 'INVALID'/);
    expect(() => draw('timeline\n  Timeline of things : x\n')).toThrow(/got 'timeline'/);
    expect(() => draw('timeline\n  accDescr {\n  never closed\n')).toThrow(PeleError);
  });

  it('treats a bare title as no title', () => {
    const model = parse('timeline\ntitle\n2024 : Event\n2025 : Next');
    expect(model.type).toBe('timeline');
    if (model.type === 'timeline') {
      expect(model.title).toBeUndefined();
      expect(model.periods.map((p) => p.text)).toEqual(['2024 ', '2025 ']);
    }
    expect(parse('timeline\n  title\u00a0Kept\n  2024 : Event').title).toBe('Kept');
  });

  it('keeps the character before a comment', () => {
    const model = parse('timeline\nA%% label : event\nB : e2');
    expect(model.type).toBe('timeline');
    if (model.type === 'timeline') expect(model.periods.map((p) => p.text)).toEqual(['A%% label ', 'B ']);
    expect(() => draw('timeline\n  2024 :%% c\n')).toThrow(/got 'INVALID'/);
  });

  it('attaches an event after a section header to the last period, as Mermaid does', () => {
    const model = parse('timeline\n  2001 : a\n  section S\n  : b\n');
    expect(model.type).toBe('timeline');
    if (model.type === 'timeline') expect(model.periods[0].events).toEqual(['a', 'b']);
  });

  it('exposes the model', () => {
    const model = parse('timeline TD\n  title T\n  First\n  section S\n    2001 : a : b\n    2002\n');
    expect(model.type).toBe('timeline');
    if (model.type === 'timeline') {
      expect(model.title).toBe('T');
      expect(model.direction).toBe('TD');
      expect(model.sections).toEqual(['S']);
      expect(model.periods).toEqual([
        { text: 'First', events: [], section: '', sectionIndex: -1 },
        { text: '2001 ', events: ['a ', 'b'], section: 'S', sectionIndex: 0 },
        { text: '2002', events: [], section: 'S', sectionIndex: 0 },
      ]);
    }
  });

  it('is deterministic', () => {
    expect(draw(SOCIAL)).toEqual(draw(SOCIAL));
  });
});
