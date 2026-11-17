import { describe, expect, it } from 'vitest';
import { PeleError, parse, renderScene } from '../src/index.js';
import { tokenize } from '../src/diagrams/flowchart/lexer.js';
import { encodeEntities, preprocess } from '../src/preprocess.js';
import { metricsMeasurer } from '../src/text/measurer.js';

// Inputs built to trigger worst cases: regex backtracking, quadratic scans, deep recursion,
// and oversized layouts. Each must finish quickly and either succeed or fail with a PeleError.
// The bounds are loose; a regression here is seconds or a hang, not milliseconds.

const N = 50000;
const big = { measurer: metricsMeasurer, limit: Infinity, maxEdges: Infinity };
const repeat = (count: number, line: (i: number) => string): string => Array.from({ length: count }, (_, i) => line(i)).join('');

const CASES: [string, () => unknown][] = [
  ['a quoted front matter value of blanks', () => preprocess('---\ntitle: "' + ' '.repeat(N - 100) + 'x"\n---\ngraph TD\nA')],
  ['a single-quoted front matter value of tabs', () => preprocess("---\ntitle: '" + '\t'.repeat(N - 100) + "x'\n---\ngraph TD\nA")],
  ['a quoted front matter value of blank lines', () => preprocess('---\ntitle: "' + (' '.repeat(98) + '\n').repeat(450) + 'x"\n---\ngraph TD\nA')],
  [
    'edges that each cross 1,000 nested subgraph borders',
    () =>
      renderScene(
        'flowchart TD\n' + repeat(1000, (i) => `subgraph g${i}\n`) + 'inner\n' + 'end\n'.repeat(1000) + repeat(2000, (i) => `out${i % 50} --> inner\n`),
        big
      ),
  ],
  ['a markdown label that is already bold, with 10,000 markers', () => renderScene('flowchart TD\n  A["`' + '**a** '.repeat(5000) + '`"]\n  style A font-weight:bold\n', big)],
  ['comment stripping over blank lines', () => preprocess('graph TD\n' + ('\n' + ' '.repeat(4)).repeat(10000) + '%% c\nA')],
  ['unterminated comment markers', () => preprocess('graph TD\nA\n%%' + 'x%%'.repeat(16000))],
  ['tag-like text with no closing bracket', () => preprocess('graph TD\nA["' + '<a'.repeat(N / 2) + '"]')],
  ['unclosed init directive', () => preprocess('%%{init: ' + '{"a":'.repeat(8000) + '\ngraph TD\nA')],
  ['front matter fence over blank lines', () => preprocess('---\n' + ' \n'.repeat(16000) + 'graph TD\nA')],
  ['style with colors and no semicolon', () => encodeEntities('graph TD\nstyle A ' + 'style:x#'.repeat(N / 8))],
  ['classDef made of colons and hashes', () => encodeEntities('classDef ' + ':#'.repeat(N / 2))],
  ['long line that mentions direction', () => tokenize('graph TD;' + 'A-->B;'.repeat(N / 6) + 'direction XX')],
  ['long unspaced chain ending in metadata', () => tokenize('graph TD;A' + '-->D'.repeat(N / 4) + '@{shape: rect}\n')],
  ['edge text of spaces', () => tokenize('graph TD;A -- ' + ' '.repeat(N) + 'x --> B')],
  ['edge text of link-like characters', () => tokenize('graph TD;A -- ' + 'xo< -'.repeat(N / 5) + ' --> B')],
  ['ellipse text of spaces and tildes', () => tokenize('graph TD;A(-' + ' ~'.repeat(N / 2) + '-)')],
  ['runs of dashes, dots, equals', () => tokenize('graph TD;A' + '-'.repeat(N) + '.'.repeat(N) + '='.repeat(N))],
  ['20,000 nested subgraphs', () => parse('graph TD\n' + 'subgraph s\n'.repeat(20000) + 'A\n' + 'end\n'.repeat(20000), big)],
  ['3,000 nested subgraphs, rendered', () => renderScene('graph TD\n' + repeat(3000, (i) => `subgraph s${i}\n`) + 'A-->B\n' + 'end\n'.repeat(3000), big)],
  ['deeply bracketed metadata', () => parse('graph TD\nA@{ a: ' + '['.repeat(20000) + ' }\n', big)],
  ['unclosed metadata over many lines', () => parse('graph TD\nA@{\n a: {\n' + ' b: 1,\n'.repeat(5000) + '}\n', big)],
  ['5,000 sibling subgraphs', () => renderScene('graph TD\n' + repeat(5000, (i) => `subgraph s${i}\nn${i}\nend\n`), big)],
  ['chain of 5,000', () => renderScene('graph TD\n' + repeat(5000, (i) => `n${i}-->n${i + 1}\n`), big)],
  ['star of 5,000', () => renderScene('graph TD\n' + repeat(5000, (i) => `c-->n${i}\n`), big)],
  ['3,000 long edges over a chain of 3,000', () => renderScene('graph TD\n' + repeat(3000, (i) => `n${i}-->n${i + 1}\nn0-->n${i + 2}\n`), big)],
  ['complete graph of 60', () => {
    let s = 'graph TD\n';
    for (let i = 0; i < 60; i++) for (let j = i + 1; j < 60; j++) s += `n${i}-->n${j}\n`;
    return renderScene(s, big);
  }],
  ['2,000 parallel edges and 2,000 self loops', () => renderScene('graph TD\n' + 'A-->B\n'.repeat(2000) + 'A-->A\n'.repeat(2000), big)],
  ['one 50,000 character label', () => renderScene('graph TD\nA["' + 'word '.repeat(N / 5) + '"]', big)],
  ['label of emphasis markers', () => renderScene('graph TD\nA["`' + '*a _b '.repeat(N / 6) + '`"]', big)],
  ['label of entities and line breaks', () => renderScene('graph TD\nA["' + '#35;&amp;<br>'.repeat(N / 13) + '"]', big)],
  ['label of unclosed entity placeholders', () => renderScene('graph TD\nA["' + 'ﬂ°'.repeat(N / 2) + '¶x"]', big)],
  ['metadata key followed by spaces', () => parse('graph TD\nA@{\n a' + ' '.repeat(N) + '\n}\n', big)],
  ['link wrapped in layers of entity encoding', () => renderScene('graph TD\nA\nclick A "&' + '#38;'.repeat(N / 4) + 'x"', big)],
  ['1,000 edges of length ten', () => renderScene('graph TD\n' + repeat(1000, (i) => `n${i} ------------> n${i + 1}\n`), big)],
];

describe('worst cases', () => {
  for (const [name, run] of CASES) {
    it(name, () => {
      const started = performance.now();
      try {
        run();
      } catch (error) {
        expect(error, (error as Error).message).toBeInstanceOf(PeleError);
      }
      expect(performance.now() - started).toBeLessThan(3000);
    }, 30_000);
  }

  it('refuses more edges than the limit before making them', () => {
    const ids = (prefix: string, count: number): string => Array.from({ length: count }, (_, i) => prefix + i).join(' & ');
    // Two thousand names on each side of one arrow ask for four million edges.
    const product = `${ids('a', 2000)} --> ${ids('b', 2000)}`;
    for (const source of [`flowchart LR\n${product}`, `agentflow-beta LR\n${product}`]) {
      const started = performance.now();
      expect(() => renderScene(source, { measurer: metricsMeasurer }), source.slice(0, 14)).toThrow(/Edge limit exceeded.*limit is 5000/);
      expect(performance.now() - started, source.slice(0, 14)).toBeLessThan(2000);
    }
    const chain = (count: number): string => 'flowchart LR\n' + repeat(count, (i) => `N${i} --> N${i + 1}\n`);
    expect(renderScene(chain(5000), { measurer: metricsMeasurer, limit: Infinity }).scene.shapes.length).toBeGreaterThan(0);
    expect(() => renderScene(chain(5001), { measurer: metricsMeasurer, limit: Infinity })).toThrow(PeleError);
    expect(() => renderScene(chain(11), { measurer: metricsMeasurer, maxEdges: 10 })).toThrow('Edge limit exceeded. The limit is 10.');
    expect(() => parse(chain(11), { maxEdges: 10 })).toThrow(/limit is 10\b/);
    try {
      renderScene(chain(11), { maxEdges: 10 });
    } catch (error) {
      expect((error as PeleError).code).toBe('limit');
    }
    // A diagram cannot raise the limit for itself.
    const raised = `---\nconfig:\n  maxEdges: 100000\n  flowchart:\n    maxEdges: 100000\n---\n%%{init: {'maxEdges': 100000}}%%\n${chain(11)}`;
    expect(() => renderScene(raised, { measurer: metricsMeasurer, maxEdges: 10 })).toThrow(/limit is 10\b/);
  });

  it('refuses source over the default limit', () => {
    expect(() => renderScene('graph TD\n' + 'A-->B\n'.repeat(10000))).toThrow(/limit of 50000/);
    expect(renderScene('graph TD\n' + 'A-->B\n'.repeat(10000), big).scene.shapes.length).toBeGreaterThan(0);
  });
});
