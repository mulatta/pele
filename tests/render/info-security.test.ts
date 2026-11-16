import { describe, expect, it } from 'vitest';
import type { RenderOptions } from '../../src/index.js';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, tryDraw } from '../support/scene.js';

function check(src: string, extra: RenderOptions = {}): boolean {
  const result = tryDraw(src, extra);
  if (result === undefined) return false;
  assertSafe(result, JSON.stringify(src).slice(0, 160));
  return true;
}

const TEMPLATES: ((p: string) => string)[] = [
  (p) => `info\ntitle ${p}`,
  (p) => `info showInfo title ${p}`,
  (p) => `info\naccTitle: ${p}\naccDescr: ${p}`,
  (p) => `info\naccDescr {\n ${p}\n }`,
  (p) => `info %% ${p}`,
  (p) => `info ${p}`,
  (p) => `---\ntitle: "${p}"\n---\ninfo`,
  (p) => `%%{init: {"themeVariables": {"fontFamily": "${p}"}}}%%\ninfo`,
];

describe('safe info output', () => {
  it('holds for every corpus input', () => {
    for (const src of loadCorpus('info', /info/)) check(src);
  });

  it('holds with hostile text in every position', { timeout: 60_000 }, () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        if (check(template(payload))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(150);
  });

  it('holds for hostile option values', () => {
    for (const payload of PAYLOADS) {
      expect(check('info\naccTitle: t', { idPrefix: payload, fontFamily: payload })).toBe(true);
    }
  });

  it('holds for mutated inputs', () => {
    const corpus = [...loadCorpus('info', /info/), 'info\ntitle T\naccTitle: A\naccDescr: D\n', '---\ntitle: T\n---\ninfo showInfo\n'];
    const next = mutator(corpus, [...PAYLOADS, '\n', 'title ', 'accTitle: ', 'accDescr {', '}', 'showInfo'], random(3));
    const count = Number(process.env.FUZZ ?? 4000);
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000) check(src);
    }
  }, 600_000);
});
