import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports } from '../../src/index.js';
import type { Scene, SceneShape } from '../../src/draw/scene.js';
import { random } from '../support/corpus.js';
import { NOTATIONS, corpusFor, grammar } from '../support/railroad-oracle.js';
import { assertSafe, draw as drawSource, itemById, items, lineOf, lines, shapesOf, textsOf, tryDraw } from '../support/scene.js';

const ebnf = (rules: string, extra: object = {}) => drawSource('railroad-ebnf-beta\n' + rules, extra);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Path commands are a flat list: an op code, then that op's numbers.
const ARGC = [2, 2, 6, 4, 7, 0];
const ARC = 4;

interface Arc {
  rx: number;
  sweep: number;
  dx: number;
  dy: number;
}

// The arcs of a path, with how far each one runs.
function arcs(cmds: number[]): Arc[] {
  const out: Arc[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) {
    const n = ARGC[cmds[i]];
    if (n === 0) continue;
    const [nx, ny] = [cmds[i + n - 1], cmds[i + n]];
    if (cmds[i] === ARC) out.push({ rx: cmds[i + 1], sweep: cmds[i + 5], dx: nx - x, dy: ny - y });
    x = nx;
    y = ny;
  }
  return out;
}

const allArcs = (scene: Scene): Arc[] => scene.shapes.flatMap((s) => arcs(s.cmds));

// The boxes of terminals, non-terminals and special sequences, left to right and top to bottom as drawn.
function rects(scene: Scene): Rect[] {
  return scene.shapes
    .filter((s) => s.kind === 'fill' && s.cmds.length === 48)
    .map((s) => ({ x: s.box.x0, y: s.box.y0, w: s.box.x1 - s.box.x0, h: s.box.y1 - s.box.y0 }));
}

// Terminals are filled; the rest are hollow.
const terminals = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'fill' && s.cmds.length === 48 && s.paint === 'var(--_s)');
// Special sequences, and predicates drawn like them, have a dashed border.
const specials = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'stroke' && s.dash?.join(' ') === '4 3');
// Markers are circles; an arrowhead on a loop is a triangle.
const dots = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'fill' && s.cmds.length === 20);
const arrowheads = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'fill' && s.cmds.length === 10);
const tracks = (scene: Scene): SceneShape[] => scene.shapes.filter((s) => s.kind === 'stroke' && s.paint === 'var(--_l)' && s.cmds.length !== 20 && s.item >= 0);

// Whether two scenes draw the same, whatever lines of the source their items came from.
const look = ({ items: parts, ...rest }: Scene): string => JSON.stringify([rest, parts.map(({ id, kind, role, box }) => [id, kind, role, box])]);
const same = (a: Scene, b: Scene): boolean => look(a) === look(b);

// Every box inside the drawing, no two boxes overlapping, and every track coordinate inside the drawing.
function assertTidy(scene: Scene, width: number, height: number, where: string): void {
  const boxes = rects(scene);
  for (const box of boxes) {
    expect(Number.isFinite(box.x + box.y + box.w + box.h), where).toBe(true);
    expect(box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height, `${where}: box inside`).toBe(true);
  }
  if (boxes.length <= 400) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${where}: boxes ${i} and ${j} overlap`).toBe(true);
      }
    }
  }
  for (const shape of scene.shapes) {
    for (let i = 0; i < shape.cmds.length; i += 1 + ARGC[shape.cmds[i]]) {
      if (shape.cmds[i] > 1) continue;
      const [x, y] = [shape.cmds[i + 1], shape.cmds[i + 2]];
      expect(x >= 0 && x <= width, `${where}: x ${x}`).toBe(true);
      expect(y >= 0 && y <= height, `${where}: y ${y}`).toBe(true);
    }
  }
}

describe('railroad rendering', () => {
  it('accepts the four keywords as one diagram type', () => {
    const sources = [
      'railroad-beta\nr = terminal("a") ;',
      'railroad-ebnf-beta\nr = "a" ;',
      'railroad-abnf-beta\nr = "a" ;',
      'railroad-peg-beta\nr <- "a" ;',
    ];
    const notations = ['railroad', 'ebnf', 'abnf', 'peg'];
    sources.forEach((src, i) => {
      expect(detectType(src)).toBe('railroad');
      expect(supports(src)).toBe(true);
      const model = parse(src);
      expect(model.type).toBe('railroad');
      if (model.type === 'railroad') {
        expect(model.notation).toBe(notations[i]);
        expect(model.rules).toEqual([{ name: 'r', definition: { type: 'terminal', value: 'a' } }]);
      }
      const { scene, type } = drawSource(src);
      expect(type).toBe('railroad');
      expect(terminals(scene).length).toBe(1);
    });
    // The four drawings differ in nothing but the notation they were written in.
    expect(new Set(sources.map((src) => look(drawSource(src).scene))).size).toBe(1);
  });

  it('detects a keyword in any case, as Mermaid does, and then rejects it', () => {
    expect(detectType('Railroad-EBNF-Beta\nr = "a" ;')).toBe('railroad');
    expect(() => drawSource('Railroad-EBNF-Beta\nr = "a" ;')).toThrow(PeleError);
    expect(() => drawSource('RAILROAD-BETA\nr = terminal("a") ;')).toThrow(/railroad-beta/);
  });

  it('draws one diagram per rule with a heading, markers, and a track', () => {
    const { scene } = ebnf('first = "a" b ;\nsecond = c ;');
    expect(items(scene, 'pele-rule').length).toBe(2);
    const first = itemById(scene, 'first', 'pele-rule')!;
    expect(first).toBeDefined();
    const name = textsOf(scene, first)[0];
    expect(lineOf(name)).toBe('first');
    expect(name.weight).toBeGreaterThan(400);
    // A start and an end for each rule.
    expect(dots(scene).length).toBe(4);
    expect(tracks(scene).length).toBe(2);
  });

  it('draws terminals as pills and non-terminals as boxes that name their rule', () => {
    const { scene } = ebnf('r = "lit" name ;');
    const [terminal, nonterminal] = rects(scene);
    expect(terminals(scene).length).toBe(1);
    // A pill is as round as its height allows.
    expect(arcs(terminals(scene)[0].cmds).every((a) => a.rx === 15)).toBe(true);
    expect(itemById(scene, 'name', 'pele-nonterminal')).toBeDefined();
    expect(shapesOf(scene, itemById(scene, 'name')!).some((s) => s.kind === 'fill' && s.paint === 'var(--_bg)')).toBe(true);
    expect(arcs(shapesOf(scene, itemById(scene, 'name')!)[0].cmds).every((a) => a.rx < 15)).toBe(true);
    // Terminals are written in the monospace face.
    expect(scene.texts.find((t) => lineOf(t) === 'lit')!.spans[0].mono).toBe(true);
    expect(scene.texts.find((t) => lineOf(t) === 'name')!.spans[0].mono).toBeFalsy();
    expect(terminal.h).toBe(30);
    // Left to right on one baseline.
    expect(nonterminal.x).toBeGreaterThan(terminal.x + terminal.w);
    expect(nonterminal.y).toBe(terminal.y);
  });

  it('keeps the first alternative on the track and stacks the rest below it', () => {
    const one = ebnf('r = a ;');
    const { scene, height } = ebnf('r = a | bb | "c" ;');
    const [a, b, c] = rects(scene);
    expect(a.y).toBe(rects(one.scene)[0].y);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
    expect(c.y).toBeGreaterThanOrEqual(b.y + b.h);
    expect(a.x + a.w / 2).toBe(b.x + b.w / 2);
    expect(height).toBeGreaterThan(one.height);
    // Two quarter turns of one radius switch a branch off the track and back on.
    const turns = allArcs(scene).filter((arc) => arc.rx === 10 && arc.dx === 10 && arc.dy === 10);
    expect(turns.filter((arc) => arc.sweep === 1).length).toBe(1);
    expect(turns.filter((arc) => arc.sweep === 0).length).toBe(2);
  });

  it('draws an optional element with a bypass over it', () => {
    const plain = ebnf('r = a ;');
    const optional = ebnf('r = [ a ] ;');
    expect(same(optional.scene, ebnf('r = a? ;').scene)).toBe(true);
    expect(optional.width).toBe(plain.width + 40);
    expect(optional.height).toBeGreaterThan(plain.height);
    // The bypass leaves room above; the element stays on the track.
    expect(rects(optional.scene)[0].y).toBeGreaterThan(rects(plain.scene)[0].y);
    expect(arrowheads(optional.scene)).toEqual([]);
  });

  it('draws repetition as a loop back under the element, with a bypass when it may be skipped', () => {
    const plain = ebnf('r = a ;');
    const more = ebnf('r = a+ ;');
    const any = ebnf('r = a* ;');
    expect(more.width).toBe(plain.width + 20);
    expect(rects(more.scene)[0].y).toBe(rects(plain.scene)[0].y);
    expect(more.height).toBeGreaterThan(plain.height);
    expect(arrowheads(more.scene).length).toBe(1);
    expect(same(any.scene, ebnf('r = { a } ;').scene)).toBe(true);
    expect(any.width).toBe(more.width + 40);
    expect(rects(any.scene)[0].y).toBeGreaterThan(rects(more.scene)[0].y);
  });

  it('writes ABNF repeat counts on the loop', () => {
    const abnf = (rule: string) => drawSource('railroad-abnf-beta\n' + rule).scene;
    expect(lines(abnf('r = 3a ;'))).toContain('3×');
    expect(lines(abnf('r = 2*4a ;'))).toContain('2–4×');
    expect(lines(abnf('r = 2*a ;'))).toContain('≥2×');
    expect(lines(abnf('r = *5a ;'))).toContain('≤5×');
    expect(lines(abnf('r = ' + '9'.repeat(400) + 'a ;'))).toContain('∞×');
    expect(lines(abnf('r = *a ;')).filter((line) => line.includes('×'))).toEqual([]);
    expect(lines(abnf('r = 1*a ;')).filter((line) => line.includes('×'))).toEqual([]);
    expect(same(abnf('r = 1a ;'), abnf('r = a ;'))).toBe(true);
    expect(same(abnf('r = 0*1a ;'), abnf('r = [ a ] ;'))).toBe(true);
  });

  it('draws special sequences dashed, and exceptions and predicates the way Mermaid models them', () => {
    const special = ebnf('r = ? any character ? ;').scene;
    expect(specials(special).length).toBe(1);
    const sequence = special.texts.find((t) => lineOf(t) === '? any character ?')!;
    expect(sequence.spans.map((s) => [s.text, s.paint])).toEqual([['? ', 'var(--_m)'], ['any character', undefined], [' ?', 'var(--_m)']]);
    const exception = ebnf('r = letter - "x" ;').scene;
    expect(terminals(exception).length).toBe(2);
    expect(lines(exception)).toContain('-');
    const peg = drawSource('railroad-peg-beta\nR <- !Keyword &"k" . !( a b ) ;').scene;
    expect(specials(peg).length).toBe(4);
    const spans = peg.texts.flatMap((t) => t.spans.map((s) => s.text));
    for (const text of ['!Keyword', '&"k"', '.', '!(...)']) expect(spans).toContain(text);
  });

  it('shows text as written', () => {
    const { scene } = drawSource(
      'railroad-beta\nr = sequence(terminal("<br>"), terminal("*a*"), terminal("#35;"), terminal("&lt;"), terminal(" "), terminal("a  b"), terminal("\\n\\t"), nonterminal("fa:fa-user")) ;'
    );
    for (const text of ['<br>', '*a*', '#', '&lt;', '␣', 'a  b', '\\n\\t', 'fa:fa-user']) expect(lines(scene), text).toContain(text);
  });

  it('reads rule names that start with title in each notation', () => {
    for (const src of [
      'railroad-beta\ntitles = nonterminal("title-x") ;\ntitle-x = terminal("a") ;',
      'railroad-ebnf-beta\ntitles = title-x ;\ntitle-x = "a" ;',
      'railroad-abnf-beta\ntitles = title-x ;\ntitle-x = "a" ;',
      'railroad-peg-beta\ntitles <- title-x ;\ntitle-x <- "a" ;',
    ]) {
      const model = parse(src);
      expect(model.type, src).toBe('railroad');
      if (model.type === 'railroad') expect(model.rules.map((r) => r.name), src).toEqual(['titles', 'title-x']);
      expect(itemById(drawSource(src).scene, 'title-x', 'pele-rule'), src).toBeDefined();
    }
  });

  it('takes the title from the diagram, or else from front matter', () => {
    const titleOf = (scene: Scene): string[] => scene.texts.filter((t) => t.item === -1).map(lineOf);
    const quoted = ebnf('title "Quoted \\"title\\""\nr = a ;').scene;
    expect(titleOf(quoted)).toEqual(['Quoted "title"']);
    expect(quoted.texts.find((t) => t.item === -1)!.weight).toBeGreaterThan(400);
    expect(titleOf(drawSource('---\ntitle: From front matter\n---\nrailroad-peg-beta\nR <- a ;').scene)).toEqual(['From front matter']);
    expect(titleOf(drawSource('---\ntitle: From front matter\n---\nrailroad-abnf-beta\ntitle Own\nr = a ;').scene)).toEqual(['Own']);
    expect(titleOf(ebnf('r = a ;').scene)).toEqual([]);
  });

  it('honours the railroad config keys that have a meaning here', () => {
    const src = 'railroad-ebnf-beta\nr = a ( b | c )* [ d ] ;\ns = e ;';
    const withConfig = (config: string) => drawSource(`---\nconfig:\n  railroad:\n${config}\n---\n${src}`);
    const plain = drawSource(src);
    expect(withConfig('    arcRadius: 20').width).toBeGreaterThan(plain.width);
    expect(allArcs(withConfig('    arcRadius: 20').scene).some((arc) => arc.rx === 20 && arc.dx === 20 && arc.dy === 20 && arc.sweep === 1)).toBe(true);
    expect(withConfig('    padding: 20').width).toBeGreaterThan(plain.width);
    expect(withConfig('    padding: 20').height).toBeGreaterThan(plain.height);
    expect(withConfig('    horizontalSeparation: 40').width).toBe(plain.width + 2 * 24);
    expect(withConfig('    horizontalSeparation: 40').height).toBe(plain.height);
    expect(withConfig('    verticalSeparation: 30').height).toBeGreaterThan(plain.height);
    expect(withConfig('    verticalSeparation: 30').width).toBe(plain.width);
    expect(new Set(withConfig('    fontSize: 20').scene.texts.map((t) => t.size))).toEqual(new Set([20]));
    expect(withConfig('    fontSize: 20').width).toBeGreaterThan(plain.width);
    expect(new Set(tracks(withConfig('    strokeWidth: 2').scene).map((s) => s.width))).toEqual(new Set([2]));
    expect(new Set(tracks(plain.scene).map((s) => s.width))).toEqual(new Set([1]));
    expect(new Set(dots(withConfig('    markerRadius: 8').scene).map((s) => s.box.x1 - s.box.x0))).toEqual(new Set([16]));
    expect(dots(withConfig('    showMarkers: false').scene)).toEqual([]);
    expect(withConfig('    showMarkers: false').width).toBe(plain.width - 16);
    expect(same(withConfig('    arcRadius: wide\n    padding: -4\n    fontSize: "x"').scene, plain.scene)).toBe(true);
    expect(same(drawSource(src, { config: { railroad: { arcRadius: 20 } } }).scene, withConfig('    arcRadius: 20').scene)).toBe(true);
  });

  it('draws a rule again when its name is defined again', () => {
    const { scene } = ebnf('r = a ;\nr = b ;');
    expect(items(scene, 'pele-rule').filter((rule) => rule.id === 'r').length).toBe(2);
    const model = parse('railroad-ebnf-beta\nr = a ;\nr = b ;');
    if (model.type === 'railroad') expect(model.rules.map((rule) => rule.definition)).toEqual([{ type: 'nonterminal', name: 'a' }, { type: 'nonterminal', name: 'b' }]);
  });

  it('draws a grammar with no rules', () => {
    const empty = drawSource('railroad-beta');
    expect(items(empty.scene)).toEqual([]);
    expect(empty.scene.shapes).toEqual([]);
    expect(lines(drawSource('railroad-ebnf-beta\ntitle Only a title').scene)).toContain('Only a title');
  });

  it('scales with the font size and is the same every time', () => {
    const src = 'railroad-ebnf-beta\nr = a ( b | "c" )+ ;';
    expect(JSON.stringify(drawSource(src).scene)).toBe(JSON.stringify(drawSource(src).scene));
    expect(drawSource(src, { fontSize: 24 }).width).toBeGreaterThan(drawSource(src).width);
  });

  it('keeps every box apart and inside the drawing', () => {
    let drawn = 0;
    for (const notation of NOTATIONS) {
      const rnd = random(11);
      const sources = [...corpusFor(notation).corpus];
      for (let i = 0; i < 80; i++) sources.push(grammar(notation, rnd));
      for (const src of sources) {
        const result = tryDraw(src);
        if (result === undefined) continue;
        assertSafe(result, JSON.stringify(src).slice(0, 200));
        assertTidy(result.scene, result.width, result.height, JSON.stringify(src).slice(0, 200));
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThan(300);
  }, 60_000);

  it('holds the same layout rules under unusual config', () => {
    const src = 'railroad-ebnf-beta\ntitle T\nr = a ( b | [ c d ] | { e | f } )+ g? ;\ns = ( ( a+ )+ | b* )* - "x" ;';
    for (const railroad of [
      { arcRadius: 0 },
      { arcRadius: 40, verticalSeparation: 0 },
      { padding: 0, horizontalSeparation: 0, verticalSeparation: 0 },
      { arcRadius: 7.5, padding: 3.3, verticalSeparation: 2.5, horizontalSeparation: 1.5, fontSize: 9.5 },
      { arcRadius: 1e9, padding: 1e9, fontSize: 1e9, markerRadius: 1e9, strokeWidth: 1e9 },
      { arcRadius: Infinity, padding: NaN, fontSize: -1, showMarkers: 'no', markerRadius: null },
    ]) {
      const result = drawSource(src, { config: { railroad } as never });
      assertSafe(result, JSON.stringify(railroad));
      assertTidy(result.scene, result.width, result.height, JSON.stringify(railroad));
    }
  });
});
