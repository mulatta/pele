import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, render, renderScene, sceneSupported } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { sceneDifference, sceneSignature, signatureDifference, svgToScene } from '../support/svg-scene.js';

const options = { measurer: metricsMeasurer, now: Date.UTC(2026, 0, 15, 12) };

const corpora = readdirSync('tests/corpus')
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({ file, sources: JSON.parse(readFileSync(`tests/corpus/${file}`, 'utf8')) as string[] }));

// The scenes renderScene() drew before the renderers wrote both outputs through one drawing
// interface, for the types it drew then.
const baseline = JSON.parse(readFileSync('tests/scene/baseline.json', 'utf8')) as Record<string, unknown>;

const icons = (name: string) => `<path d="M4 4h16v16H4z" stroke="var(--_m)"/><circle cx="12" cy="12" r="${(name.length % 5) + 1}" fill="currentColor"/>`;

// What a call gave, or the message it threw.
const attempt = <T>(f: () => T): { value: T } | { error: string } => {
  try {
    return { value: f() };
  } catch (e) {
    return { error: String(e) };
  }
};

describe('scene output', () => {
  it.each(corpora)('draws what the SVG shows for $file', ({ file, sources }) => {
    for (const src of sources) {
      if (!sceneSupported(src)) continue;
      // Narrow, a diagram is drawn more than once to fit; icons are drawn from what a host gives.
      for (const extra of [{}, { maxWidth: 300 }, { icons }]) {
        const at = `${file} ${JSON.stringify(extra)}: ${JSON.stringify(src).slice(0, 120)}`;
        const svg = attempt(() => render(src, { ...options, ...extra, sourceInfo: true }).svg);
        const scene = attempt(() => renderScene(src, { ...options, ...extra }).scene);
        // A source the SVG rejects, the scene rejects too; one it draws, the scene draws.
        if ('error' in svg) {
          expect('error' in scene, at).toBe(true);
          continue;
        }
        if ('error' in scene) expect.fail(`${at}: ${scene.error}`);
        expect(sceneDifference(scene.value, svgToScene(svg.value)), at).toBeNull();
      }
    }
  });

  // What the corpus leaves out: options it is not drawn with, and sources it lacks.
  it.each([
    { src: 'erDiagram\n CUSTOMER {\n string name PK "note"\n }', extra: { monospace: ['attributes'] } },
    { src: 'sankey-beta\nA#amp;B,C,1', extra: {} },
    { src: 'sankey-beta\nA,B,3', extra: {} },
    { src: 'railroad-ebnf-beta\nletter = "a" | "b" ;', extra: {} },
    { src: 'flowchart TD\n A[Test]\n style A rx:20,ry:2', extra: {} },
  ])('draws what the SVG shows for $src', ({ src, extra }) => {
    const scene = renderScene(src, { ...options, ...extra }).scene;
    expect(sceneDifference(scene, svgToScene(render(src, { ...options, ...extra, sourceInfo: true }).svg))).toBeNull();
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

  it('draws the scenes it drew before', () => {
    let compared = 0;
    for (const { file, sources } of corpora) {
      sources.forEach((src, i) => {
        const key = `${file}#${i}`;
        if (!(key in baseline)) return;
        compared++;
        expect(signatureDifference(sceneSignature(renderScene(src, options).scene), baseline[key]), key).toBeNull();
      });
    }
    expect(compared).toBe(Object.keys(baseline).length);
  });
});
