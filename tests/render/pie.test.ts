import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, draw, items, lineOf, lines, paints, tryDraw } from '../support/scene.js';

describe('pie rendering', () => {
  it('draws a slice, a percentage, and a legend entry per section', () => {
    const { scene, type } = draw('pie title Pets\n "Dogs" : 386\n "Cats" : 85\n "Rats" : 15');
    expect(type).toBe('pie');
    expect(supports('pie\n "a": 1')).toBe(true);
    expect(items(scene, 'pele-slice')).toHaveLength(3);
    expect(items(scene, 'pele-legend-item')).toHaveLength(3);
    expect(lines(scene)).toContain('79%');
    expect(lines(scene)).toContain('Pets');
    expect(paints(scene).some((p) => p.startsWith('var(--pele-series-1,'))).toBe(true);
  });

  it('shows values in the legend with showData', () => {
    expect(lines(draw('pie showData\n "A" : 42.96\n "B" : 50').scene)).toContain('A [42.96]');
  });

  it('leaves out slices under one percent but keeps them in the legend', () => {
    const { scene } = draw('pie\n "Big" : 1000\n "Tiny" : 1');
    expect(items(scene, 'pele-slice')).toHaveLength(1);
    expect(items(scene, 'pele-legend-item')).toHaveLength(2);
  });

  it('draws a single full slice and an empty chart', () => {
    expect(lines(draw('pie\n "Only" : 5').scene)).toContain('100%');
    assertSafe(draw('pie\n "Zero" : 0'), 'zero');
    expect(draw('pie').width).toBeGreaterThan(0);
  });

  it('honours donutHole, textPosition and legendPosition', () => {
    const plain = draw('pie\n "A" : 1\n "B" : 1');
    const donut = draw('---\nconfig:\n  pie:\n    donutHole: 0.5\n---\npie\n "A" : 1\n "B" : 1');
    const below = draw('---\nconfig:\n  pie:\n    legendPosition: bottom\n---\npie\n "A" : 1\n "B" : 1');
    expect(JSON.stringify(donut.scene)).not.toBe(JSON.stringify(plain.scene));
    expect(below.height).toBeGreaterThan(plain.height);
    expect(below.width).toBeLessThan(plain.width);
  });

  it('moves the labels of thin slices outside the rim apart', () => {
    const { scene } = draw('pie\n "Calcium" : 2\n "Potassium" : 2.4\n "Magnesium" : 46\n "Test" : 50');
    // Labels that fit inside their slice are drawn on the slice in the background colour.
    const outside = scene.texts.filter((t) => t.item < 0 && t.paint !== 'var(--_bg)' && lineOf(t).endsWith('%'));
    expect(outside.map(lineOf)).toEqual(['2%', '2%']);
    const [a, b] = outside.map((t) => ({ x: t.x, y: t.y, w: metricsMeasurer.width(lineOf(t), t.size, 0), size: t.size }));
    const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= a.size;
    expect(apart).toBe(true);
  });

  it('takes the title from front matter unless the chart sets one', () => {
    expect(lines(draw('---\ntitle: From front matter\n---\npie\n "A" : 1').scene)).toContain('From front matter');
    expect(lines(draw('---\ntitle: From front matter\n---\npie title Own\n "A" : 1').scene)).toContain('Own');
  });

  it('rejects negative values with Mermaid\'s message', () => {
    expect(() => draw('pie\n "#35;x &amp;y" : -1')).toThrow('"#35;x &amp;y" has invalid value: -1.');
    expect(() => draw('pie\n "dogs" : -60.67')).toThrow(
      '"dogs" has invalid value: -60.67. Negative values are not allowed in pie charts. All slice values must be >= 0.'
    );
  });

  it('exposes the model', () => {
    const model = parse('pie showData\n "A" : 1\n "A" : 2\n "B" : 3');
    expect(model.type).toBe('pie');
    if (model.type === 'pie') {
      expect([...model.sections]).toEqual([['A', 1], ['B', 3]]);
      expect(model.showData).toBe(true);
    }
  });

  it('is inert for corpus, hostile, and mutated inputs', () => {
    const corpus = loadCorpus('pie', /pie/);
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result !== undefined) assertSafe(result, src);
    }
    let rendered = 0;
    for (const payload of PAYLOADS) {
      for (const src of [
        `pie title ${payload}\n "a" : 1`,
        `pie\n "${payload}" : 1\n "b" : 2`,
        `pie\n accTitle: ${payload}\n accDescr: ${payload}\n "a" : 1`,
        `pie\n accDescr {\n ${payload}\n }\n "a" : 1`,
        `---\ntitle: "${payload}"\nconfig:\n  pie:\n    legendPosition: "${payload}"\n    textPosition: "${payload}"\n---\npie\n "a" : 1`,
      ]) {
        const result = tryDraw(src);
        if (result === undefined) continue;
        assertSafe(result, src);
        rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(60);
    const next = mutator(corpus, [...PAYLOADS, '"', ':', '\n', 'title ', 'showData'], random(5));
    for (let i = 0; i < 2000; i++) {
      const src = next();
      const result = tryDraw(src);
      if (result !== undefined) assertSafe(result, src);
    }
  });

  it('stays fast on oversized input', () => {
    const big = { limit: Infinity };
    const cases = [
      'pie\n' + Array.from({ length: 5000 }, (_, i) => `"s${i}" : ${i}\n`).join(''),
      'pie title ' + 'x'.repeat(50000),
      'pie\n"' + 'a'.repeat(50000),
      'pie\n' + '%%{\n'.repeat(12000),
      'pie\n' + 'x ---\n'.repeat(8000),
      'pie\naccDescr {' + ' a\n'.repeat(15000),
      'pie\n' + ' '.repeat(50000) + '"a":1',
    ];
    for (const src of cases) {
      const started = performance.now();
      try {
        draw(src, big);
      } catch (error) {
        expect(error).toBeInstanceOf(PeleError);
      }
      expect(performance.now() - started, src.slice(0, 30)).toBeLessThan(2000);
    }
  });
  it('reads a long run of digits in linear time', () => {
    for (const tail of ['0'.repeat(49000), '0'.repeat(49000) + '.', '9'.repeat(49000) + '..', '-' + '1.'.repeat(24000)]) {
      const started = performance.now();
      expect(() => draw('pie\n"a": ' + tail)).toThrow(PeleError);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});
