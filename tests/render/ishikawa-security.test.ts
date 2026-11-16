import { describe, expect, it } from 'vitest';
import type { RenderOptions } from '../../src/index.js';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, draw, itemById, textOf, tryDraw } from '../support/scene.js';

function check(src: string, extra: RenderOptions = {}): boolean {
  const result = tryDraw(src, extra);
  if (result === undefined) return false;
  assertSafe(result, JSON.stringify(src).slice(0, 160));
  return true;
}

const I = 'ishikawa-beta\n';

// The syntax has one kind of text, at any depth. These put a payload at each depth, alone on its
// line and beside other text, and in the places around the diagram that take text.
const TEMPLATES: ((p: string) => string)[] = [
  (p) => `${I}${p}`,
  (p) => `${I}  ${p}`,
  (p) => `${I}  Effect\n    ${p}`,
  (p) => `${I}  Effect\n    Category\n      ${p}`,
  (p) => `${I}  Effect\n    Category\n      Cause\n        ${p}`,
  (p) => `${I}  Effect\n    Category\n      Cause\n        Sub\n          ${p}\n            ${p}`,
  (p) => `${I}  ${p}\n    ${p}\n      ${p}\n    ${p}\n      ${p}\n        ${p}`,
  (p) => `${I}  Effect ${p}\n    Category ${p}\n      Cause ${p} more`,
  (p) => `${I}  Effect\n    A\n    B\n    ${p}\n    C`,
  (p) => `${I}  Effect\n%% ${p}\n    Category`,
  (p) => `${I}  Effect\n    Category %% ${p}`,
  (p) => `ishikawa ${p}`,
  (p) => `ishikawa-beta ${p}\n  Cause`,
  (p) => `---\ntitle: "${p}"\n---\n${I}  Effect\n    Cause`,
  (p) => `---\ntitle: ${p}\nconfig:\n  ishikawa:\n    diagramPadding: "${p}"\n---\n${I}  Effect`,
  (p) => `%%{init: {"ishikawa": {"useMaxWidth": "${p}"}, "themeVariables": {"lineColor": "${p}"}}}%%\n${I}  Effect\n    Cause`,
];

describe('inert Ishikawa output', () => {
  it('holds for every corpus input', () => {
    for (const src of loadCorpus('ishikawa', /ishikawa/i)) check(src);
  });

  it('holds with hostile text in every position', () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        if (check(template(payload))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(450);
  });

  it('shows hostile text as text', () => {
    const { scene } = draw(`${I}  <img src=x onerror=alert(1)>\n    <script>a&b</script>\n      </text></g></svg><script>alert(1)</script>\n        " onload="alert(1)\n`);
    expect(textOf(scene)).not.toContain('<script');
    expect(textOf(scene)).toContain('a&b');
    expect(textOf(scene)).toContain('" onload="alert(1)');
    expect(itemById(scene, '<img src=x onerror=alert(1)>')).toBeDefined();
    expect(itemById(scene, '<script>a&b</script>')).toBeDefined();
  });

  it('holds for hostile option values', () => {
    for (const payload of PAYLOADS) {
      expect(check(`${I}  Effect\n    Category\n      Cause`, { idPrefix: payload, fontFamily: payload })).toBe(true);
    }
  });

  it('holds for mutated inputs', () => {
    const corpus = loadCorpus('ishikawa', /ishikawa/i).filter((src) => /^\s*ishikawa/i.test(src));
    const fragments = [...PAYLOADS, '\n', '\n  ', '\n      ', '\t', ' ', '%%', '<br>', '#35;', 'ishikawa'];
    const next = mutator(corpus, fragments, random(3));
    const count = Number(process.env.FUZZ ?? 4000);
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000) check(src);
    }
  }, 600_000);

  it('does not pollute prototypes', () => {
    draw(`${I}  __proto__\n    constructor\n      toString\n        hasOwnProperty\n    __proto__\n`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
