import { describe, expect, it } from 'vitest';
import type { SankeyModel } from '../../src/diagrams/sankey/db.js';
import type { Scene } from '../../src/draw/scene.js';
import { PeleError, parse, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertSafe, draw, itemById, items, lineOf, lines, paints, sceneProblem, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('sankey', /sankey/i);

const BASIC = 'sankey\na,b,5\na,c,3\nb,d,4\nc,d,1.239\n';

// The chart is drawn inside the padding of the picture.
const PAD = 8;

function configured(sankey: string, body = BASIC): string {
  return `---\nconfig:\n  sankey:\n${sankey
    .split('\n')
    .map((line) => '    ' + line)
    .join('\n')}\n---\n${body}`;
}

// What is drawn, without where in the source each part was written.
const picture = (scene: Scene): string => JSON.stringify([scene.shapes, scene.texts, scene.gradients]);

const node = (scene: Scene, id: string) => itemById(scene, id, 'pele-sankey-node')!;
const link = (scene: Scene, id: string) => itemById(scene, id, 'pele-sankey-link')!;

// A bar's rectangle, in the chart's own coordinates.
function bar(scene: Scene, id: string): { x: number; y: number; width: number; height: number } {
  const { box } = shapesOf(scene, node(scene, id))[0];
  return { x: box.x0 - PAD, y: box.y0 - PAD, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

const fillOf = (scene: Scene, item: ReturnType<typeof node>): string => shapesOf(scene, item)[0].paint;

// The lines of a node's label, which an outlined label draws twice.
const labelOf = (scene: Scene, id: string) => textsOf(scene, itemById(scene, id, 'pele-label')!);

describe('sankey rendering', () => {
  it('renders every documentation example, the same each time', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      expect(textOf(result.scene), where).not.toMatch(/NaN|undefined|Infinity/);
      expect(tryDraw(src), where).toEqual(result);
    }
    expect(rendered).toBeGreaterThanOrEqual(8);
  });

  it('draws a bar and a label per node and a band per link', () => {
    const { scene, type } = draw(BASIC);
    expect(type).toBe('sankey');
    expect(supports('sankey\na,b,1')).toBe(true);
    expect(supports('sankey-beta\na,b,1')).toBe(true);
    expect(items(scene, 'pele-sankey-node')).toHaveLength(4);
    expect(items(scene, 'pele-sankey-link')).toHaveLength(4);
    expect(items(scene, 'pele-label')).toHaveLength(4);
    expect(link(scene, 'a->b')).toBeDefined();
  });

  it('colors bars by series, in the order nodes first appear', () => {
    const { scene } = draw(BASIC);
    expect(fillOf(scene, node(scene, 'a'))).toBe('var(--pele-series-1,#4c78a8)');
    expect(fillOf(scene, node(scene, 'b'))).toBe('var(--pele-series-2,#f58518)');
    expect(fillOf(scene, node(scene, 'd'))).toBe('var(--pele-series-4,#e45756)');
  });

  it('has the default size of 600 by 400 plus padding', () => {
    const { width, height } = draw(BASIC);
    expect(width).toBe(616);
    expect(height).toBe(416);
  });

  it('honours width and height', () => {
    const { width, height, scene } = draw(configured('width: 300\nheight: 150'));
    expect(width).toBe(316);
    expect(height).toBe(166);
    expect(bar(scene, 'd').x).toBe(290);
  });

  it('shows values with two decimals, a prefix and a suffix, unless showValues is off', () => {
    const shown = draw(BASIC).scene;
    expect(lines(shown)).toEqual(['a 8', 'b 5', 'c 3', 'd 5.24']);
    expect(labelOf(shown, 'a')[0].spans.map((s) => [s.text, s.paint])).toEqual([['a ', undefined], ['8', 'var(--_m)']]);
    const money = draw(configured('prefix: "$"\nsuffix: " M"')).scene;
    expect(lines(money)[0]).toBe('a $8 M');
    // The affixes are decoded like any text, and a code that decodes to another is left as that.
    const coded = draw(configured('prefix: "&euro;"\nsuffix: " &amp;lt;"\nlabelStyle: outlined')).scene;
    expect(lines(coded)).toContain('a €8 &lt;');
    const hidden = draw(configured('showValues: false')).scene;
    expect(lines(hidden)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives nodes more room when values are shown, as Mermaid does', () => {
    const body = 'sankey\na,b,1\na,c,1\na,d,1\n';
    const gap = (scene: Scene): number => bar(scene, 'c').y - bar(scene, 'b').y - bar(scene, 'b').height;
    expect(gap(draw(body).scene)).toBeCloseTo(27, 1);
    expect(gap(draw(configured('showValues: false', body)).scene)).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(gap(draw(configured('showValues: false\nnodePadding: 40', body)).scene)).toBeCloseTo(40, 1);
  });

  it('honours nodeAlignment', () => {
    const body = 'sankey\na,b,4\nb,c,3\nc,d,3\nx,d,2\na,y,1\n';
    const x = (alignment: string, id: string): number => bar(draw(configured(`nodeAlignment: ${alignment}`, body)).scene, id).x;
    expect(x('justify', 'y')).toBe(590);
    expect(x('left', 'y')).toBeCloseTo(590 / 3, 1);
    expect(x('left', 'x')).toBe(0);
    expect(x('right', 'x')).toBeCloseTo((590 * 2) / 3, 1);
    expect(x('center', 'x')).toBeCloseTo((590 * 2) / 3, 1);
    expect(x('center', 'y')).toBeCloseTo(590 / 3, 1);
    expect(x('nonsense', 'y')).toBe(590);
  });

  it('honours linkColor', () => {
    // Without an idPrefix, gradient links take their source's colour.
    const color = (src: string): string => {
      const { scene } = draw(src);
      return fillOf(scene, link(scene, 'a->b'));
    };
    expect(color(BASIC)).toBe('var(--pele-series-1,#4c78a8)');
    expect(color(configured('linkColor: gradient'))).toBe('var(--pele-series-1,#4c78a8)');
    expect(color(configured('linkColor: source'))).toBe('var(--pele-series-1,#4c78a8)');
    expect(color(configured('linkColor: target'))).toBe('var(--pele-series-2,#f58518)');
    expect(color(configured('linkColor: "#a1a1a1"'))).toBe('#a1a1a1');
    expect(color(configured('linkColor: "url(#x)"'))).toBe('var(--pele-series-1,#4c78a8)');
    const { scene } = draw(BASIC);
    expect(scene.gradients).toBeUndefined();
    expect(paints(scene).filter((p) => p.includes('url('))).toEqual([]);
    expect(items(scene, 'pele-sankey-link').map((l) => shapesOf(scene, l)[0].opacity)).toEqual([0.4, 0.4, 0.4, 0.4]);
  });

  it('fills links with gradients when there is an idPrefix', () => {
    const { scene } = draw(BASIC, { idPrefix: 'p1' });
    expect(Object.keys(scene.gradients ?? {})).toHaveLength(4);
    const [first] = shapesOf(scene, link(scene, 'a->b'));
    expect(first.gradient).toMatch(/^p1-sankey-[a-z0-9]+$/);
    expect(first.paint).toBe('var(--pele-series-1,#4c78a8)');
    const gradient = scene.gradients![first.gradient!];
    expect(gradient.stops).toEqual([
      { offset: 0, paint: 'var(--pele-series-1,#4c78a8)' },
      { offset: 1, paint: 'var(--pele-series-2,#f58518)' },
    ]);
    expect(draw(BASIC, { idPrefix: 'p1' })).toEqual(draw(BASIC, { idPrefix: 'p1' }));
    const ids = (scene: Scene): string[] => Object.keys(scene.gradients ?? {});
    const other = draw('sankey\nx,y,2\n', { idPrefix: 'p1' }).scene;
    expect(ids(other)).toHaveLength(1);
    expect(ids(other).filter((id) => ids(scene).includes(id))).toEqual([]);
    for (const color of ['source', 'target', '"#a1a1a1"']) {
      expect(draw(configured(`linkColor: ${color}`), { idPrefix: 'p1' }).scene.gradients).toBeUndefined();
    }
  });

  it('takes gradient colours from nodeColors', () => {
    const { scene } = draw(configured('nodeColors:\n  a: "#123456"\n  b: "url(#x)"'), { idPrefix: 'p_1' });
    const [first] = shapesOf(scene, link(scene, 'a->b'));
    expect(first.gradient).toMatch(/^p_1-sankey-[a-z0-9]+$/);
    expect(first.paint).toBe('#123456');
    expect(scene.gradients![first.gradient!].stops.map((s) => s.paint)).toEqual(['#123456', 'var(--pele-series-2,#f58518)']);
    expect(paints(scene).filter((p) => p.includes('url('))).toEqual([]);
  });

  it('keeps nodeColors with markup characters in gradients', () => {
    const { scene } = draw(configured(`nodeColors:\n  a: 'red&blue'\n  b: 'x"y'`), { idPrefix: 'p1' });
    const [first] = shapesOf(scene, link(scene, 'a->b'));
    expect(scene.gradients![first.gradient!].stops.map((s) => s.paint)).toEqual(['red&blue', 'x"y']);
  });

  it('keeps links flat when the idPrefix could not appear in a url()', () => {
    for (const idPrefix of ['p"1', 'p)1', 'p 1', '']) {
      const { scene } = draw(BASIC, { idPrefix });
      expect(scene.gradients, idPrefix).toBeUndefined();
      expect(fillOf(scene, link(scene, 'a->b')), idPrefix).toBe('var(--pele-series-1,#4c78a8)');
    }
  });

  it('honours nodeWidth, nodeColors and labelStyle', () => {
    expect(bar(draw(configured('nodeWidth: 24')).scene, 'a').width).toBe(24);
    const { scene: colored } = draw(configured('linkColor: source\nnodeColors:\n  a: "#123456"\n  d: "url(#x)"\n  __proto__: red'));
    expect(fillOf(colored, node(colored, 'a'))).toBe('#123456');
    expect(fillOf(colored, link(colored, 'a->b'))).toBe('#123456');
    expect(paints(colored).filter((p) => p.includes('url('))).toEqual([]);
    const legacy = draw(BASIC).scene;
    const outlined = draw(configured('labelStyle: outlined'));
    expect(labelOf(legacy, 'd').map((t) => t.anchor)).toEqual(['end']);
    // An outlined label is a halo in the background colour with the text over it.
    expect(labelOf(outlined.scene, 'd').map((t) => [t.anchor, t.paint, t.stroke])).toEqual([
      ['start', 'none', 'var(--_bg)'],
      ['start', 'var(--_fg)', undefined],
    ]);
    expect(outlined.width).toBeGreaterThan(616);
  });

  it('puts each label on the side of its bar that faces the middle', () => {
    const { scene } = draw(BASIC);
    expect(labelOf(scene, 'a')[0].anchor).toBe('start');
    expect(labelOf(scene, 'd')[0].anchor).toBe('end');
  });

  it('keeps adjacent-column labels clear without moving the bars', () => {
    const source = `sankey-beta
Visitors,Signed up,3200
Visitors,Bounced,9800
Signed up,Opened a folder,2100
Signed up,Never returned,1100
Opened a folder,Ran Agency,1450
Opened a folder,Write-only,650
Ran Agency,Upgraded to Pro,380
Ran Agency,Stayed free,1070
Upgraded to Pro,Upgraded to Team,96
Upgraded to Pro,Stayed on Pro,284`;
    for (const fontSize of [14, 16]) {
      const { scene } = draw(source, { fontSize, maxWidth: 664 });
      const bounds = (id: string): [number, number, number] => {
        const [label] = labelOf(scene, id);
        const width = metricsMeasurer.width(lineOf(label), Math.round(fontSize * 0.875), 0);
        const left = label.x - (label.anchor === 'end' ? width : 0);
        return [left, left + width, label.y];
      };
      const a = bounds('Opened a folder');
      const b = bounds('Ran Agency');
      expect(a[1] <= b[0] || b[1] <= a[0] || Math.abs(a[2] - b[2]) >= Math.round(fontSize * 0.875) * 1.5).toBe(true);
      expect(lines(scene)).toContain('Ran Agency 1450');
      const hidden = draw(configured('showValues: false', source), { fontSize }).scene;
      expect(items(scene, 'pele-sankey-node').map((n) => bar(scene, n.id).x)).toEqual(items(hidden, 'pele-sankey-node').map((n) => bar(hidden, n.id).x));
    }
  });

  it('keeps a moved label beside its own bar', () => {
    const { scene } = draw(configured('showValues: false', 'sankey\nA,B,1\nC,D,200\nE,F,1\nF,G,600\nG,D,200\nB,D,1\n'));
    const label = labelOf(scene, 'E')[0].y - Math.round(16 * 0.875) * 0.35;
    const span = (id: string): [number, number] => {
      const { y, height } = bar(scene, id);
      return [y + PAD, y + PAD + height];
    };
    const gap = ([top, bottom]: [number, number]): number => Math.max(0, top - label, label - bottom);
    expect(gap(span('E'))).toBeLessThan(gap(span('C')));
  });

  it('shrinks labels in narrow or crowded charts, down to 10px', () => {
    const labelSize = (src: string, extra = {}): number => draw(src, extra).scene.texts[0].size;
    const fan = (n: number): string => 'sankey\n' + Array.from({ length: n }, (_, i) => `s${i},t,1\n`).join('');
    expect(labelSize(BASIC)).toBe(14);
    expect(labelSize(fan(20))).toBe(11);
    expect(labelSize(fan(60))).toBe(10);
    const narrow = labelSize(BASIC, { maxWidth: 320 });
    expect(narrow).toBeLessThan(14);
    expect(narrow).toBeGreaterThanOrEqual(10);
    expect(labelSize(fan(20), { fontSize: 32 })).toBe(20);
  });

  it('grows the picture to hold labels that reach outside the chart', () => {
    const { width, scene } = draw(configured('labelStyle: outlined', 'sankey\nA,Somewhere with a very long name indeed,1\n'));
    expect(width).toBeGreaterThan(800);
    expect(scene.w).toBe(width);
  });

  it('keeps quoted fields, escaped quotes and odd characters as node names', () => {
    const model = parse('sankey\n"Heating, ""homes""",Agricultural \'waste\',1\n  Lighting & appliances - commercial  , Over generation / exports ,2\n');
    expect(model.type).toBe('sankey');
    if (model.type === 'sankey') {
      expect(model.nodes.map((node) => node.id)).toEqual(['Heating, "homes"', "Agricultural 'waste'", 'Lighting & appliances - commercial', 'Over generation / exports']);
      expect(model.links.map((link) => [link.source.id, link.target.id, link.value])).toEqual([
        ['Heating, "homes"', "Agricultural 'waste'", 1],
        ['Lighting & appliances - commercial', 'Over generation / exports', 2],
      ]);
    }
    const { scene } = draw('sankey\n"Heating, ""homes""",Lighting & appliances,1\n');
    expect(lines(scene)).toEqual(['Heating, "homes" 1', 'Lighting & appliances 1']);
  });

  for (const keyword of ['sankey', 'sankey-beta']) {
    for (const [from, to] of [
      ['Доход', 'Расходы'],
      ['Café', 'München'],
      ['収入', '支出'],
      ['☀️', '🏠'],
      ['Cafe\u0301', 'Cafe\u0300'],
    ]) {
      for (const quoted of [false, true]) {
        it(`keeps Unicode names ${from}, ${to} with ${keyword}, quoted=${quoted}`, () => {
          const field = (name: string): string => quoted ? `"${name}"` : name;
          const src = `${keyword}\n${field(from)},${field(to)},100\n`;
          const model = parse(src);
          expect(model.type).toBe('sankey');
          if (model.type === 'sankey') {
            expect(model.nodes.map((node) => node.id)).toEqual([from, to]);
            expect(model.links.map((link) => [link.source.id, link.target.id, link.value])).toEqual([[from, to, 100]]);
          }
          const { scene } = draw(src);
          expect(node(scene, from)).toBeDefined();
          expect(node(scene, to)).toBeDefined();
          expect(lines(scene)).toEqual([`${from} 100`, `${to} 100`]);
        });
      }
    }

    it(`keeps CSV escaping and node identity with Unicode names in ${keyword}`, () => {
      const src = `${keyword}\n"Доход, ""чистый""",Café,2\nCafé,収入,1\n`;
      const model = parse(src);
      expect(model.type).toBe('sankey');
      if (model.type === 'sankey') {
        expect(model.nodes.map((node) => node.id)).toEqual(['Доход, "чистый"', 'Café', '収入']);
        expect(model.links[0].target).toBe(model.links[1].source);
      }
      const { scene } = draw(src);
      expect(lines(scene)).toContain('Доход, "чистый" 2');
    });

    it(`decodes entity codes in Unicode names in ${keyword}`, () => {
      const src = `${keyword}\n"Доход #35; #amp; #34;чистый#34;",Расходы,1\n`;
      for (const labelStyle of ['normal', 'outlined']) {
        const { scene } = draw(configured(`labelStyle: ${labelStyle}`, src));
        expect(lines(scene)).toContain('Доход # & "чистый" 1');
        expect(node(scene, 'Доход # & "чистый"')).toBeDefined();
        expect(link(scene, 'Доход # & "чистый"->Расходы')).toBeDefined();
        expect(textOf(scene)).not.toMatch(/ﬂ°|¶ß/);
      }
    });

    it(`rejects malformed CSV containing Unicode names in ${keyword}`, () => {
      for (const row of ['Доход,Расходы', 'Доход,Расходы,1,2', '"Доход,Расходы,1', '"Доход"x,Расходы,1', 'Доход,,1']) {
        expect(() => parse(`${keyword}\n${row}\n`), row).toThrow(PeleError);
      }
    });

    it(`rejects control characters and invalid Unicode in names in ${keyword}`, () => {
      for (const c of ['\x00', '\x01', '\t', '\x1f', '\x7f', '\x80', '\x9f', '\ud800', '\udfff', '\ufffe', '\uffff']) {
        for (const name of [`a${c}b`, `"a${c}b"`]) {
          expect(() => parse(`${keyword}\n${name},c,1\n`), JSON.stringify(name)).toThrow(PeleError);
        }
      }
    });

    it(`rejects entity codes for invalid XML characters in ${keyword}`, () => {
      for (const entity of ['#65534;', '#65535;', '&#65534;', '&#65535;', '#1;']) {
        for (const name of [`a${entity}`, `"a${entity}"`]) {
          for (const row of [`${name},b,1`, `b,${name},1`]) {
            const src = `${keyword}\n${row}\n`;
            expect(() => parse(src), src).toThrow(/Invalid XML character in node name/);
            for (const labelStyle of ['normal', 'outlined']) {
              expect(() => draw(configured(`labelStyle: ${labelStyle}`, src)), src).toThrow(PeleError);
            }
          }
        }
      }
    });

    it(`shows a double-encoded entity code as text in ${keyword}`, () => {
      for (const name of ['a#amp;#35;xFFFE;', '"a#amp;#35;xFFFE;"']) {
        const { scene } = draw(`${keyword}\n${name},b,1\n`);
        expect(lines(scene)).toContain('a&#xFFFE; 1');
      }
    });

    it(`keeps hexadecimal HTML entity output XML-safe in ${keyword}`, () => {
      for (const entity of ['&#xFFFE;', '&#xFFFF;', '&#x01;']) {
        const src = `${keyword}\nДоход ${entity},Расходы,1\n`;
        for (const labelStyle of ['normal', 'outlined']) {
          const result = draw(configured(`labelStyle: ${labelStyle}`, src));
          expect(sceneProblem(result)).toBeUndefined();
          expect(textOf(result.scene)).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/u);
        }
      }
    });
  }

  it('accepts comments, blank lines and both keywords', () => {
    const a = draw('sankey-beta\n\n%% source,target,value\na,b,1\n\n\nb,c,2\n').scene;
    const b = draw('sankey\na,b,1\nb,c,2').scene;
    expect(picture(a)).toBe(picture(b));
  });

  it('draws the front matter title', () => {
    const plain = draw(BASIC);
    const titled = draw(`---\ntitle: Energy flows\n---\n${BASIC}`);
    expect(lines(titled.scene)).toContain('Energy flows');
    expect(titled.scene.texts.find((t) => lineOf(t) === 'Energy flows')!.weight).toBe(700);
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it('rejects circular links at render time, as d3-sankey fails on them', () => {
    expect(() => draw('sankey\na,b,1\nb,c,1\nc,a,1\n')).toThrow(/circular links.*"[abc]" is part of one/);
    expect(() => draw('sankey\na,a,1\n')).toThrow(PeleError);
    expect(parse('sankey\na,b,1\nb,a,1\n').type).toBe('sankey');
  });

  it('rejects what Mermaid rejects', () => {
    for (const src of ['sankey\n', 'sankey\na,b\n', 'sankey\na,b,1,2\n', 'sankey\na,,1\n', 'sankey\n"",b,1\n', 'sankey x\na,b,1\n']) {
      expect(() => draw(src), src).toThrow(PeleError);
    }
    expect(() => draw('sankey\na,b\n')).toThrow(/Expecting 'COMMA', 'NEWLINE', 'EOF', got 'EOF'|Expecting 'COMMA'/);
  });

  it('reads values that start with a number, and refuses the rest', () => {
    expect(lines(draw('sankey\na,b,50%\nb,c, 2e1 kWh\n').scene)).toEqual(['a 50', 'b 50', 'c 20']);
    for (const value of ['abc', '', 'Infinity', '1e400', '-']) {
      expect(() => draw(`sankey\na,b,1\nb,c,${value}\n`), value).toThrow(expect.objectContaining({ code: 'syntax', line: 3, column: 5 }));
    }
  });

  it('reports the line of an error after blank lines', () => {
    expect(() => parse('sankey\n\na,b,1\n\nb,c,abc')).toThrow(expect.objectContaining({ line: 5, column: 5 }));
    expect(() => parse('sankey\n\na,b,1\n\nb,c,abc')).toThrow(/^Parse error on line 5:\nb,c,abc\n/);
  });

  it('ignores blanks at the start and end of each row', () => {
    const links = (src: string): string[] =>
      (parse(src) as SankeyModel).links.map((link) => `${link.source.id}>${link.target.id}:${link.value}`);
    expect(links('sankey-beta \na,b,1')).toEqual(['a>b:1']);
    expect(links('sankey-beta\n\ta,b,1\nc,d,2')).toEqual(['a>b:1', 'c>d:2']);
    expect(links('sankey-beta\na,b,1\n   \nc,d,2')).toEqual(['a>b:1', 'c>d:2']);
    expect(links('sankey-beta\na,b,1\n "c d",e,2')).toEqual(['a>b:1', 'c d>e:2']);
    expect(links('sankey-beta\nd,e,"2" \ng,h,3')).toEqual(['d>e:2', 'g>h:3']);
    expect(links('sankey\n"a  \n  b",c,1')).toEqual(['a  \n  b>c:1']);
    expect(links('sankey\na,b,1\n ,c,2')).toEqual(['a>b:1', '>c:2']);
  });

  it('reports errors after blanks at row edges where they are written', () => {
    expect(() => parse('sankey \n\t a,b,1 \n  \n \tb,c,abc ')).toThrow(expect.objectContaining({ line: 4, column: 7 }));
    expect(() => parse('sankey\n "a \n b", c ,x')).toThrow(expect.objectContaining({ line: 3, column: 9 }));
    expect(() => parse('sankey\n a,b,1 \n c,d')).toThrow(expect.objectContaining({ line: 3, column: 5 }));
  });

  it('draws non-positive values as empty flows', () => {
    const result = draw('sankey\na,b,0\na,c,-3\nb,d,0\nc,d,2\n');
    assertSafe(result, 'non-positive values');
    expect(items(result.scene, 'pele-sankey-link')).toHaveLength(4);
    expect(link(result.scene, 'a->b')).toBeDefined();
  });
});
