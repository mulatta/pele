import { readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diagram } from '../src/types.js';

const FLOW = 'flowchart LR\n  A --> B';
const PIE = 'pie\n  "a": 1\n  "b": 2';

describe('core without the full entry point', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('draws nothing until a diagram type is registered', async () => {
    const core = await import('../src/core.js');
    expect(core.detectType(FLOW)).toBe('flowchart');
    expect(core.supports(FLOW)).toBe(false);
    expect(core.registered('flowchart')).toBe(false);
    expect(() => core.renderScene(FLOW)).toThrow(core.PeleError);
    try {
      core.renderScene(FLOW);
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported-diagram', type: 'flowchart', mermaidType: 'flowchart-v2' });
    }
  });

  it('draws the types that were registered, and only those', async () => {
    const core = await import('../src/core.js');
    const flowchart = (await import('../src/entries/flowchart.js')).default;
    core.register(flowchart);
    expect(core.supports(FLOW)).toBe(true);
    expect(core.renderScene(FLOW).type).toBe('flowchart');
    expect(core.supports(PIE)).toBe(false);
  });

  it('draws a registered type through its output, and refuses one that draws nothing', async () => {
    const core = await import('../src/core.js');
    core.register((await import('../src/entries/flowchart.js')).default);
    expect(core.sceneSupported(FLOW)).toBe(true);
    expect(core.sceneSupported(PIE)).toBe(false);
    // A type that never ends its drawing.
    const own: Diagram<null> = {
      type: 'pie',
      parse: () => null,
      render: () => ({ width: 1, height: 1, links: [] }),
    };
    core.register(own);
    expect(core.sceneSupported(PIE)).toBe(true);
    expect(() => core.renderScene(PIE)).toThrow(expect.objectContaining({ code: 'unsupported-diagram', type: 'pie' }));
  });

  it('loads a type the first time it is needed', async () => {
    const lazy = await import('../src/lazy.js');
    expect(lazy.supports(PIE)).toBe(false);
    const result = await lazy.renderSceneAsync(PIE);
    expect(result.type).toBe('pie');
    expect(result.mermaidType).toBe('pie');
    expect(lazy.supports(PIE)).toBe(true);
    expect(lazy.supports(FLOW)).toBe(false);
    expect(await lazy.load('flowchart')).toBe(true);
    expect(lazy.renderScene(FLOW).type).toBe('flowchart');
  });

  it('loads a type once however often it is asked for', async () => {
    const lazy = await import('../src/lazy.js');
    const [a, b, c] = await Promise.all([lazy.load('pie'), lazy.load('pie'), lazy.renderSceneAsync(PIE)]);
    expect(a && b).toBe(true);
    expect(c.type).toBe('pie');
    expect(await lazy.load('pie')).toBe(true);
  });

  it('reports text it cannot draw the same way with or without loading', async () => {
    const lazy = await import('../src/lazy.js');
    expect(await lazy.load(null)).toBe(false);
    await expect(lazy.renderSceneAsync('not a diagram')).rejects.toMatchObject({ code: 'unsupported-diagram' });
    await expect(lazy.renderSceneAsync('zenuml\n  a->b: hi')).rejects.toMatchObject({ code: 'unsupported-diagram' });
    await expect(lazy.renderSceneAsync('flowchart LR\n  A -->')).rejects.toMatchObject({ code: 'syntax' });
    await expect(lazy.renderSceneAsync('x'.repeat(60000))).rejects.toMatchObject({ code: 'limit' });
  });

  it('has an entry and a loader for every type, filed under the name it is detected as', async () => {
    const lazy = await import('../src/lazy.js');
    const { all } = await import('../src/diagrams/registry.js');
    const files = readdirSync('src/entries').map((file) => file.replace(/\.ts$/, '')).sort();
    expect(files).toEqual(all.map((d) => d.type).sort());
    for (const type of files) {
      const entry = (await import(`../src/entries/${type}.ts`)).default as Diagram<unknown>;
      expect(entry.type).toBe(type);
      expect(await lazy.load(entry.type)).toBe(true);
      expect(lazy.registered(entry.type)).toBe(true);
    }
  });
});

describe('the full entry point', () => {
  it('has every type registered', async () => {
    vi.resetModules();
    const pele = await import('../src/index.js');
    const { all } = await import('../src/diagrams/registry.js');
    expect(all.length).toBe(33);
    for (const diagram of all) expect(pele.registered(diagram.type)).toBe(true);
    expect(pele.renderScene(FLOW).type).toBe('flowchart');
    expect(pele.renderScene(PIE).type).toBe('pie');
  });
});
