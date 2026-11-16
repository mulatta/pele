import { describe, expect, it } from 'vitest';
import { draw, lineOf, paints } from '../support/scene.js';
import type { Scene } from '../../src/draw/scene.js';

const themed = (vars: Record<string, unknown>, body: string): string =>
  `%%{init: ${JSON.stringify({ themeVariables: vars })}}%%\n${body}`;

const PIE = 'pie\n  "A": 1\n  "B": 2';

const ON_LIGHT = 'var(--pele-fg-on-light,#1f1f1f)';
const ON_DARK = 'var(--pele-fg-on-dark,#fff)';
// What a label is drawn with when its color is not a palette color.
const PLAIN = 'var(--_bg)';

const LIGHT = '#ffeb3b';
const DARK = 'navy';

// The scene holds a palette color only through the label color picked to contrast with it, so
// these tests read that.
const labelPaint = (scene: Scene, label: string): string => scene.texts.find((t) => lineOf(t) === label)!.paint;
// What is drawn, without the source lines the directive that sets a palette moves.
const looks = (src: string): string => {
  const { scene, width, height } = draw(src);
  return JSON.stringify([width, height, scene.shapes, scene.texts]);
};
const slicePaints = (src: string, extra = {}): string[] => draw(src, extra).scene.texts.slice(0, 2).map((t) => t.paint);

describe('palette theme variables', () => {
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
