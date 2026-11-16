import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, supports } from '../../src/index.js';
import { draw, lines } from '../support/scene.js';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

describe('info rendering', () => {
  it("draws Pele's version", () => {
    const { scene, type, width, height } = draw('info');
    expect(type).toBe('info');
    expect(supports('info showInfo')).toBe(true);
    expect(lines(scene)).toEqual([`Pele v${version}`]);
    expect(width).toBeLessThan(200);
    expect(height).toBeLessThan(60);
  });

  it('draws the same with and without showInfo', () => {
    expect(draw('info\nshowInfo\n').scene).toEqual(draw('info').scene);
  });

  it('draws a title from the diagram or the front matter', () => {
    const titled = draw('---\ntitle: From front matter\n---\ninfo');
    expect(lines(titled.scene)).toContain('From front matter');
    expect(titled.height).toBeGreaterThan(draw('info').height);
    const own = lines(draw('---\ntitle: From front matter\n---\ninfo\ntitle Own').scene);
    expect(own).toContain('Own');
    expect(own).not.toContain('From front matter');
  });

  it('exposes the model', () => {
    const src = 'info showInfo\naccTitle: Name\naccDescr: Text';
    expect(parse(src)).toEqual({ type: 'info', mermaidType: 'info', title: undefined, accTitle: 'Name', accDescr: 'Text' });
  });

  it('rejects anything else after the keyword', () => {
    expect(() => draw('info unsupported')).toThrow(/Lexical error on line 1/);
    expect(() => draw('info\ntitle a\nshowInfo')).toThrow(/Parse error on line 3/);
  });
});
