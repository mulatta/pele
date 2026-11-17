import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import { assertSafe, draw, itemById, items, lines, paints, shapesOf, textOf } from '../support/scene.js';

const same = (a: { scene: unknown }, b: { scene: unknown }): boolean => JSON.stringify(a.scene) === JSON.stringify(b.scene);

const BASIC =
  'cynefin-beta\n  title Incident Response\n  complex\n    "Investigate root cause"\n    "Run chaos experiment"\n  complicated\n    "Expert review needed"\n' +
  '  clear\n    "Restart service"\n  chaotic\n    "Page on-call immediately"\n  confusion\n    "Unknown failure mode"\n';

describe('cynefin rendering', () => {
  it('draws the five domains, their items, and the boundaries', () => {
    const result = draw(BASIC);
    const { scene, type } = result;
    expect(type).toBe('cynefin');
    expect(supports(BASIC)).toBe(true);
    expect(items(scene, 'pele-cynefin-region')).toHaveLength(5);
    expect(items(scene, 'pele-cynefin-domain')).toHaveLength(5);
    expect(items(scene, 'pele-node')).toHaveLength(6);
    for (const name of ['Complex', 'Complicated', 'Clear', 'Chaotic', 'Confusion']) expect(lines(scene)).toContain(name);
    expect(lines(scene)).toContain('Probe → Sense → Respond');
    expect(lines(scene)).toContain('Disorder');
    expect(lines(scene)).toContain('Incident Response');
    for (let i = 1; i <= 5; i++) expect(paints(scene).some((p) => p.startsWith(`var(--pele-series-${i},`))).toBe(true);
    assertSafe(result, 'basic');
  });

  it('draws every domain even when none is declared', () => {
    const { scene } = draw('cynefin-beta');
    expect(items(scene, 'pele-cynefin-domain')).toHaveLength(5);
    expect(items(scene, 'pele-node')).toHaveLength(0);
  });

  it('draws transitions with arrowheads and labels, and drops self loops', () => {
    const src = 'cynefin-beta\ncomplex --> complicated : "Pattern identified"\nclear --> chaotic\nclear --> clear : "ignored"\ncomplex --> clear : "diagonal"\nconfusion --> chaotic\n';
    const { scene } = draw(src);
    const edges = items(scene, 'pele-edge');
    expect(edges).toHaveLength(4);
    // Each edge draws its line and, as a filled shape, its arrowhead.
    for (const edge of edges) expect(shapesOf(scene, edge).map((s) => s.kind)).toEqual(['stroke', 'fill']);
    expect(itemById(scene, 'complex-complicated', 'pele-edge')).toBeDefined();
    expect(lines(scene)).toContain('Pattern identified');
    expect(textOf(scene)).not.toContain('ignored');
    const model = parse(src);
    if (model.type === 'cynefin') expect(model.transitions.map((t) => `${t.from}>${t.to}`)).toEqual(['complex>complicated', 'clear>chaotic', 'complex>clear', 'confusion>chaotic']);
  });

  it('caps the confusion list at three items', () => {
    const { scene } = draw('cynefin-beta\nconfusion\n"a"\n"b"\n"c"\n"d"\n"e"\n');
    expect(items(scene, 'pele-node')).toHaveLength(3);
    expect(lines(scene)).toContain('+2 more');
  });

  it('keeps the last block when a domain is declared twice', () => {
    const model = parse('cynefin-beta\ncomplex\n"first"\ncomplex\n"second"\n');
    expect(model.type).toBe('cynefin');
    if (model.type === 'cynefin') expect(model.domains.get('complex')!.items).toEqual([{ label: 'second' }]);
  });

  it('grows to fit long lists and wraps long labels', () => {
    const base = draw('cynefin-beta\ncomplex\n"a"\n');
    const tall = draw('cynefin-beta\ncomplex\n' + '"an item"\n'.repeat(20));
    const wide = draw('cynefin-beta\ncomplex\n"' + 'word '.repeat(30) + '"\n');
    expect(tall.height).toBeGreaterThan(base.height);
    expect(wide.width).toBeLessThan(base.width + 200);
    expect(wide.scene.texts.filter((t) => t.item >= 0 && t.size === 14).length).toBeGreaterThan(3);
  });

  it('honours the options', () => {
    const base = draw(BASIC);
    const front = (body: string): string => `---\nconfig:\n  cynefin:\n${body}---\n${BASIC}`;
    expect(textOf(draw(front('    showDomainDescriptions: false\n')).scene)).not.toContain('Probe');
    expect(draw(front('    width: 1200\n    height: 900\n')).width).toBeGreaterThan(base.width);
    expect(same(draw(front('    boundaryAmplitude: 0\n')), base)).toBe(false);
    expect(same(draw(front('    seed: 5\n')), draw(front('    seed: 6\n')))).toBe(false);
    expect(same(draw(BASIC, { idPrefix: 'other' }), base)).toBe(false);
    expect(same(draw(BASIC), base)).toBe(true);
  });

  it('draws titles', () => {
    const { scene } = draw('---\ntitle: Front\n---\ncynefin-beta\naccTitle: Acc\naccDescr: Described\nclear\n"a"\n');
    expect(lines(scene)).toContain('Front');
    expect(draw('---\ntitle: Front\n---\ncynefin-beta\ntitle Own\n').scene.texts.map((t) => t.spans.map((x) => x.text).join(''))).toContain('Own');
  });

  it('rejects what Mermaid rejects', () => {
    for (const src of ['cynefin-beta\n"orphan"', 'cynefin-beta\ncomplexity', 'cynefin-beta\ncomplex --> nowhere', 'cynefin-beta\ncomplex --> clear clear', 'cynefin-betax']) {
      expect(() => draw(src), src).toThrow(PeleError);
    }
  });
});
