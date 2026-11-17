import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, renderScene, sceneSupported } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { sceneSignature, signatureDifference } from '../support/svg-scene.js';

const options = { measurer: metricsMeasurer, now: Date.UTC(2026, 0, 15, 12) };

const corpora = readdirSync('tests/corpus')
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({ file, sources: (JSON.parse(readFileSync(`tests/corpus/${file}`, 'utf8')) as unknown[]).filter((s) => typeof s === 'string') }));

const icons = (name: string) => `<path d="M4 4h16v16H4z" stroke="var(--_m)"/><circle cx="12" cy="12" r="${(name.length % 5) + 1}" fill="currentColor"/>`;

// Typeset as SVG for odd lengths, as HTML (which a scene leaves out) for even ones.
const math = (tex: string, size: number) =>
  tex.length % 2
    ? { svg: '<svg viewBox="0 0 20 10"><path d="M0 5h20" stroke="currentColor"/><rect x="2" y="1" width="3" height="8" fill="currentColor"/></svg>', width: size * 2, height: size }
    : { html: '<b>x</b>', width: size, height: size };

// What the corpus leaves out: options it is not drawn with, and sources it lacks.
const EXTRA: { src: string; extra: object }[] = [
  { src: 'erDiagram\n CUSTOMER {\n string name PK "note"\n }', extra: { monospace: ['attributes'] } },
  { src: 'sankey-beta\nA#amp;B,C,1', extra: {} },
  { src: 'sankey-beta\nA,B,3', extra: {} },
  { src: 'sankey-beta\nA,B,3\nA,C,2\nB,D,1', extra: { idPrefix: 'p' } },
  { src: 'flowchart LR\n A["$$x^2$$ and $$yy$$"] --> B["plain"]\n subgraph S["$$abc$$ title"]\n B\n end', extra: { math } },
  { src: 'sequenceDiagram\n A->>B: $$x^2$$ hi', extra: { math } },
  { src: 'journey\n title T\n section S\n  $$abc$$ task: 5: Me', extra: { math } },
  { src: 'railroad-ebnf-beta\nletter = "a" | "b" ;', extra: {} },
  { src: 'flowchart TD\n A[Test]\n style A rx:20,ry:2', extra: {} },
];

// What a call gave, or the message it threw.
const attempt = <T>(f: () => T): { value: T } | { error: string } => {
  try {
    return { value: f() };
  } catch (e) {
    return { error: String(e) };
  }
};

const signature = (src: string, extra: object): unknown => {
  const result = attempt(() => renderScene(src, { ...options, ...extra }).scene);
  return 'error' in result ? { error: result.error } : sceneSignature(result.value);
};

// The signature of every scene the tests compare against, by `file#index` (with ` icons` when
// icons change it) and `extra#index`. Each was checked against what the SVG pele used to write
// showed, as an SVG reader saw it, before SVG was dropped.
function signatures(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { file, sources } of corpora) {
    sources.forEach((src, i) => {
      if (!sceneSupported(src)) return;
      const plain = signature(src, {});
      out[`${file}#${i}`] = plain;
      const drawn = signature(src, { icons });
      if (JSON.stringify(drawn) !== JSON.stringify(plain)) out[`${file}#${i} icons`] = drawn;
    });
  }
  EXTRA.forEach(({ src, extra }, i) => (out[`extra#${i}`] = signature(src, extra)));
  return out;
}

const BASELINE = 'tests/scene/baseline.json';

describe('scene output', () => {
  // Run with UPDATE_SCENE_BASELINE=1 to write the baseline after a change meant to change scenes.
  it('draws the scenes it drew before', () => {
    const now = signatures();
    if (process.env.UPDATE_SCENE_BASELINE) {
      writeFileSync(BASELINE, JSON.stringify(now) + '\n');
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(baseline).sort());
    for (const key of Object.keys(baseline)) expect(signatureDifference(now[key], baseline[key]), key).toBeNull();
  });

  // A text the source names is an item of its own inside its region, with where it was written,
  // as its SVG marks it; a reader that takes items from groups alone loses it.
  it('keeps a Venn text as an item of its own', () => {
    const src = 'venn-beta\n  set A["Frontend"]\n    text A1["React"]\n  set B["Backend"]\n  union A,B["Shared"]\n    text AB1["OpenAPI"]\n';
    const { items, texts } = renderScene(src, options).scene;
    expect(items.map((i) => `${i.id}|${i.kind}`)).toEqual(['A|pele-venn-set', 'B|pele-venn-set', 'A|pele-venn-region', 'A1|pele-venn-text', 'B|pele-venn-region', 'A|B|pele-venn-region', 'AB1|pele-venn-text']);
    expect(items.find((i) => i.id === 'AB1')).toMatchObject({ line: 6, symbol: 'AB1' });
    expect(items[texts.find((t) => t.spans[0].text === 'OpenAPI')!.item].id).toBe('AB1');
  });

  // Paints name pele's private variables, which stand for its --pele-* CSS variables with their
  // defaults, so a host resolves them as a page with pele's CSS would.
  it('defines the theme variables its paints name', () => {
    const { scene } = renderScene('pie\n  "A": 1', options);
    expect(scene.vars).toEqual({
      '--_bg': 'var(--pele-bg,#fff)',
      '--_fg': 'var(--pele-fg,#1f1f1f)',
      '--_m': 'var(--pele-muted,#6e6e6e)',
      '--_l': 'var(--pele-line,#1f1f1f)',
      '--_s': 'var(--pele-surface,#f3f3f3)',
      '--_a': 'var(--pele-surface-alt,#e6e6e6)',
      '--_b': 'var(--pele-border,#8a8a8a)',
      '--_c': 'var(--pele-accent,#5b7bd5)',
      '--_r': 'var(--pele-radius,4px)',
      '--_w': 'var(--pele-bold-weight,bold)',
      '--_tw': 'var(--pele-title-weight,bold)',
      '--_hw': 'var(--pele-heading-weight,bold)',
      '--_f': 'var(--pele-font,sans-serif)',
      '--_fm': 'var(--pele-font-mono,monospace)',
    });
    // The fonts labels were measured in are drawn in, unless a host's --pele-font says otherwise.
    const fonts = renderScene('pie\n  "A": 1', { ...options, fontFamily: 'Inter, sans-serif', fontFamilyMono: 'x;y' }).scene.vars;
    expect([fonts['--_f'], fonts['--_fm']]).toEqual(['var(--pele-font,Inter, sans-serif)', 'var(--pele-font-mono,monospace)']);
    expect(renderScene('%%{init: {"themeVariables": {"pie1": "red"}}}%%\npie\n  "A": 1', options).scene.vars['--pele-series-1']).toBe('red');
  });

  it('says what each part is', () => {
    const src = 'flowchart LR\n  subgraph S [Group]\n    A -->|go| B\n  end\n  B --> C';
    const roles = Object.fromEntries(renderScene(src, options).scene.items.map((i) => [`${i.id} ${i.kind.split(' ')[0]}`, i.role]));
    expect(roles).toMatchObject({
      'S pele-cluster': 'container',
      'A pele-node': 'element',
      'L_A_B_0 pele-edge': 'connection',
      'L_A_B_0 pele-edge-label': 'label',
    });
  });

  // A host parses once, asks whether the model draws a scene, then draws the model.
  it.each(corpora)('draws a parsed model as it draws its text for $file', ({ sources }) => {
    const opts = { ...options, sourceInfo: true };
    for (const src of sources) {
      const model = attempt(() => parse(src, opts));
      if ('error' in model) continue;
      expect(sceneSupported(model.value), src).toBe(true);
      expect(renderScene(model.value, opts).scene, src).toEqual(renderScene(src, opts).scene);
    }
  });
});
