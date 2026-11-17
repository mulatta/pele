import { describe, expect, it } from 'vitest';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, draw, itemById, lines, tryDraw } from '../support/scene.js';

function check(src: string, extra: object = {}): boolean {
  const result = tryDraw(src, extra);
  if (result === undefined) return false;
  assertSafe(result, JSON.stringify(src).slice(0, 160));
  return true;
}

const TEMPLATES: ((p: string) => string)[] = [
  (p) => `timeline\n  title ${p}\n  2001 : a`,
  (p) => `timeline\n  ${p}`,
  (p) => `timeline\n  ${p} : event`,
  (p) => `timeline\n  2001 : ${p}`,
  (p) => `timeline\n  2001 : a : ${p} : b`,
  (p) => `timeline\n  2001 : a\n       : ${p}`,
  (p) => `timeline\n  section ${p}\n  2001 : a`,
  (p) => `timeline\n  section ${p}`,
  (p) => `timeline TD\n  title ${p}\n  section ${p}\n  ${p} : ${p}`,
  (p) => `timeline TD\n  x${p} : y${p} : z${p}`,
  (p) => `timeline ${p}\n  2001 : a`,
  (p) => `timeline\n  accTitle: ${p}\n  accDescr: ${p}\n  2001 : a`,
  (p) => `timeline\n  accDescr {\n ${p}\n }\n  2001 : a`,
  (p) => `timeline\n  2001 : a<br>${p}<br/>b`,
  (p) => `timeline\n  2001 : <b>${p}</b> <i>${p}`,
  (p) => `timeline\n  2001 : fa:fa-${p} x`,
  (p) => `timeline\n  %% ${p}\n  2001 : a # ${p}`,
  (p) => `---\ntitle: "${p}"\n---\ntimeline\n  2001 : a`,
  (p) => `---\nconfig:\n  timeline:\n    disableMulticolor: "${p}"\n---\ntimeline\n  2001 : a\n  2002 : b`,
  (p) => `---\nconfig:\n  timeline: "${p}"\n---\ntimeline\n  2001 : a`,
  (p) => `%%{init: {"timeline": {"disableMulticolor": "${p}", "padding": "${p}"}, "themeVariables": {"cScale0": "${p}"}}}%%\ntimeline\n  2001 : a`,
];

describe('inert timeline output', () => {
  const corpus = loadCorpus('timeline', /timeline/);

  it('holds for every corpus input', () => {
    let rendered = 0;
    for (const src of corpus) if (check(src)) rendered++;
    expect(rendered).toBeGreaterThan(15);
  });

  it('holds with hostile text in every position', () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        if (check(template(payload))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(500);
  });

  it('shows markup as text', () => {
    const result = draw('timeline\n  title <script>alert(1)</script>\n  section "><img src=x onerror=alert(1)>\n  <svg onload=alert(1)> : </text><script>x</script>');
    assertSafe(result, 'hostile timeline');
    expect(lines(result.scene)).toContain('<script>alert(1)</script>');
    expect(itemById(result.scene, '"><img src=x onerror=alert(1)>', 'pele-section')).toBeDefined();
  });

  it('holds for hostile option values', () => {
    for (const payload of PAYLOADS) {
      expect(check('timeline\n  accTitle: t\n  accDescr: d\n  2001 : a', { idPrefix: payload, fontFamily: payload })).toBe(true);
    }
  });

  it('holds for mutated inputs', () => {
    const next = mutator(corpus, [...PAYLOADS, ':', ' : ', '\n', 'title ', 'section ', 'accTitle: ', 'accDescr {', '}', '<br>', ' TD', '#', '%%'], random(3));
    const count = Number(process.env.FUZZ ?? 4000);
    let rendered = 0;
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000 && check(src)) rendered++;
    }
    expect(rendered).toBeGreaterThan(count / 10);
  }, 600_000);

  it('does not pollute prototypes', () => {
    draw('timeline\n  section __proto__\n  __proto__ : constructor : toString\n  constructor : __proto__\n  section constructor\n  hasOwnProperty');
    draw('---\nconfig:\n  timeline:\n    __proto__:\n      polluted: true\n---\ntimeline\n  2001 : a');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
