import { describe, expect, it } from 'vitest';
import { parse, supports } from '../../src/index.js';
import type { Scene } from '../../src/draw/scene.js';
import { draw, itemById, items, lineOf, lines, sceneProblem } from '../support/scene.js';

const TCP = 'packet\n0-15: "Source Port"\n16-31: "Destination Port"\n32-63: "Sequence Number"\n64: "URG"';

function config(packet: string, body: string): string {
  return `---\nconfig:\n  packet:\n${packet}\n---\n${body}`;
}

// The x position of each field's box, by its bit range.
function boxes(scene: Scene): Map<string, number> {
  return new Map(items(scene).map((i) => [i.id, i.box!.x0]));
}

// The bit numbers over the fields, as they stand on the page from left to right.
const bitNumbers = (scene: Scene) => scene.texts.filter((t) => t.item === -1 && /^\d+$/.test(lineOf(t)));

describe('packet rendering', () => {
  it('draws a box and a label per field, in rows of 32 bits', () => {
    const { scene, type, width } = draw(TCP);
    expect(type).toBe('packet');
    expect(supports('packet-beta\n0: "a"')).toBe(true);
    expect(items(scene, 'pele-node')).toHaveLength(4);
    expect(lines(scene)).toContain('Source Port');
    expect(itemById(scene, '32-63')).toBeDefined();
    expect(width).toBe(32 * 32 - 5 + 16);
    expect(new Set(items(scene).map((i) => i.box!.y0)).size).toBe(3);
  });

  it('numbers the first and last bit of each field, and a single bit once', () => {
    const { scene } = draw('packet\n0-15: "a"\n16: "b"');
    expect(bitNumbers(scene).map((t) => [lineOf(t), t.anchor])).toEqual([
      ['0', 'start'],
      ['15', 'end'],
      ['16', 'middle'],
    ]);
  });

  it('hides bit numbers when showBits is off, and takes less height', () => {
    const shown = draw('packet\n0-15: "a"\n16-47: "b"');
    const hidden = draw(config('    showBits: false', 'packet\n0-15: "a"\n16-47: "b"'));
    expect(bitNumbers(shown.scene).length).toBeGreaterThan(0);
    expect(bitNumbers(hidden.scene)).toEqual([]);
    expect(hidden.height).toBeLessThan(shown.height);
  });

  it('repeats a field on every row it spans', () => {
    const { scene } = draw('packet\n0-10: "test"\n11-90: "multiple"');
    expect(lines(scene).filter((l) => l === 'multiple')).toHaveLength(3);
    for (const id of ['11-31', '32-63', '64-90']) expect(itemById(scene, id), id).toBeDefined();
  });

  it('honours bitsPerRow, bitWidth, rowHeight, paddingX and paddingY', () => {
    const body = 'packet\n0-7: "a"\n8-15: "b"\n16-23: "c"';
    const base = draw(body);
    const narrow = draw(config('    bitsPerRow: 8\n    bitWidth: 10', body));
    expect(narrow.width).toBe(8 * 10 - 5 + 16);
    expect(narrow.height).toBeGreaterThan(base.height);
    const tall = draw(config('    rowHeight: 80', body));
    expect(tall.height).toBe(base.height + 48);
    const loose = draw(config('    bitsPerRow: 8\n    paddingY: 30', body));
    const tight = draw(config('    bitsPerRow: 8\n    paddingY: 0', body));
    expect(loose.height - tight.height).toBe(60);
    const { scene } = draw(config('    paddingX: 20', body));
    const gap = boxes(scene);
    const first = itemById(scene, '0-7')!.box!;
    expect(first.x1 - first.x0).toBe(8 * 32 - 20);
    expect(gap.get('8-15')! - gap.get('0-7')!).toBe(8 * 32);
  });

  it('mirrors each row when bitOrder is descending', () => {
    const body = 'packet\n0-7: "DATA"\n8-11: "TYPE"\n12: "EN"\n13-15: "RESERVED"\n16-19: "NEXT"';
    const ascending = boxes(draw(config('    bitsPerRow: 16', body)).scene);
    const { scene } = draw(config('    bitsPerRow: 16\n    bitOrder: descending', body));
    const descending = boxes(scene);
    expect(ascending.get('0-7')!).toBeLessThan(ascending.get('8-11')!);
    expect(descending.get('0-7')!).toBeGreaterThan(descending.get('8-11')!);
    expect(descending.get('13-15')!).toBe(ascending.get('0-7')!);
    // A partly filled row keeps its lowest bit against the right edge.
    expect(descending.get('16-19')!).toBe(ascending.get('0-7')! + 12 * 32);
    const bits = bitNumbers(scene).map(lineOf);
    expect(bits.indexOf('7')).toBeLessThan(bits.indexOf('0'));
    expect(bitNumbers(scene).find((t) => lineOf(t) === '0')!.anchor).toBe('end');
  });

  it('shrinks or shortens a label that is wider than its field', () => {
    const { scene } = draw('packet\n0: "Wide"\n1: "Extraordinarily long"\n2-31: "x"');
    const sizeOf = (line: string): number => scene.texts.find((t) => lineOf(t) === line)!.size;
    expect(sizeOf('Wide')).toBeLessThan(sizeOf('x'));
    expect(lines(scene)).toContain('Extr…');
    expect(lines(scene).join()).not.toContain('Extraordinarily');
  });

  it('puts the title under the fields, from the diagram or the front matter', () => {
    const { scene } = draw('---\ntitle: From front matter\n---\npacket\ntitle Own\n0-31: "a"');
    expect(lines(scene)).toContain('Own');
    expect(lines(scene)).not.toContain('From front matter');
    expect(lines(draw('---\ntitle: From front matter\n---\npacket\n0-31: "a"').scene)).toContain('From front matter');
    const title = scene.texts.find((t) => lineOf(t) === 'Own')!;
    expect(title.y).toBeGreaterThan(items(scene)[0].box!.y0 + 32);
  });

  it('renders an empty packet and one with only a title', () => {
    const empty = draw('packet').scene;
    expect([empty.shapes, empty.texts, empty.items]).toEqual([[], [], []]);
    const titled = draw('packet\ntitle Nothing yet');
    expect(lines(titled.scene)).toEqual(['Nothing yet']);
    expect(titled.width).toBeLessThan(300);
  });

  it("rejects what Mermaid rejects, with Mermaid's messages", () => {
    expect(() => draw('packet\n0-16: "a"\n18-20: "b"')).toThrow(
      'Packet block 18 - 20 is not contiguous. It should start from 17.'
    );
    expect(() => draw('packet\n0-16: "a"\n25-20: "b"')).toThrow(
      'Packet block 25 - 20 is invalid. End must be greater than start.'
    );
    expect(() => draw('packet\n+0: "a"')).toThrow('Packet block 0 is invalid. Cannot have a zero bit field.');
  });

  it('exposes the model', () => {
    const model = parse(config('    bitsPerRow: 8', 'packet\ntitle T\naccTitle: A\naccDescr: D\n+4: "a"\n+8: "b"'));
    expect(model.type).toBe('packet');
    if (model.type === 'packet') {
      expect(model.title).toBe('T');
      expect(model.accTitle).toBe('A');
      expect(model.bitsPerRow).toBe(8);
      expect(model.rows.map((row) => row.map((b) => [b.start, b.end, b.label]))).toEqual([
        [[0, 3, 'a'], [4, 7, 'b']],
        [[8, 11, 'b']],
      ]);
    }
  });

  it('stops after ten thousand rows, as Mermaid does', () => {
    const model = parse(config('    bitsPerRow: 1', 'packet\n+20000: "a"\n+1: "b"'));
    if (model.type === 'packet') expect(model.rows.length).toBe(10000);
  });

  it('ignores unusable config', () => {
    const odd = draw(config('    bitsPerRow: -4\n    bitWidth: "wide"\n    rowHeight: 0\n    paddingX: 9999', TCP));
    expect(sceneProblem(odd)).toBeUndefined();
    expect(odd.width).toBeGreaterThan(0);
  });
});
