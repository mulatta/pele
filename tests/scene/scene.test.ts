import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, renderScene, sceneSupported } from '../../src/index.js';
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

const drawn = (src: string) => {
  try {
    return { scene: renderScene(src, options).scene, svg: render(src, { ...options, sourceInfo: true }).svg };
  } catch {
    return null;
  }
};

describe('scene output', () => {
  it.each(corpora)('draws what the SVG shows for $file', ({ file, sources }) => {
    for (const src of sources) {
      if (!sceneSupported(src)) continue;
      const out = drawn(src);
      if (out === null) continue;
      expect(sceneDifference(out.scene, svgToScene(out.svg)), `${file}: ${JSON.stringify(src).slice(0, 120)}`).toBeNull();
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
