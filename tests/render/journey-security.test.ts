import { describe, expect, it } from 'vitest';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, draw, items, textOf, tryDraw } from '../support/scene.js';

function check(src: string, extra: object = {}): boolean {
  const result = tryDraw(src, extra);
  if (result === undefined) return false;
  assertSafe(result, JSON.stringify(src).slice(0, 160));
  return true;
}

// A semicolon is a syntax error in a journey, so hostile text is also tried with its semicolons removed.
const variants = (p: string): string[] => (p.includes(';') ? [p, p.replace(/;/g, '')] : [p]);

const TEMPLATES: ((p: string) => string)[] = [
  (p) => `journey\n  title ${p}\n  Task: 5: Me`,
  (p) => `journey\n  ${p}: 5: Me`,
  (p) => `journey\n  ${p}`,
  (p) => `journey\n  Task: ${p}`,
  (p) => `journey\n  Task: ${p}: Me`,
  (p) => `journey\n  Task: 5: ${p}`,
  (p) => `journey\n  Task: 5: Me, ${p}, You`,
  (p) => `journey\n  Task: 5: Me: ${p}`,
  (p) => `journey\n  section ${p}\n  Task: 5: Me`,
  (p) => `journey\n  section ${p}`,
  (p) => `journey\n  title ${p}\n  section ${p}\n  x${p}: 3: y${p}, z${p}`,
  (p) => `journey ${p}\n  Task: 5: Me`,
  (p) => `journey\n  accTitle: ${p}\n  accDescr: ${p}\n  Task: 5: Me`,
  (p) => `journey\n  accDescr {\n ${p}\n }\n  Task: 5: Me`,
  (p) => `journey\n  a<br>${p}<br/>b: 5: Me<br>${p}`,
  (p) => `journey\n  fa:fa-${p} x: 5: fa:fa-${p}`,
  (p) => `journey\n  %% ${p}\n  Task: 5: Me # ${p}`,
  (p) => `---\ntitle: "${p}"\n---\njourney\n  Task: 5: Me`,
  (p) => `---\nconfig:\n  journey:\n    actorColours: ["${p}"]\n    sectionFills: ["${p}"]\n    taskFontFamily: "${p}"\n---\njourney\n  section S\n  Task: 5: Me`,
  (p) => `---\nconfig:\n  journey: "${p}"\n---\njourney\n  Task: 5: Me`,
  (p) => `%%{init: {"journey": {"width": "${p}", "titleColor": "${p}"}, "themeVariables": {"fillType0": "${p}"}}}%%\njourney\n  Task: 5: Me`,
];

describe('safe journey scenes', () => {
  const corpus = [
    ...loadCorpus('journey', /journey/),
    'journey\n  title Day\n  section Work\n    Make tea: 5: Me\n    Do work: 1: Me, Cat\n  section Home\n    Sit down: 4: Me\n',
    'journey\n  accTitle: a\n  accDescr { b }\n  First: 3\n  section S\n  One<br>two: 2: A, B, C\n',
  ];

  it('holds for every corpus input', () => {
    let rendered = 0;
    for (const src of corpus) if (check(src)) rendered++;
    expect(rendered).toBeGreaterThan(5);
  });

  it('holds with hostile text in every position', () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        for (const text of variants(payload)) if (check(template(text))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(500);
  });

  it('shows markup as text', () => {
    const { scene } = draw('journey\n  title <script>alert(1)</script>\n  section "><img src=x onerror=alert(1)>\n  <svg onload=alert(1)>: 5: </text><script>x</script>, "onload="alert(1)');
    expect(textOf(scene)).toContain('<script>alert(1)</script>');
    const ids = scene.items.map((i) => i.id);
    expect(ids).toContain('"><img src=x onerror=alert(1)>');
    expect(ids).toContain('"onload="alert(1)');
  });

  it('holds for hostile option values', () => {
    for (const payload of PAYLOADS) {
      expect(check('journey\n  accTitle: t\n  accDescr: d\n  Task: 5: Me', { idPrefix: payload, fontFamily: payload })).toBe(true);
    }
  });

  it('holds for mutated inputs', () => {
    const next = mutator(
      corpus,
      [...PAYLOADS.flatMap(variants), ':', ': 5', ': 3: Me', ',', '\n', 'title ', 'section ', 'accTitle: ', 'accDescr {', '}', '<br>', '#', '%%'],
      random(3)
    );
    const count = Number(process.env.FUZZ ?? 4000);
    let rendered = 0;
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000 && check(src)) rendered++;
    }
    expect(rendered).toBeGreaterThan(count / 20);
  }, 600_000);

  it('does not pollute prototypes or trip over inherited names', () => {
    const { scene } = draw('journey\n  section __proto__\n  constructor: 5: __proto__, constructor, toString, hasOwnProperty\n  __proto__: 1: valueOf\n');
    expect(items(scene, 'pele-legend-item').length).toBe(5);
    expect(scene.items.map((i) => i.id)).toContain('__proto__');
    draw('---\nconfig:\n  journey:\n    __proto__:\n      polluted: true\n---\njourney\n  Task: 5: Me');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
