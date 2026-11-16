import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports, type GanttModel } from '../../src/index.js';
import type { Scene } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw as drawScene, items, lineOf, lines, paints, sceneProblem, shapesOf, textOf, textsOf } from '../support/scene.js';

const NOW = new Date(2014, 0, 16, 12);
const draw = (src: string, extra: object = {}) => drawScene(src, { now: NOW, ...extra });
const json = (src: string, extra: object = {}): string => JSON.stringify(draw(src, extra).scene);

const BASIC = `gantt
  title A Gantt Diagram
  dateFormat YYYY-MM-DD
  section Section
  A task :a1, 2014-01-01, 30d
  Another task :after a1, 20d
  section Another
  Task in Another :2014-01-12, 12d
  another task :24d`;

function tasksOf(src: string, now: Date = NOW) {
  return (parse(src) as GanttModel).getTasks(now);
}

// The x position and width of each task bar, by task id.
function bars(scene: Scene): Map<string, { x: number; width: number }> {
  const out = new Map<string, { x: number; width: number }>();
  for (const task of items(scene, 'pele-task')) {
    const { box } = shapesOf(scene, task).find((h) => h.kind === 'fill')!;
    out.set(task.id, { x: box.x0, width: box.x1 - box.x0 });
  }
  return out;
}

// The x of each line drawn from top to bottom with no item of its own, which is what a today
// marker is; the grid is one dashed shape and the axis runs across.
function todayLines(scene: Scene): number[] {
  return scene.shapes
    .filter((h) => h.item === -1 && h.kind === 'stroke' && h.dash === null && h.cmds.length === 6 && h.cmds[1] === h.cmds[4] && h.cmds[2] !== h.cmds[5])
    .map((h) => h.cmds[1]);
}

// The axis labels, which belong to no item.
const ticks = (scene: Scene): string[] => scene.texts.filter((t) => t.item === -1 && t.size === 12).map(lineOf);

describe('gantt rendering', () => {
  it('draws a bar per task, a label per section, an axis, and the title', () => {
    const { scene, type, width, height } = draw(BASIC);
    expect(type).toBe('gantt');
    expect(supports(BASIC)).toBe(true);
    expect(items(scene, 'pele-task')).toHaveLength(4);
    expect(items(scene, 'pele-section-label')).toHaveLength(2);
    expect(lines(scene)).toEqual(expect.arrayContaining(['A Gantt Diagram', 'Task in Another', '2014-01-12']));
    expect(scene.shapes.some((h) => h.item === -1 && h.kind === 'stroke' && h.dash !== null)).toBe(true);
    expect(width).toBe(800);
    expect(height).toBeGreaterThan(150);
  });

  it('is deterministic for a given time', () => {
    expect(json(BASIC)).toBe(json(BASIC));
  });

  it('places bars in proportion to their dates', () => {
    const b = bars(draw('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-01, 10d\n B :b, 2024-01-06, 5d\n C :c, 2024-01-11, 10d').scene);
    const a = b.get('a')!;
    expect(b.get('b')!.x).toBeCloseTo(a.x + a.width / 2, 0);
    expect(b.get('b')!.width).toBeCloseTo(a.width / 2, 0);
    expect(b.get('c')!.x).toBeCloseTo(a.x + a.width, 0);
  });

  it('marks today only when it falls inside the chart, and never when switched off', () => {
    expect(todayLines(draw(BASIC).scene)).toHaveLength(1);
    expect(todayLines(draw(BASIC, { now: new Date(2020, 0, 1) }).scene)).toEqual([]);
    expect(todayLines(draw(BASIC.replace('dateFormat', 'todayMarker off\n  dateFormat')).scene)).toEqual([]);
  });

  it('moves the today marker with the injected time', () => {
    const at = (now: Date): number => todayLines(draw(BASIC, { now }).scene)[0];
    expect(at(new Date(2014, 0, 20))).toBeGreaterThan(at(new Date(2014, 0, 10)));
  });

  it('applies a todayMarker style, keeping only safe declarations', () => {
    const { scene } = draw(BASIC.replace('dateFormat', 'todayMarker stroke-width:5px,stroke:#0f0,opacity:0.5,background:url(x)\n  dateFormat'));
    const marker = scene.shapes.find((h) => h.item === -1 && h.paint === '#0f0')!;
    expect([marker.width, marker.opacity]).toEqual([5, 0.5]);
    expect(paints(scene).filter((p) => p.includes('url('))).toEqual([]);
  });

  it('distinguishes done, active, and critical tasks', () => {
    const { scene } = draw(
      'gantt\n dateFormat YYYY-MM-DD\n P :p, 2024-01-01, 9d\n A :active, a, 2024-01-01, 9d\n D :done, d, 2024-01-01, 9d\n C :crit, c, 2024-01-01, 9d\n CD :crit, done, cd, 2024-01-01, 9d\n CA :crit, active, ca, 2024-01-01, 9d'
    );
    // What a bar is drawn with: its fill and its outline.
    const paint = (id: string): [string, number, string] => {
      const [fill, stroke] = shapesOf(scene, items(scene).find((i) => i.id === id)!);
      return [fill.paint, fill.opacity, stroke.paint];
    };
    const all = ['p', 'a', 'd', 'c', 'cd', 'ca'].map((id) => JSON.stringify(paint(id)));
    expect(new Set(all).size).toBe(6);
    expect(paint('p')).toEqual(['var(--_c)', 1, 'var(--_c)']);
    expect(paint('a')).toEqual(['var(--_c)', 0.25, 'var(--_c)']);
    expect(paint('d')[0]).toBe('var(--_a)');
    const red = 'var(--pele-critical,#e45756)';
    expect(paint('c')).toEqual([red, 1, red]);
    expect(paint('cd')).toEqual(['var(--_a)', 1, red]);
    expect(paint('ca')).toEqual([red, 0.25, red]);
    expect(items(scene, 'pele-done').map((i) => i.id)).toEqual(['d', 'cd']);
    expect(items(scene, 'pele-crit').map((i) => i.id)).toEqual(['c', 'cd', 'ca']);
    expect(items(scene, 'pele-active').map((i) => i.id)).toEqual(['a', 'ca']);
  });

  it('draws a milestone as a diamond centered on the middle of its span', () => {
    const { scene } = draw('gantt\n dateFormat HH:mm\n axisFormat %H:%M\n M : milestone, m1, 17:49, 2m\n Task A : 10m');
    const [diamond] = shapesOf(scene, items(scene, 'pele-milestone')[0]);
    // A move and three lines, closed.
    expect([diamond.cmds[0], diamond.cmds[3], diamond.cmds[6], diamond.cmds[9], diamond.cmds[12]]).toEqual([0, 1, 1, 1, 5]);
    expect(diamond.cmds).toHaveLength(13);
    expect(items(scene, 'pele-task')).toHaveLength(2);
    expect(lines(scene)).toContain('17:50');
  });

  it('draws vertical markers as lines with labels and gives them no row', () => {
    const withVert = draw('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-01, 9d\n Deadline :vert, v, 2024-01-05, 0d');
    const without = draw('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-01, 9d');
    expect(items(withVert.scene, 'pele-vert')).toHaveLength(1);
    expect(shapesOf(withVert.scene, items(withVert.scene, 'pele-vert')[0])).toHaveLength(1);
    expect(items(withVert.scene, 'pele-task')).toHaveLength(1);
    expect(lines(withVert.scene)).toContain('Deadline');
    expect(withVert.height - without.height).toBeLessThan(30);
  });

  it('puts a label inside its bar when it fits and beside it when it does not', () => {
    const { scene } = draw('gantt\n dateFormat YYYY-MM-DD\n Short :a, 2024-01-01, 30d\n A label far too long for its bar :b, 2024-01-02, 1d');
    const b = bars(scene);
    const label = (text: string) => scene.texts.find((t) => lineOf(t) === text)!;
    const a = b.get('a')!;
    expect(label('Short').x).toBeCloseTo(a.x + a.width / 2, 0);
    expect(label('A label far too long for its bar').x).toBeGreaterThan(b.get('b')!.x + b.get('b')!.width);
    expect(label('Short').paint).toBe('var(--_bg)');
    expect(label('A label far too long for its bar').paint).not.toBe('var(--_bg)');
  });

  it('grows to fit a label that sticks out past the right edge', () => {
    const long = 'A label that is much longer than anything the plot leaves room for on either side of the bar, so the chart has to grow';
    const { scene, width } = draw(`gantt\n dateFormat YYYY-MM-DD\n ${long} :a, 2024-01-01, 1d\n B :b, 2024-01-01, 2d`);
    expect(width).toBeGreaterThan(800);
    expect(scene.w).toBe(width);
  });

  it('shades excluded days and stretches tasks over them', () => {
    const plain = draw('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-05, 3d\n B :b, 2024-01-01, 14d');
    const excl = draw('gantt\n dateFormat YYYY-MM-DD\n excludes weekends\n A :a, 2024-01-05, 3d\n B :b, 2024-01-01, 2024-01-15');
    const shades = (scene: Scene) => scene.shapes.filter((h) => h.item === -1 && h.kind === 'fill');
    expect(shades(plain.scene)).toEqual([]);
    expect(shades(excl.scene)).toHaveLength(2);
    expect(bars(excl.scene).get('a')!.width).toBeGreaterThan(bars(plain.scene).get('a')!.width * 1.5);
  });

  it('honours axisFormat, tickInterval, weekday, and topAxis', () => {
    const src = (extra: string): string => `gantt\n dateFormat YYYY-MM-DD\n${extra} A :a, 2024-01-01, 30d\n`;
    const weekly = ticks(draw(src(' tickInterval 1week\n weekday monday\n axisFormat %a %e %b\n')).scene);
    expect(weekly).toEqual(expect.arrayContaining(['Mon  1 Jan', 'Mon  8 Jan']));
    expect(weekly.filter((t) => t.startsWith('Sun'))).toEqual([]);
    expect(ticks(draw(src(' tickInterval 1week\n axisFormat %a %d\n')).scene)).toContain('Sun 07');
    const plain = draw(src(''));
    const top = draw(src(' topAxis\n'));
    const dates = (scene: Scene): number => ticks(scene).filter((t) => /^2024-01-0\d$/.test(t)).length;
    expect(top.height).toBeGreaterThan(plain.height);
    expect(dates(top.scene)).toBe(2 * dates(plain.scene));
    // The line that sets the interval moves the source lines of the tasks; what is drawn stays.
    const drawn = (scene: Scene): string => JSON.stringify([scene.shapes, scene.texts]);
    expect(drawn(draw(src(' tickInterval 1decade\n')).scene)).toBe(drawn(plain.scene));
  });

  it('falls back to automatic ticks when an interval would give too many', () => {
    const { scene } = draw('gantt\n dateFormat YYYY-MM-DD\n tickInterval 1second\n A :a, 2024-01-01, 300d\n');
    expect(ticks(scene).filter((t) => /^\d{4}-\d\d-\d\d$/.test(t)).length).toBeLessThan(20);
  });

  it('uses day numbers on the axis for the D date format', () => {
    expect(ticks(draw('gantt\n dateFormat D\n A :a, 5, 9\n').scene).some((t) => /^0[5-9]$/.test(t))).toBe(true);
  });

  it('reads gantt settings from the configuration', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n section S\n A :a, 2024-01-01, 30d\n B :b, 2024-01-10, 30d\n';
    const config = (yaml: string): string => `---\nconfig:\n  gantt:\n${yaml}---\n${src}`;
    const plain = draw(src);
    expect(draw(config('    barHeight: 60\n')).height).toBeGreaterThan(plain.height + 60);
    expect(draw(config('    barGap: 40\n')).height).toBeGreaterThan(plain.height + 60);
    expect(draw(config('    useWidth: 1200\n')).width).toBe(1200);
    expect(draw(config('    topAxis: true\n')).height).toBeGreaterThan(plain.height);
    expect(draw(config('    topPadding: 120\n')).height).toBeGreaterThan(plain.height + 80);
    expect(ticks(draw(config('    axisFormat: "%d/%m"\n')).scene)).toContain('07/01');
    expect(ticks(draw(config('    tickInterval: 1week\n    weekday: wednesday\n    axisFormat: "%a"\n')).scene)).toContain('Wed');
    const sized = draw(config('    fontSize: 20\n')).scene;
    expect(textsOf(sized, items(sized, 'pele-task')[0]).map((t) => t.size)).toEqual([20]);
    const sections = draw(config('    sectionFontSize: 22\n')).scene;
    expect(textsOf(sections, items(sections, 'pele-section-label')[0]).map((t) => t.size)).toEqual([22]);
    expect(bars(draw(config('    leftPadding: 300\n')).scene).get('a')!.x).toBeGreaterThan(300);
    expect(sceneProblem(draw(config('    barHeight: "tall"\n    fontSize: -5\n    useWidth: .inf\n')))).toBeUndefined();
  });

  it('packs tasks that do not overlap onto one row in compact mode', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n section Section\n A :a1, 2014-01-01, 30d\n B :a2, 2014-01-20, 25d\n C :a3, 2014-02-10, 20d\n';
    const plain = draw(src);
    const compact = draw('---\ndisplayMode: compact\n---\n' + src);
    const viaConfig = draw('---\nconfig:\n  gantt:\n    displayMode: compact\n---\n' + src);
    expect(compact.height).toBeLessThan(plain.height);
    expect(viaConfig.height).toBe(compact.height);
    expect(items(compact.scene, 'pele-task')).toHaveLength(3);
    expect((parse('---\ndisplayMode: compact\n---\n' + src) as GanttModel).displayMode).toBe('compact');
  });

  it('links a task that has an href and never emits a callback', () => {
    const { scene, links } = draw(
      'gantt\n dateFormat YYYY-MM-DD\n A :cl1, 2014-01-07, 3d\n B :cl2, after cl1, 3d\n click cl1 href "https://mermaidjs.github.io/"\n click cl2 call printArguments("test1", test3)\n'
    );
    expect(links).toEqual([{ id: 'cl1', href: 'https://mermaidjs.github.io/', internal: false }]);
    expect(textOf(scene)).not.toContain('printArguments');
    expect(items(scene, 'pele-clickable')).toHaveLength(2);
  });

  it('ignores a link to a task defined after the click statement, as Mermaid does', () => {
    expect(draw('gantt\n dateFormat YYYY-MM-DD\n click a href "https://example.com"\n A :a, 2014-01-07, 3d\n').links).toEqual([]);
  });

  it('takes the title from front matter unless the chart sets one', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n A :a, 2014-01-07, 3d\n';
    expect(lines(draw('---\ntitle: From front matter\n---\n' + src).scene)).toContain('From front matter');
    const own = lines(draw('---\ntitle: From front matter\n---\n' + src.replace('gantt\n', 'gantt\n title Own\n')).scene);
    expect(own).toContain('Own');
    expect(own).not.toContain('From front matter');
  });

  it('treats a bare title as no title and keeps a title after a tab', () => {
    const model = parse('gantt\ntitle\nsection Work\nTask :2026-01-01, 1d') as GanttModel;
    expect(model.title).toBeUndefined();
    expect(model.getTasks(NOW).map((task) => [task.task, task.section])).toEqual([['Task ', 'Work']]);
    expect((parse('gantt\ntitle\tPlan\n') as GanttModel).title).toBe('Plan');
  });

  it('breaks section names at <br> and keeps task names on one line', () => {
    const { scene } = draw('gantt\n dateFormat YYYY-MM-DD\n section One<br>Two\n First<br/>second :a, 2014-01-07, 30d\n');
    expect(textsOf(scene, items(scene, 'pele-section-label')[0]).map(lineOf)).toEqual(['One', 'Two']);
    expect(lines(scene)).toContain('First second');
  });

  it('draws icons named in section names', () => {
    const { scene } = draw('gantt\n dateFormat YYYY-MM-DD\n section fa:fa-flag Launch\n Done :a, 2014-01-07, 30d\n', {
      icons: (name: string) => (name === 'fa:fa-flag' ? '<path d="M4 12l5 5L20 6"/>' : null),
    });
    const section = items(scene, 'pele-section-label')[0];
    expect(shapesOf(scene, section).map((h) => [h.kind, h.paint])).toEqual([['stroke', 'var(--_fg)']]);
    expect(textsOf(scene, section).map(lineOf)).toEqual([' Launch']);
  });

  it('renders a chart with no tasks, and one with only a title', () => {
    const empty = draw('gantt').scene;
    expect([empty.items, empty.texts]).toEqual([[], []]);
    expect(lines(draw('gantt\n title Empty\n tickInterval 1week\n weekday monday').scene)).toContain('Empty');
  });

  it('renders zero-length charts and tasks without NaN', () => {
    for (const src of [
      'gantt\n dateFormat YYYY-MM-DD\n M :milestone, m, 2014-01-07, 0d\n',
      'gantt\n dateFormat YYYY-MM-DD\n A :a, 2014-01-07, 0d\n B :b, 2014-01-07, bogus\n',
      'gantt\n dateFormat x\n A :a, 0, 0ms\n',
    ]) {
      const result = draw(src);
      expect(sceneProblem(result), src).toBeUndefined();
      expect(textOf(result.scene)).not.toMatch(/NaN|Infinity|undefined/);
      expect(items(result.scene, 'pele-task').length).toBeGreaterThan(0);
    }
  });

  it('renders every documentation example', () => {
    for (const src of loadCorpus('gantt', /^\s*(---[\s\S]*---\s*)?gantt/)) {
      let result;
      try {
        result = draw(src);
      } catch (error) {
        expect(error, src).toBeInstanceOf(PeleError);
        continue;
      }
      assertSafe(result, src);
      expect(textOf(result.scene), src).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe('gantt scheduling', () => {
  it('starts a task with no start, and nothing before it, today', () => {
    const [task] = tasksOf('gantt\n dateFormat YYYY-MM-DD\n A :3d\n');
    expect(task.startTime).toEqual(new Date(2014, 0, 16));
    expect(task.endTime).toEqual(new Date(2014, 0, 19));
  });

  it('uses the injected time for unknown references and for fields a format leaves out', () => {
    const tasks = tasksOf('gantt\n dateFormat HH:mm\n A :a, 17:49, 2m\n B :b, after nothing, 1h\n', new Date(2031, 4, 6, 9, 30));
    expect(tasks[0].startTime).toEqual(new Date(2031, 4, 6, 17, 49));
    expect(tasks[1].startTime).toEqual(new Date(2031, 4, 6));
  });

  it('gives the same result each time it is asked', () => {
    const model = parse('gantt\n dateFormat YYYY-MM-DD\n B :b, 2024-01-01, 2d\n X :x, after b a, 1d\n A :a, 2024-01-10, 5d\n') as GanttModel;
    const first = model.getTasks(NOW).map((t) => [+t.startTime!, +t.endTime!]);
    expect(model.getTasks(NOW).map((t) => [+t.startTime!, +t.endTime!])).toEqual(first);
    // Mermaid schedules x from b alone here, because a comes later and one pass resolves everything else.
    expect(first[1][0]).toBe(+new Date(2024, 0, 3));
  });

  it('leaves tasks that refer to each other unscheduled and still draws the rest', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n A :a, after b, 1d\n B :b, after a, 1d\n C :c, 2024-01-01, 3d\n';
    const tasks = tasksOf(src);
    expect(tasks[0].startTime).toBeUndefined();
    expect(tasks[2].endTime).toEqual(new Date(2024, 0, 4));
    const result = draw(src);
    expect(items(result.scene, 'pele-unscheduled').map((i) => i.id)).toEqual(['a', 'b']);
    expect(sceneProblem(result)).toBeUndefined();
  });

  it('rejects what Mermaid rejects, with its messages', () => {
    expect(() => draw('gantt\n dateFormat YYYYMMDD\n A :id1, 202304, 1d\n')).toThrow('Invalid date:202304');
    expect(() => draw('gantt\n dateFormat YYYY-MM-DD\n excludes weekends monday tuesday wednesday thursday friday\n A :a, 2019-02-01, 7d\n')).toThrow(
      'Failed to find a valid date'
    );
    expect(() => draw('gantt\n dateFormat YYYY-MM-DD\n A :a, not a date, 7d\n')).toThrow(PeleError);
  });

  it('rejects task data Mermaid crashes on, and accepts topAxis, which Mermaid crashes on', () => {
    expect(() => parse('gantt\n A :crit\n')).toThrow(/needs a duration or an end date/);
    expect(() => parse('gantt\n A :a, 2024-01-01, 3d, extra\n')).toThrow(/too many fields/);
    expect((parse('gantt\n topAxis\n') as GanttModel).topAxis).toBe(true);
  });

  it('reads tags, ids, sections, and settings into the model', () => {
    const model = parse(
      'gantt\n dateFormat DD-MM-YYYY\n axisFormat %d\n tickInterval 1day\n excludes weekends 10-02-2025\n includes 15-02-2025\n weekend friday\n weekday tuesday\n inclusiveEndDates\n todayMarker off\n section S\n A :crit, done, a, 03-02-2025, 2d\n B :milestone, 0d\n V :vert, v, 04-02-2025, 0d\n'
    ) as GanttModel;
    expect(model).toMatchObject({
      type: 'gantt',
      dateFormat: 'DD-MM-YYYY',
      axisFormat: '%d',
      tickInterval: '1day',
      excludes: ['weekends', '10-02-2025'],
      includes: ['15-02-2025'],
      weekend: 'friday',
      weekday: 'tuesday',
      inclusiveEndDates: true,
      todayMarker: 'off',
      sections: ['S'],
    });
    const [a, b, v] = model.getTasks(NOW);
    expect(a).toMatchObject({ id: 'a', task: 'A ', section: 'S', crit: true, done: true, active: false, order: 0 });
    expect(b).toMatchObject({ id: 'task1', milestone: true, order: 1 });
    expect(v).toMatchObject({ id: 'v', vert: true, order: -1 });
  });

  it('keeps a task whose name runs into %%', () => {
    expect(tasksOf('gantt\ndateFormat YYYY-MM-DD\nA%% label : 2026-10-24, 1d').map((task) => task.task)).toEqual(['A%% label ']);
  });

  it('treats ids that are Object.prototype names as ordinary ids', () => {
    const { links } = draw('gantt\n dateFormat YYYY-MM-DD\n A :__proto__, 2024-10-01, 3d\n B :constructor, after __proto__, 2d\n click __proto__ href "https://mermaid.js.org/"\n');
    expect(links).toEqual([{ id: '__proto__', href: 'https://mermaid.js.org/', internal: false }]);
    expect(tasksOf('gantt\n dateFormat YYYY-MM-DD\n A :__proto__, 2024-10-01, 3d\n B :constructor, after __proto__, 2d\n')[1].startTime).toEqual(new Date(2024, 9, 4));
  });
});
