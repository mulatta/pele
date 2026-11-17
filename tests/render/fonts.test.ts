import { describe, expect, it } from 'vitest';
import { assertSafe, draw, itemById, lineOf, shapesOf, textOf } from '../support/scene.js';

const FLOW = 'flowchart LR\n  A --> B';

const weightOf = (src: string, line: string): number => {
  const { scene } = draw(src);
  const text = scene.texts.find((t) => lineOf(t) === line);
  if (!text) throw new Error(`no line ${line} in ${textOf(scene)}`);
  return text.weight;
};

describe('fonts', () => {
  it('takes the weight of bold text from the text, and draws nothing bold unasked', () => {
    const plain = draw(FLOW).scene;
    expect(plain.texts.map((t) => t.weight)).toEqual([400, 400]);
    expect(plain.texts.flatMap((t) => t.spans.map((s) => s.weight))).toEqual([undefined, undefined]);

    const { scene } = draw(`---\ntitle: My title\n---\n${FLOW}\n  B --> C["\`**Bold** word\`"]`);
    expect(scene.texts.find((t) => lineOf(t) === 'My title')!.weight).toBe(700);
    const bold = scene.texts.find((t) => lineOf(t) === 'Bold word')!;
    expect(bold.weight).toBe(400);
    expect(bold.spans.map((s) => [s.text, s.weight])).toEqual([['Bold', 700], [' word', undefined]]);
  });

  it('draws the names of classes, columns, and other headings in the heading weight', () => {
    const cases: [string, string][] = [
      ['classDiagram\n  class Duck {\n    +swim()\n  }', 'Duck'],
      ['kanban\n  Todo\n    [Write docs]', 'Todo'],
      ['treeView-beta\n    src/\n        index.js\n', 'src'],
      ['sequenceDiagram\n  loop Daily\n    A->>B: x\n  end', 'loop'],
      ['timeline\n  section Early\n    2001 : First', 'Early'],
    ];
    for (const [source, heading] of cases) expect(weightOf(source, heading), source).toBe(700);
  });

  it('writes the corner radius a style sets in the shape, after the theme', () => {
    const { scene } = draw('flowchart LR\n  A[One] --> B[Two]\n  style B rx:10,fill:#eee');
    // A rectangle's outline starts where its first corner ends, so the offset is the radius.
    const radius = (id: string): number => {
      const [fill] = shapesOf(scene, itemById(scene, id, 'pele-node')!);
      return fill.cmds[1] - fill.box.x0;
    };
    expect(radius('A')).toBe(4);
    expect(radius('B')).toBe(10);
  });

  it('does not let a font list change what is drawn', () => {
    const plain = JSON.stringify(draw(FLOW).scene);
    for (const family of ['x;color:red', 'x) ; y', 'url(//evil.example/f)', '"url(x)"', '"open', "it's", 'a\nb', 'x{}', '<b>', '"a";"b"', 'a,,b', ', a', '']) {
      const result = draw(FLOW, { fontFamily: family, fontFamilyMono: family });
      expect(JSON.stringify(result.scene), family).toBe(plain);
      assertSafe(result, family);
    }
  });
});
