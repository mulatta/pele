import { describe, expect, it } from 'vitest';
import { draw, lineOf, paints } from '../support/scene.js';
import type { Scene } from '../../src/draw/scene.js';
import type { SceneResult } from '../../src/index.js';

const themed = (vars: Record<string, unknown>, body: string): string =>
  `%%{init: ${JSON.stringify({ themeVariables: vars })}}%%\n${body}`;

const PIE = 'pie\n  "A": 1\n  "B": 2';
const XYCHART = 'xychart\n  bar [1, 2]\n  line [2, 1]';

// The series colors a palette sets, by number, as the scene's theme variables define them.
function series(result: SceneResult): Record<number, string> {
  const found: Record<number, string> = {};
  for (const [name, color] of Object.entries(result.scene.vars)) {
    const n = /^--pele-series-(\d)$/.exec(name)?.[1];
    if (n) found[Number(n)] = color;
  }
  return found;
}

const ON_LIGHT = 'var(--pele-fg-on-light,#1f1f1f)';
const ON_DARK = 'var(--pele-fg-on-dark,#fff)';
// What a label is drawn with when its color is not a palette color.
const PLAIN = 'var(--_bg)';

const LIGHT = '#ffeb3b';
const DARK = 'navy';

const labelPaint = (scene: Scene, label: string): string => scene.texts.find((t) => lineOf(t) === label)!.paint;
// What is drawn, without the source lines the directive that sets a palette moves.
const looks = (src: string): string => {
  const { scene, width, height } = draw(src);
  return JSON.stringify([width, height, scene.shapes, scene.texts]);
};
const slicePaints = (src: string, extra = {}): string[] => draw(src, extra).scene.texts.slice(0, 2).map((t) => t.paint);

describe('palette theme variables', () => {
  it('colors xychart series from plotColorPalette, repeating a short list', () => {
    const source = `---
config:
  themeVariables:
    xyChart:
      plotColorPalette: '#000000, #0000FF, #00FF00, #FF0000'
---
xychart
title "Different Colors in xyChart"
x-axis "categoriesX" ["Category 1", "Category 2", "Category 3", "Category 4"]
y-axis "valuesY" 0 --> 50
line [10,20,30,40]
bar [20,30,25,35]
bar [15,25,20,30]
line [5,15,25,35]`;
    const result = draw(source);
    expect(series(result)).toEqual({
      1: '#000000',
      2: '#0000FF',
      3: '#00FF00',
      4: '#FF0000',
      5: '#000000',
      6: '#0000FF',
      7: '#00FF00',
      8: '#FF0000',
    });
    expect(paints(result.scene)).toContain('var(--pele-series-1,#4c78a8)');
  });

  it('keeps commas inside color functions', () => {
    const result = draw(themed({ xyChart: { plotColorPalette: 'rgb(0, 0, 0), hsl(0 50% 50% / 0.5)' } }, XYCHART));
    expect(series(result)[1]).toBe('rgb(0, 0, 0)');
    expect(series(result)[2]).toBe('hsl(0 50% 50% / 0.5)');
  });

  it('maps each diagram palette onto the series in order', () => {
    const cases: [string, Record<string, string>][] = [
      [PIE, { pie1: 'red', pie2: 'blue' }],
      ['gitGraph\n  commit', { git0: 'red', git1: 'blue' }],
      ['timeline\n  2001 : a\n  2002 : b', { cScale0: 'red', cScale1: 'blue' }],
      ['radar-beta\n  axis a, b, c\n  curve x{1,2,3}', { cScale0: 'red', cScale1: 'blue' }],
      ['treemap\n"a": 1\n"b": 2', { cScale0: 'red', cScale1: 'blue' }],
      ['mindmap\n  root\n    a\n    b', { cScale0: 'green', cScale1: 'red', cScale2: 'blue' }],
    ];
    for (const [body, vars] of cases) {
      expect(series(draw(themed(vars, body))), body).toEqual({ 1: 'red', 2: 'blue' });
    }
  });

  it('repeats the venn colors that are set', () => {
    expect(series(draw(themed({ venn2: 'red', venn4: 'blue' }, 'venn-beta\n  set A\n  set B')))).toEqual({ 1: 'red', 2: 'blue', 3: 'red', 4: 'blue', 5: 'red', 6: 'blue', 7: 'red', 8: 'blue' });
  });

  it('ignores palettes of other diagrams and other theme colors', () => {
    expect(series(draw(themed({ cScale0: 'red', primaryColor: 'red' }, PIE)))).toEqual({});
    expect(series(draw(themed({ fillType0: 'red', cScale0: 'red' }, 'journey\n  section S\n    Task: 5: Me')))).toEqual({});
    expect(series(draw(themed({ pie1: 'red' }, 'flowchart LR\n  a --> b')))).toEqual({});
  });

  it('reads theme variables from front matter, directives and the config option', () => {
    const front = `---\nconfig:\n  themeVariables:\n    pie1: '#123456'\n---\n${PIE}`;
    expect(series(draw(front))).toEqual({ 1: '#123456' });
    const fromOption = draw(PIE, { config: { themeVariables: { pie2: 'oklch(70% 0.1 200)' } } });
    expect(series(fromOption)).toEqual({ 2: 'oklch(70% 0.1 200)' });
  });

  it('accepts theme-aware colors', () => {
    const vars = { pie1: 'var(--pele-accent)', pie2: 'light-dark(#000, #fff)', pie3: 'color-mix(in srgb, red 40%, blue)' };
    expect(series(draw(themed(vars, PIE)))).toEqual({
      1: 'var(--pele-accent)',
      2: 'light-dark(#000, #fff)',
      3: 'color-mix(in srgb, red 40%, blue)',
    });
  });

  it('drops values that are not colors and keeps the theme color in their place', () => {
    const unsafe = [
      'url(https://example.com/a.svg)',
      'url(//example.com/a.svg)',
      'image-set(a 1x)',
      'red;stroke:blue',
      '"><script>alert(1)</script>',
      'expression(alert(1))',
      'rgb(0, 0',
      'red)',
      'red}',
      'javascript:alert(1)',
      '/*',
      'reddish',
      '#ff00000',
      'var(--page-color)',
      'color-mix(in srgb, var(--page-color) 50%, red)',
    ];
    for (const value of unsafe) {
      expect(series(draw(themed({ pie1: value, pie2: 'blue' }, PIE))), value).toEqual({ 2: 'blue' });
    }
    const list = draw(themed({ xyChart: { plotColorPalette: 'url(a), blue' } }, XYCHART));
    expect(series(list)).toEqual({ 2: 'blue', 4: 'blue', 6: 'blue', 8: 'blue' });
  });
});

describe('palette label colors', () => {
  it('maps each diagram palette onto the series in order', () => {
    const cases: [string, Record<string, string>, string[]][] = [
      [PIE, { pie1: LIGHT, pie2: DARK }, ['33%', '67%']],
      ['gitGraph\n  commit\n  branch dev\n  commit', { git0: LIGHT, git1: DARK }, ['main', 'dev']],
      ['timeline\n  2001 : a\n  2002 : b', { cScale0: LIGHT, cScale1: DARK }, ['2001', '2002']],
      ['treemap\n"a": 1\n"b": 2', { cScale0: LIGHT, cScale1: DARK }, ['a', 'b']],
    ];
    for (const [body, vars, labels] of cases) {
      const { scene } = draw(themed(vars, body));
      expect(
        labels.map((l) => labelPaint(scene, l)),
        body
      ).toEqual([ON_LIGHT, ON_DARK]);
    }
  });

  it('keeps commas inside color functions', () => {
    expect(slicePaints(themed({ pie1: 'rgb(255, 255, 255)', pie2: 'hsl(240 100% 20% / 0.5)' }, PIE))).toEqual([ON_LIGHT, ON_DARK]);
  });

  it('ignores palettes of other diagrams and other theme colors', () => {
    const journey = 'journey\n  section S\n    Task: 5: Me';
    const flowchart = 'flowchart LR\n  a --> b';
    expect(slicePaints(themed({ cScale0: LIGHT, primaryColor: LIGHT }, PIE))).toEqual([PLAIN, PLAIN]);
    expect(looks(themed({ fillType0: LIGHT, cScale0: LIGHT }, journey))).toBe(looks(journey));
    expect(looks(themed({ pie1: LIGHT }, flowchart))).toBe(looks(flowchart));
  });

  it('reads theme variables from front matter, directives and the config option', () => {
    const front = `---\nconfig:\n  themeVariables:\n    pie1: '${DARK}'\n---\n${PIE}`;
    expect(slicePaints(front)).toEqual([ON_DARK, PLAIN]);
    expect(slicePaints(themed({ pie1: LIGHT }, PIE))).toEqual([ON_LIGHT, PLAIN]);
    expect(slicePaints(PIE, { config: { themeVariables: { pie2: DARK } } })).toEqual([PLAIN, ON_DARK]);
  });

  it('drops values that are not colors and keeps the theme color in their place', () => {
    const unsafe = [
      'url(https://example.com/a.svg)',
      'url(//example.com/a.svg)',
      'image-set(a 1x)',
      'red;stroke:blue',
      '"><script>alert(1)</script>',
      'expression(alert(1))',
      'rgb(0, 0',
      'red)',
      'red}',
      'javascript:alert(1)',
      '/*',
      'reddish',
      '#ff00000',
      'var(--page-color)',
      'color-mix(in srgb, var(--page-color) 50%, red)',
    ];
    for (const value of unsafe) {
      const { scene } = draw(themed({ pie1: value, pie2: DARK }, PIE));
      expect(
        scene.texts.slice(0, 2).map((t) => t.paint),
        value
      ).toEqual([PLAIN, ON_DARK]);
      expect(paints(scene).filter((p) => /<script|url\(/.test(p))).toEqual([]);
    }
  });

  it('picks label colors that contrast with palette colors', () => {
    const { scene: pie } = draw(themed({ pie1: LIGHT, pie2: DARK, pie3: 'var(--pele-accent)' }, 'pie\n  "A": 1\n  "B": 1\n  "C": 1'));
    const labels = pie.texts.filter((t) => /^\d+%$/.test(lineOf(t))).map((t) => t.paint);
    expect(labels).toEqual([ON_LIGHT, ON_DARK, PLAIN]);

    const git = draw(themed({ git0: LIGHT }, 'gitGraph\n  commit\n  branch dev\n  commit')).scene;
    expect([labelPaint(git, 'main'), labelPaint(git, 'dev')]).toEqual([ON_LIGHT, PLAIN]);

    const timeline = draw(themed({ cScale0: LIGHT }, 'timeline\n  section S\n    2001 : a')).scene;
    expect(timeline.texts.filter((t) => t.paint === ON_LIGHT).map(lineOf)).toEqual(['S', '2001']);

    const treemap = draw(themed({ cScale0: LIGHT }, 'treemap\n"a": 1\n"b": 1')).scene;
    expect(treemap.texts.filter((t) => t.paint === ON_LIGHT)).toHaveLength(2);
  });

  it('leaves the output unchanged without a palette', () => {
    expect(looks(themed({ primaryColor: 'red' }, PIE))).toBe(looks(PIE));
  });
});
