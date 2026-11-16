import { describe, expect, it } from 'vitest';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, draw, itemById, lines, paints, tryDraw } from '../support/scene.js';

function check(src: string, extra: object = {}): boolean {
  const result = tryDraw(src, extra);
  if (result === undefined) return false;
  assertSafe(result, JSON.stringify(src).slice(0, 160));
  return true;
}

const V = 'venn-beta\n';

// One template for every place the syntax takes text. A payload that holds the delimiter of its
// position ends the token early and is rejected, which is fine: it must not get through as markup.
const TEMPLATES: ((p: string) => string)[] = [
  (p) => `${V}${p}`,
  (p) => `${V}set ${p}`,
  (p) => `${V}set "${p}"`,
  (p) => `${V}set A[${p}]`,
  (p) => `${V}set A["${p}"]`,
  (p) => `${V}set A["${p}"]:${p}`,
  (p) => `${V}set A:${p}`,
  (p) => `${V}set "${p}"\nset B\nunion "${p}",B`,
  (p) => `${V}set A\nset B\nunion A,B[${p}]`,
  (p) => `${V}set A\nset B\nunion A,B["${p}"]`,
  (p) => `${V}set A\nset B\nunion A,B:${p}`,
  (p) => `${V}set A\nset B\nset C\nunion A,B,C["${p}"]`,
  (p) => `${V}set A\nunion A,${p}`,
  (p) => `${V}set A\n  text ${p}`,
  (p) => `${V}set A\n  text "${p}"`,
  (p) => `${V}set A\n  text T[${p}]`,
  (p) => `${V}set A\n  text T["${p}"]`,
  (p) => `${V}set A\n  text "${p}"["${p}"]`,
  (p) => `${V}set A\ntext A "${p}"`,
  (p) => `${V}set A\ntext A T["${p}"]`,
  (p) => `${V}set A\nset B\nunion A,B\ntext A,B "${p}"["${p}"]`,
  (p) => `${V}set A\ntext ${p} T`,
  (p) => `${V}set A\nstyle A fill:${p}`,
  (p) => `${V}set A\nstyle A fill:"${p}"`,
  (p) => `${V}set A\nstyle A ${p}:red`,
  (p) => `${V}set A\nstyle A color:"${p}", stroke:"${p}", stroke-width:"${p}", fill-opacity:"${p}"`,
  (p) => `${V}set A\nset B\nunion A,B["x"]\nstyle A,B fill:"${p}", color:"${p}"`,
  (p) => `${V}set A\n  text T\nstyle T color:"${p}"`,
  (p) => `${V}set A\nstyle ${p} fill:red`,
  (p) => `${V}set A\nstyle "${p}" fill:red`,
  (p) => `${V}title ${p}\nset A`,
  (p) => `${V}title "${p}"\nset A`,
  (p) => `${V}%% ${p}\nset A`,
  (p) => `${V}set A %% ${p}`,
  (p) => `---\ntitle: "${p}"\nconfig:\n  venn:\n    width: "${p}"\n    padding: "${p}"\n---\n${V}set A`,
  (p) => `---\ntitle: ${p}\n---\n${V}set A\nset B`,
  (p) => `%%{init: {"venn": {"useDebugLayout": "${p}"}, "themeVariables": {"venn1": "${p}"}}}%%\n${V}set A`,
  (p) => `venn-beta ${p}\nset A`,
];

describe('inert venn output', () => {
  it('holds for every corpus input', () => {
    for (const src of loadCorpus('venn', /venn-beta/)) check(src);
  });

  it('holds with hostile text in every position', () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        if (check(template(payload))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(400);
  });

  it('shows markup as text', () => {
    const result = draw(
      `${V}title <img src=x onerror=alert(1)>\nset "<script>a&b</script>"\n  text "</text><script>alert(1)</script>"\nset B[<svg onload=alert(1)>]\nstyle B fill:"url(javascript:alert(1))", stroke:"red' onload='alert(1)"`
    );
    assertSafe(result, 'hostile venn');
    expect(paints(result.scene).filter((p) => p.includes('javascript:') || p.includes('url('))).toEqual([]);
    expect(lines(result.scene)).toContain('a&b');
    expect(lines(result.scene)).toContain('<svg onload=alert(1)>');
    expect(itemById(result.scene, '<script>a&b</script>', 'pele-venn-set')).toBeDefined();
  });

  it('holds for hostile option values', () => {
    for (const payload of PAYLOADS) {
      expect(check(`${V}set A\nset B\nunion A,B["x"]`, { idPrefix: payload, fontFamily: payload })).toBe(true);
    }
  });

  it('holds for mutated inputs', () => {
    const corpus = loadCorpus('venn', /venn-beta/);
    const fragments = [...PAYLOADS, '"', '[', ']', '["', '"]', '\n', '\n  ', ',', ':', 'set ', 'union ', 'text ', 'style ', 'title ', 'fill:', '%%', ':5', ':-1', ':1e9'];
    const next = mutator(corpus, fragments, random(3));
    const count = Number(process.env.FUZZ ?? 4000);
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000) check(src);
    }
  }, 600_000);

  it('does not pollute prototypes', () => {
    draw(`${V}set __proto__\nset constructor\nunion __proto__,constructor["toString"]\n  text hasOwnProperty["__proto__"]\nstyle __proto__ __proto__:red, constructor:blue\nstyle hasOwnProperty color:red`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
