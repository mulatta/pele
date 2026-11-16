import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, supports, type SequenceModel } from '../../src/index.js';
import type { Scene, SceneItem, SceneShape } from '../../src/draw/scene.js';
import { loadCorpus } from '../support/corpus.js';
import { LINETYPE, PLACEMENT } from '../support/sequence-constants.js';
import { assertSafe, draw, hasClass, itemById, items, lineOf, lines, shapesOf, textOf, textsOf, tryDraw } from '../support/scene.js';

const corpus = loadCorpus('sequence', /sequenceDiagram/i);

const sceneOf = (src: string, extra: object = {}): Scene => draw(src, extra).scene;
const same = (a: Scene, b: Scene): boolean => JSON.stringify(a) === JSON.stringify(b);

function model(src: string): SequenceModel {
  const parsed = parse(src);
  if (parsed.type !== 'sequence') throw new Error('not a sequence diagram');
  return parsed;
}

// The x of each lifeline, by participant, in the order they are drawn.
function lifelines(scene: Scene): Map<string, number> {
  return new Map(items(scene, 'pele-lifeline').map((item) => [item.id, item.box!.x0]));
}

// Arguments after each path op code, as the scene's paths are written.
const ARGC = [2, 2, 6, 4, 7, 0];

// The op codes of a path: M 0, L 1, C 2, Q 3, A 4, Z 5.
function ops(cmds: number[]): string {
  let out = '';
  for (let i = 0; i < cmds.length; i += 1 + ARGC[cmds[i]]) out += cmds[i];
  return out;
}

const isCircle = (shape: SceneShape): boolean => ops(shape.cmds) === '0445';

const messages = (scene: Scene): SceneItem[] => items(scene, 'pele-message');
const message = (scene: Scene, id: string): SceneItem => itemById(scene, id, 'pele-message')!;
const labelOf = (scene: Scene, id: string): SceneItem => itemById(scene, id, 'pele-edge-label')!;
// The lines of a message's label.
const labelLines = (scene: Scene, id: string): string[] => textsOf(scene, labelOf(scene, id)).map(lineOf);

// The message whose label says `text`.
function messageSaying(scene: Scene, text: string): SceneItem {
  const t = scene.texts.find((candidate) => lineOf(candidate) === text)!;
  return message(scene, scene.items[t.item].id);
}

// The line of a message is the first thing it draws; its heads follow.
const line = (scene: Scene, item: SceneItem): SceneShape => shapesOf(scene, item)[0];
const heads = (scene: Scene, item: SceneItem): SceneShape[] => shapesOf(scene, item).slice(1);

describe('sequence rendering', () => {
  it('renders every corpus input that parses, as a scene a host can take', () => {
    let rendered = 0;
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertSafe(result, where);
      expect(textOf(result.scene), where).not.toMatch(/NaN|undefined|Infinity/);
      expect(tryDraw(src)!.scene, where).toEqual(result.scene);
    }
    expect(rendered).toBeGreaterThan(150);
  });

  it('reports size and type', () => {
    const result = draw('sequenceDiagram\n  Alice->>Bob: Hello');
    expect(result.type).toBe('sequence');
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(100);
    expect(result.links).toEqual([]);
  });

  it('is detected, supported, and parsed to a sequence model', () => {
    expect(detectType('sequenceDiagram\n A->>B: hi')).toBe('sequence');
    expect(supports('sequenceDiagram\n A->>B: hi')).toBe(true);
    const m = model('sequenceDiagram\n participant A as Alice\n A->>B: hi');
    expect([...m.actors.keys()]).toEqual(['A', 'B']);
    expect(m.actors.get('A')?.description).toBe('Alice');
    expect(m.messages).toHaveLength(1);
    expect(m.messages[0]).toMatchObject({ from: 'A', to: 'B', message: 'hi', type: LINETYPE.SOLID });
  });

  it('renders an empty diagram and a lone participant', () => {
    expect(draw('sequenceDiagram').width).toBeGreaterThan(0);
    const { scene } = draw('sequenceDiagram\n participant Solo');
    expect(items(scene, 'pele-actor')).toHaveLength(2);
  });

  it('mirrors participants at the bottom unless told not to', () => {
    const src = 'sequenceDiagram\n  Alice->>Bob: Hi';
    const mirrored = draw(src);
    const single = draw(src, { config: { sequence: { mirrorActors: false } } });
    expect(items(mirrored.scene, 'pele-actor')).toHaveLength(4);
    expect(items(mirrored.scene, 'pele-actor-footer')).toHaveLength(2);
    expect(items(single.scene, 'pele-actor')).toHaveLength(2);
    expect(single.height).toBeLessThan(mirrored.height);
    const directive = sceneOf(`%%{init: {"sequence": {"mirrorActors": false}}}%%\n${src}`);
    expect(items(directive, 'pele-actor-footer')).toHaveLength(0);
  });

  it('keeps participants in order of appearance and spaces them by their text', () => {
    const short = lifelines(sceneOf('sequenceDiagram\n  A->>B: hi\n  B->>C: hi'));
    const long = lifelines(sceneOf('sequenceDiagram\n  A->>B: a considerably longer message than before\n  B->>C: hi'));
    expect([...short.keys()]).toEqual(['A', 'B', 'C']);
    expect(short.get('A')!).toBeLessThan(short.get('B')!);
    expect(short.get('B')!).toBeLessThan(short.get('C')!);
    expect(long.get('B')! - long.get('A')!).toBeGreaterThan(short.get('B')! - short.get('A')! + 100);
    expect(long.get('C')! - long.get('B')!).toBeCloseTo(short.get('C')! - short.get('B')!, 1);
  });

  it('shares the width a long message needs among the gaps it crosses', () => {
    const x = lifelines(sceneOf('sequenceDiagram\n  participant A\n  participant B\n  participant C\n  A->>C: a message that is far too long for two default gaps to hold'));
    expect(x.get('B')! - x.get('A')!).toBeCloseTo(x.get('C')! - x.get('B')!, 1);
    expect(x.get('C')! - x.get('A')!).toBeGreaterThan(360);
  });

  it('widens a participant to its label and honors actorMargin', () => {
    const tight = lifelines(sceneOf('sequenceDiagram\n  participant A\n  participant B'));
    const wide = lifelines(sceneOf('sequenceDiagram\n  participant A\n  participant B', { config: { sequence: { actorMargin: 200 } } }));
    expect(wide.get('B')! - wide.get('A')!).toBe(tight.get('B')! - tight.get('A')! + 160);
    const labelled = lifelines(sceneOf('sequenceDiagram\n  participant A as A participant with a long description\n  participant B'));
    expect(labelled.get('B')! - labelled.get('A')!).toBeGreaterThan(tight.get('B')! - tight.get('A')! + 80);
  });

  it('draws each arrow type with its line and heads', () => {
    const one = (arrow: string): { line: SceneShape; heads: SceneShape[] } => {
      const scene = sceneOf(`sequenceDiagram\n  A${arrow}B: x`);
      const [item] = messages(scene);
      return { line: line(scene, item), heads: heads(scene, item) };
    };
    expect(one('->').heads).toHaveLength(0);
    expect(one('->').line.dash).toBeNull();
    expect(one('-->').line.dash).toBeTruthy();
    expect(one('->>').heads).toHaveLength(1);
    expect(one('-->>').line.dash).toBeTruthy();
    expect(one('<<->>').heads).toHaveLength(2);
    expect(one('<<-->>').heads).toHaveLength(2);
    // A cross is two strokes in one path, an open arrow a stroked head that is not filled.
    expect(ops(one('-x').heads[0].cmds)).toBe('0101');
    expect(one('-)').heads.map((h) => [h.kind, ops(h.cmds)])).toEqual([['stroke', '011']]);
    for (const half of ['-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-']) {
      expect(one(half).heads, half).toHaveLength(1);
      expect(one(half.replace('-', '--')).line.dash, half).toBeTruthy();
    }
  });

  it('puts a half head above or below the line as its name says', () => {
    const head = (arrow: string): number[] => {
      const scene = sceneOf(`sequenceDiagram\n  A${arrow}B: x`);
      const [h] = heads(scene, messages(scene)[0]);
      return [h.cmds[2], h.cmds[5], h.cmds[8]];
    };
    const top = head('-|\\');
    const bottom = head('-|/');
    expect(Math.min(...top)).toBeLessThan(top[0]);
    expect(Math.max(...top)).toBe(top[0]);
    expect(Math.max(...bottom)).toBeGreaterThan(bottom[0]);
    expect(Math.min(...bottom)).toBe(bottom[0]);
  });

  it('runs a message between the lifelines of its participants, in order from the top', () => {
    const scene = sceneOf('sequenceDiagram\n  A->>B: one\n  B-->>A: two');
    const x = lifelines(scene);
    const paths = messages(scene).map((m) => line(scene, m).cmds);
    expect(messages(scene).map((m) => m.id)).toEqual(['i0', 'i1']);
    expect(paths[0][1]).toBe(x.get('A'));
    expect(paths[0][4]).toBeLessThan(x.get('B')!);
    expect(paths[0][4]).toBeGreaterThan(x.get('B')! - 10);
    expect(paths[1][1]).toBe(x.get('B'));
    expect(paths[1][2]).toBeGreaterThan(paths[0][2]);
  });

  it('loops a message to self back to its own lifeline', () => {
    const scene = sceneOf('sequenceDiagram\n  A->>A: think\n  A->>B: tell');
    const x = lifelines(scene);
    const path = line(scene, message(scene, 'i0')).cmds;
    // Out, round a corner, down, round another and back.
    expect(ops(path)).toBe('014141');
    expect(path[1]).toBe(x.get('A'));
    const square = sceneOf('sequenceDiagram\n  A->>A: think', { config: { sequence: { rightAngles: true } } });
    expect(ops(line(square, message(square, 'i0')).cmds)).not.toContain('4');
  });

  it('starts the next row below a message to self whose label is taller than its loop', () => {
    const baselines = (scene: Scene, id: string): number[] => textsOf(scene, labelOf(scene, id)).map((t) => t.y);
    const step = (scene: Scene): number => {
      const self = baselines(scene, 'i0');
      return baselines(scene, 'i1')[0] - self[self.length - 1];
    };
    const broken = sceneOf('sequenceDiagram\n  A->>A: one<br/>two<br/>three\n  A->>B: next');
    const own = baselines(broken, 'i0');
    expect(own).toHaveLength(3);
    expect(step(broken)).toBeGreaterThanOrEqual(own[1] - own[0]);
    const long = 'a message to self long enough to wrap onto several lines';
    const wrapped = sceneOf(`sequenceDiagram\n  A->>A: ${long}\n  A->>B: next`, { maxWidth: 200 });
    expect(baselines(wrapped, 'i0').length).toBeGreaterThan(1);
    expect(step(wrapped)).toBeGreaterThanOrEqual(own[1] - own[0]);
  });

  it('widens gaps within maxWidth before wrapping a message', () => {
    const reported =
      'sequenceDiagram\n  participant U as UE\n  participant M as MeNB (LTE anchor)\n  participant S as SgNB (5G, NR leg)\n' +
      '  M->>S: SgNB Addition Request (DRB-ID, CG-ConfigInfo)\n  M->>U: RRCConnectionReconfiguration (carries the NR SCG config)\n  U->>M: RRCConnectionReconfigurationComplete';
    const long = 'thisIsAnExtremelyLongMessageIdentifierThatShouldHaveRoomToFit';
    const cases: [string, string, number, number, object?][] = [
      [reported, 'i2', 760, 1],
      [reported, 'i2', 760.5, 1],
      [reported, 'i2', 760, 1, { monospace: ['messages'] }],
      [reported, 'i2', 400, 2],
      [`sequenceDiagram\n  participant A\n  participant B\n  participant C\n  B->>A: ${'x'.repeat(168)}\n  C->>A: ${'x'.repeat(89)}`, 'i1', 709, 1],
      [`sequenceDiagram\n  A->>B: ${long}`, 'i0', 300.25, 3],
      [`sequenceDiagram\n  participant A\n  participant B\n  participant C\n  participant D\n  A->>D: ${long}`, 'i0', 450, 2],
      [`sequenceDiagram\n  A->>+B: ${long}\n  Note right of B: note\n  B-->>-A: ok`, 'i0', 400, 2],
    ];
    for (const [source, id, maxWidth, count, extra] of cases) {
      const result = draw(source, { ...extra, maxWidth });
      expect(result.width).toBeLessThanOrEqual(maxWidth);
      expect(labelLines(result.scene, id)).toHaveLength(count);
    }
  });

  it('measures messages in the monospace font when monospace lists them', () => {
    const src = 'sequenceDiagram\n  A->>B: a message in the monospace font\n  B->>B: a message to itself\n  Note over A,B: a note';
    const plain = sceneOf(src);
    const mono = sceneOf(src, { monospace: ['messages'] });
    const monoTexts = (scene: Scene): string[] => scene.texts.filter((t) => t.spans.some((sp) => sp.mono)).map(lineOf);
    expect(monoTexts(plain)).toEqual([]);
    // The labels of messages, not the notes or the names.
    expect(monoTexts(mono)).toEqual(['a message in the monospace font', 'a message to itself']);
    const gap = (scene: Scene): number => lifelines(scene).get('B')! - lifelines(scene).get('A')!;
    expect(gap(mono)).toBeGreaterThan(gap(plain));
    expect(draw(src, { monospace: ['messages'] }).width - gap(mono)).toBeGreaterThan(draw(src).width - gap(plain));
    for (const monospace of [[], ['message'], 'messages', ['members']]) expect(same(sceneOf(src, { monospace }), plain)).toBe(true);
  });

  it('widens gaps within maxWidth for messages measured in the monospace font', () => {
    const source =
      'sequenceDiagram\n  participant UE\n  participant gNB\n  participant AMF\n  gNB->>UE: RRCConnectionReconfigurationComplete\n  UE->>gNB: ok';
    const mono = draw(source, { maxWidth: 760, monospace: ['messages'] });
    expect(mono.width).toBeLessThanOrEqual(760);
    expect(mono.width).toBeGreaterThan(draw(source, { maxWidth: 760 }).width);
    expect(lines(mono.scene)).toContain('RRCConnectionReconfigurationComplete');
  });

  it('draws activations, nested ones offset, and ends arrows at their edges', () => {
    const scene = sceneOf('sequenceDiagram\n  A->>+B: one\n  A->>+B: two\n  B-->>-A: three\n  B-->>-A: four');
    const x = lifelines(scene);
    const activations = items(scene, 'pele-activation');
    expect(activations).toHaveLength(2);
    expect(activations.every((a) => a.id === 'B' && a.box!.x1 - a.box!.x0 === 10)).toBe(true);
    const [outer, inner] = [...activations].sort((p, q) => p.box!.x0 - q.box!.x0);
    expect(outer.box!.x0).toBe(x.get('B')! - 5);
    expect(inner.box!.x0).toBe(x.get('B')! - 1);
    expect(outer.box!.y1 - outer.box!.y0).toBeGreaterThan(inner.box!.y1 - inner.box!.y0);
    expect(scene.items.indexOf(outer)).toBeLessThan(scene.items.indexOf(inner));
    expect(line(scene, message(scene, 'i0')).cmds[4]).toBe(x.get('B')! - 5 - 7);
  });

  it('accepts explicit activate and deactivate, and keeps an unclosed activation to the end', () => {
    const closed = sceneOf('sequenceDiagram\n  A->>B: go\n  activate B\n  B-->>A: done\n  deactivate B');
    expect(items(closed, 'pele-activation')).toHaveLength(1);
    const open = sceneOf('sequenceDiagram\n  activate A\n  A->>B: go');
    expect(items(open, 'pele-activation')).toHaveLength(1);
  });

  it('rejects deactivating a participant that is not active', () => {
    expect(() => draw('sequenceDiagram\n  A->>B: go\n  deactivate B')).toThrow(/inactivate an inactive participant \(B\)/);
    expect(() => draw('sequenceDiagram\n  A->>-B: go')).toThrow(PeleError);
  });

  it('places notes left of, right of, and over participants', () => {
    const scene = sceneOf('sequenceDiagram\n  participant A\n  participant B\n  Note left of A: L\n  Note right of B: R\n  Note over A: O\n  Note over A,B: AB');
    const x = lifelines(scene);
    const notes = items(scene, 'pele-note').map((n) => ({ left: n.box!.x0, right: n.box!.x1, top: n.box!.y0 }));
    expect(notes).toHaveLength(4);
    expect(notes[0].right).toBeLessThan(x.get('A')!);
    expect(notes[1].left).toBeGreaterThan(x.get('B')!);
    expect((notes[2].left + notes[2].right) / 2).toBeCloseTo(x.get('A')!, 1);
    expect(notes[3].left).toBeLessThan(x.get('A')!);
    expect(notes[3].right).toBeGreaterThan(x.get('B')!);
    for (let i = 1; i < notes.length; i++) expect(notes[i].top).toBeGreaterThan(notes[i - 1].top);
    const m = model('sequenceDiagram\n  Note over A,B: AB\n  Note left of A: L');
    expect(m.notes.map((n) => n.placement)).toEqual([PLACEMENT.OVER, PLACEMENT.LEFTOF]);
    expect(m.notes[0].actor).toEqual(['A', 'B']);
  });

  it('frames loop, alt, opt, par, critical, and break blocks with their titles and sections', () => {
    const scene = sceneOf(
      'sequenceDiagram\n  loop Every minute\n  A->>B: a\n  end\n  alt ok\n  A->>B: b\n  else bad\n  A->>B: c\n  else\n  A->>B: d\n  end\n' +
        '  opt maybe\n  A->>B: e\n  end\n  par one\n  A->>B: f\n  and two\n  A->>B: g\n  end\n  par_over three\n  A->>B: h\n  end\n' +
        '  critical must\n  A->>B: i\n  option fail\n  A->>B: j\n  end\n  break stop\n  A->>B: k\n  end'
    );
    for (const kind of ['loop', 'alt', 'opt', 'par', 'critical', 'break']) {
      expect(items(scene, `pele-frame-${kind}`).length, kind).toBeGreaterThan(0);
      expect(lines(scene), kind).toContain(kind);
    }
    expect(items(scene, 'pele-frame-par')).toHaveLength(2);
    for (const title of ['[Every minute]', '[ok]', '[bad]', '[maybe]', '[one]', '[two]', '[three]', '[must]', '[fail]', '[stop]']) {
      expect(lines(scene), title).toContain(title);
    }
    const alt = items(scene, 'pele-frame-alt')[0];
    expect(shapesOf(scene, alt).filter((sh) => sh.dash)).toHaveLength(2);
  });

  it('nests blocks inside one another', () => {
    const scene = sceneOf('sequenceDiagram\n  loop outer\n  alt inner\n  A->>B: x\n  end\n  end');
    const outer = items(scene, 'pele-frame-loop')[0].box!;
    const inner = items(scene, 'pele-frame-alt')[0].box!;
    expect(inner.x0).toBeGreaterThan(outer.x0);
    expect(inner.y0).toBeGreaterThan(outer.y0);
    expect(inner.x1).toBeLessThan(outer.x1);
    expect(inner.y1).toBeLessThan(outer.y1);
  });

  it('shades rect blocks with the given color, the inner one on top', () => {
    const scene = sceneOf('sequenceDiagram\n  rect rgb(191, 223, 255)\n  A->>B: x\n  rect rgba(0, 0, 255, .1)\n  B->>A: y\n  end\n  end\n  rect\n  A->>B: z\n  end');
    const rects = items(scene, 'pele-rect');
    const fills = rects.map((r) => shapesOf(scene, r)[0].paint);
    expect(fills).toHaveLength(3);
    expect(fills).toContain('rgb(191, 223, 255)');
    expect(fills).toContain('rgba(0, 0, 255, .1)');
    expect(fills.filter((f) => f === 'var(--_a)')).toHaveLength(1);
    const at = (paint: string): number => scene.items.indexOf(rects[fills.indexOf(paint)]);
    expect(at('rgb(191, 223, 255)')).toBeLessThan(at('rgba(0, 0, 255, .1)'));
    expect(at('rgba(0, 0, 255, .1)')).toBeLessThan(scene.items.indexOf(items(scene, 'pele-lifeline')[0]));
  });

  it('picks a contrasting text color for labels on a rect or box fill', () => {
    const scene = sceneOf(
      'sequenceDiagram\n  box rgb(34, 56, 0) Group\n  participant A\n  participant B\n  end\n  participant C\n  participant D\n' +
        '  A->>B: boxed\n  C->>D: open\n  rect rgb(191, 223, 255)\n  C->>D: light\n  C->>C: self\n  loop Often\n  D->>C: looped\n  end\n  rect black\n  C->>D: dark\n  end\n  rect rgba(0, 0, 0, .2)\n  C->>D: faint\n  end\n  A->>D: crossing two of the lifelines\n  end'
    );
    const ink = (text: string): string => scene.texts.find((t) => lineOf(t) === text)!.paint;
    const light = 'var(--pele-fg-on-light,#1f1f1f)';
    const dark = 'var(--pele-fg-on-dark,#fff)';
    expect(ink('boxed')).toBe(dark);
    expect(ink('Group')).toBe(dark);
    expect(ink('open')).toBe('var(--_fg)');
    expect(ink('light')).toBe(light);
    expect(ink('self')).toBe(light);
    expect(ink('[Often]')).toBe(light);
    expect(ink('looped')).toBe(light);
    expect(ink('dark')).toBe(dark);
    expect(ink('faint')).toBe('var(--_fg)');
    // A label across a lifeline sits on a plate in the page color.
    const crossing = scene.items[scene.texts.find((t) => lineOf(t) === 'crossing two of the lifelines')!.item];
    expect(shapesOf(scene, crossing).some((sh) => sh.kind === 'fill' && sh.paint === 'var(--_bg)')).toBe(true);
  });

  it('draws arrows on a rect or box fill in their label color', () => {
    const scene = sceneOf(
      'sequenceDiagram\n  box black Group\n  participant A\n  participant B\n  end\n  participant C\n  A->>B: boxed\n  B->>C: open\n  rect rgb(191, 223, 255)\n  A-->>C: light\n  C-xC: self\n  A-|\\B: solid\n  A-\\\\B: stick\n  end'
    );
    const light = 'var(--pele-fg-on-light,#1f1f1f)';
    const dark = 'var(--pele-fg-on-dark,#fff)';
    const inks = (text: string): string[] => [...new Set(shapesOf(scene, messageSaying(scene, text)).map((sh) => sh.paint))];
    expect(inks('boxed')).toEqual([dark]);
    expect(inks('open')).toEqual(['var(--_l)']);
    expect(inks('light')).toEqual([light]);
    expect(line(scene, messageSaying(scene, 'light')).dash).toBeTruthy();
    expect(inks('self')).toEqual([light]);
    expect(heads(scene, messageSaying(scene, 'solid')).map((h) => [h.kind, h.paint])).toEqual([['fill', light]]);
    expect(inks('stick')).toEqual([light]);
    for (const lifeline of items(scene, 'pele-lifeline')) expect(shapesOf(scene, lifeline).map((sh) => sh.paint)).toEqual(['var(--_b)']);
  });

  it('keeps the theme color for a self-message that reaches past its box', () => {
    const scene = sceneOf('sequenceDiagram\n  autonumber 1000\n  box black\n  participant A\n  end\n  A->>A: x');
    expect(shapesOf(scene, messages(scene)[0]).map((sh) => sh.paint)).not.toContainEqual(expect.stringContaining('--pele-fg-on'));
  });

  it('picks a contrasting name color for figures in a box', () => {
    const scene = sceneOf('sequenceDiagram\n  box black Group\n  actor A\n  participant B\n  end\n  actor C\n  A->>B: hi\n  B->>C: yo');
    const names = (id: string): string[] => items(scene, 'pele-actor').filter((a) => a.id === id).flatMap((a) => textsOf(scene, a).map((t) => t.paint));
    // The figure sits on the box; a participant has a box of its own.
    expect(names('A')).toEqual(['var(--pele-fg-on-dark,#fff)', 'var(--pele-fg-on-dark,#fff)']);
    expect(names('B')).toEqual(['var(--_fg)', 'var(--_fg)']);
    expect(names('C')).toEqual(['var(--_fg)', 'var(--_fg)']);
  });

  it('groups participants in boxes, with color and title', () => {
    const src = 'sequenceDiagram\n  box Aqua Group One\n  participant A\n  participant B\n  end\n  box Group Two\n  participant C\n  end\n  box rgb(1, 2, 3)\n  participant D\n  end\n  A->>D: x';
    const m = model(src);
    expect(m.boxes.map((b) => [b.name, b.fill, b.actorKeys])).toEqual([
      ['Group One', 'Aqua', ['A', 'B']],
      ['Group Two', 'transparent', ['C']],
      [undefined, 'rgb(1, 2, 3)', ['D']],
    ]);
    const scene = sceneOf(src);
    // A box with no title has no id, so it is a fill and not an item.
    expect(items(scene, 'pele-box').map((b) => b.id)).toEqual(['Group One', 'Group Two']);
    expect(scene.shapes.some((sh) => sh.paint === 'rgb(1, 2, 3)')).toBe(true);
    expect(shapesOf(scene, items(scene, 'pele-box')[0])[0].paint).toBe('Aqua');
    expect(lines(scene)).toContain('Group One');
    expect(lines(scene)).toContain('Group Two');
    const x = lifelines(scene);
    const plain = lifelines(sceneOf('sequenceDiagram\n  participant A\n  participant B\n  participant C\n  participant D\n  A->>D: x'));
    expect(x.get('C')! - x.get('B')!).toBeGreaterThan(plain.get('C')! - plain.get('B')!);
    expect(x.get('B')! - x.get('A')!).toBe(plain.get('B')! - plain.get('A')!);
  });

  it('reads box colors as Mermaid does, treating an unknown first word as part of the title', () => {
    const fill = (line: string): [string | undefined, string] => {
      const b = model(`sequenceDiagram\n  box ${line}\n  participant A\n  end`).boxes[0];
      return [b.name, b.fill];
    };
    expect(fill('green Team')).toEqual(['Team', 'green']);
    expect(fill('Team green')).toEqual(['Team green', 'transparent']);
    expect(fill('rgb(34, 56, 0) Group1')).toEqual(['Group1', 'rgb(34, 56, 0)']);
    expect(fill('hsl(120deg 50% 50% / 0.5) H')).toEqual(['H', 'hsl(120deg 50% 50% / 0.5)']);
    expect(fill('rgb(1, 2) Bad')).toEqual(['rgb(1, 2) Bad', 'transparent']);
    expect(fill('transparent Aqua')).toEqual(['Aqua', 'transparent']);
    expect(fill('GrayText Disabled')).toEqual(['Disabled', 'GrayText']);
    expect(fill('wrap: Wrapped title')).toEqual(['Wrapped title', 'transparent']);
  });

  it('refuses a participant declared in two boxes', () => {
    expect(() => draw('sequenceDiagram\n  box One\n  participant A\n  end\n  box Two\n  participant A\n  end')).toThrow(
      /should only be defined in one Box/
    );
  });

  it('numbers messages with autonumber, its start and step, and the config switch', () => {
    // A number sits in a badge at the start of the message's line.
    const numbers = (scene: Scene): string[] => messages(scene).flatMap((m) => textsOf(scene, m).map(lineOf));
    const src = 'sequenceDiagram\n  A->>B: one\n  B-->>A: two\n  A->>A: three';
    expect(numbers(sceneOf(src))).toEqual([]);
    expect(numbers(sceneOf(src.replace('\n', '\n  autonumber\n')))).toEqual(['1', '2', '3']);
    expect(numbers(sceneOf(src.replace('\n', '\n  autonumber 10 5\n')))).toEqual(['10', '15', '20']);
    expect(numbers(sceneOf(src.replace('\n', '\n  autonumber 10.01 .01\n')))).toEqual(['10.01', '10.02', '10.03']);
    expect(numbers(sceneOf(src, { config: { sequence: { showSequenceNumbers: true } } }))).toEqual(['1', '2', '3']);
    expect(numbers(sceneOf('sequenceDiagram\n  autonumber\n  A->>B: one\n  autonumber off\n  B-->>A: two\n  autonumber\n  A->>B: three'))).toEqual(['1', '3']);
    expect(() => draw('sequenceDiagram\n  autonumber 10.001\n  A->>B: one')).toThrow(PeleError);
  });

  it('draws each participant kind, with figures above their labels', () => {
    const kinds = ['actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'];
    let src = 'sequenceDiagram\n  participant P\n  actor A\n';
    for (const kind of kinds.slice(1)) src += `  participant ${kind}@{ "type": "${kind}" }\n`;
    const m = model(src);
    expect([...m.actors.values()].map((a) => a.type)).toEqual(['participant', ...kinds]);
    const scene = sceneOf(src, { config: { sequence: { mirrorActors: false } } });
    for (const kind of ['participant', ...kinds]) expect(items(scene, `pele-actor-${kind}`), kind).toHaveLength(1);
    expect(items(sceneOf('sequenceDiagram\n  participant X@{ "type": "nonsense" }'), 'pele-actor-participant')).toHaveLength(2);
  });

  it('takes aliases from `as` and from the config object, `as` first', () => {
    const m = model(
      'sequenceDiagram\n  participant A as Alice\n  participant B@{ "alias": "Bob" }\n  participant C@{ "alias": "Inner" } as Outer\n  actor D\n  participant E@{ type: database, alias: "Store" }'
    );
    expect([...m.actors.values()].map((a) => a.description)).toEqual(['Alice', 'Bob', 'Outer', 'D', 'Store']);
    expect(m.actors.get('E')?.type).toBe('database');
  });

  it('rejects a config object that is not valid YAML', () => {
    expect(() => draw('sequenceDiagram\n  participant C@{ "type" "control" }\n  C->>C: x')).toThrow(PeleError);
    expect(() => draw('sequenceDiagram\n  participant C@{ "type: "control" }')).toThrow(PeleError);
  });

  it('creates a participant at its first message and ends a destroyed one with a cross', () => {
    const src = 'sequenceDiagram\n  A->>B: hi\n  create participant C\n  A->>C: make\n  destroy C\n  A-xC: end\n  B->>A: bye';
    const m = model(src);
    expect(m.createdActors.get('C')).toBe(1);
    expect(m.destroyedActors.get('C')).toBe(2);
    const scene = sceneOf(src);
    const actor = (id: string): SceneItem | undefined => items(scene, 'pele-actor').find((a) => a.id === id && !hasClass(a, 'pele-actor-footer'));
    const top = (id: string): number => actor(id)!.box!.y0;
    expect(top('C')).toBeGreaterThan(top('A') + 40);
    expect(items(scene, 'pele-destroy').map((d) => d.id)).toEqual(['C']);
    expect(items(scene, 'pele-actor-footer').filter((a) => a.id === 'C')).toHaveLength(0);
    expect(items(scene, 'pele-actor-footer').filter((a) => a.id === 'A')).toHaveLength(1);
    const life = itemById(scene, 'C', 'pele-lifeline')!.box!;
    const lifeA = itemById(scene, 'A', 'pele-lifeline')!.box!;
    expect(life.y0).toBeGreaterThan(top('C'));
    expect(life.y1).toBeLessThan(lifeA.y1);
  });

  it('enforces the rules of create and destroy', () => {
    expect(() => draw('sequenceDiagram\n  A->>B: hi\n  create participant A\n  B->>A: x')).toThrow(/same id/);
    expect(() => draw('sequenceDiagram\n  create participant C\n  A->>B: x')).toThrow(/created participant C/);
    expect(() => draw('sequenceDiagram\n  A->>B: hi\n  destroy B\n  A->>C: x')).toThrow(/destroyed participant B/);
  });

  it('marks central connections with a circle on the lifeline', () => {
    const scene = sceneOf('sequenceDiagram\n  A->>()B: to\n  A()->>B: from\n  A()->>()B: both');
    const circles = messages(scene)
      .map((m) => [m.id, shapesOf(scene, m).filter(isCircle).length])
      .filter(([, n]) => n !== 0);
    expect(circles).toEqual([
      ['i0', 1],
      ['i2', 1],
      ['i4', 2],
    ]);
    const m = model('sequenceDiagram\n  A->>()B: to\n  A()->>B: from\n  A()->>()B: both');
    expect(m.messages.filter((x) => x.message !== '').map((x) => x.centralConnection)).toEqual([
      LINETYPE.CENTRAL_CONNECTION,
      LINETYPE.CENTRAL_CONNECTION_REVERSE,
      LINETYPE.CENTRAL_CONNECTION_DUAL,
    ]);
  });

  it('breaks lines at <br> and wraps only when asked', () => {
    const lineCount = (scene: Scene, id: number): number => Math.max(1, labelLines(scene, `i${id}`).length);
    const long = 'a message long enough that it would be wrapped if wrapping were switched on for it';
    const scene = sceneOf(`sequenceDiagram\n  A->>B: one<br/>two<br>three\n  A->>B: ${long}\n  A->>B: nowrap: ${long}`);
    expect(lineCount(scene, 0)).toBe(3);
    expect(lineCount(scene, 1)).toBe(1);
    expect(lineCount(scene, 2)).toBe(1);
    expect(lineCount(sceneOf(`sequenceDiagram\n  A->>B: wrap: ${long}`), 0)).toBeGreaterThan(2);
    // A wrapped message uses the room that other messages have made between its participants.
    expect(lineCount(sceneOf(`sequenceDiagram\n  A->>B: ${long}\n  A->>B: wrap: ${long}`), 1)).toBe(1);
    const all = sceneOf(`sequenceDiagram\n  A->>B: ${long}`, { config: { sequence: { wrap: true } } });
    expect(lineCount(all, 0)).toBeGreaterThan(1);
    expect(lineCount(sceneOf(`sequenceDiagram\n  A->>B: nowrap: ${long}`, { config: { sequence: { wrap: true } } }), 0)).toBe(1);
    const directive = sceneOf(`%%{wrap}%%\nsequenceDiagram\n  A->>B: ${long}`);
    expect(lineCount(directive, 0)).toBeGreaterThan(1);
  });

  it('records the wrap of every message, from prefixes, the directive, and the config', () => {
    const wraps = (src: string): boolean[] => model(src).messages.map((m) => m.wrap);
    expect(wraps('sequenceDiagram\n  A->>B: x\n  A->>B: wrap: x\n  A->>B: nowrap: x\n  Note left of A: wrap: n')).toEqual([false, true, false, true]);
    expect(wraps('%%{wrap}%%\nsequenceDiagram\n  A->>B: x\n  Note left of A: n\n  A->>B: nowrap: x')).toEqual([true, true, false]);
    expect(wraps('%%{init: {"sequence": {"wrap": true}}}%%\nsequenceDiagram\n  A->>B: x')).toEqual([true]);
    expect(model('sequenceDiagram\n  participant A as wrap: Alice\n  A->>B: wrap: text').actors.get('A')).toMatchObject({ description: 'Alice', wrap: true });
  });

  it('decodes entity codes and keeps text as text', () => {
    const scene = sceneOf('sequenceDiagram\n  A->>B: I #9829; you #lt;3 & <more>\n  Note over A: a "quoted" note');
    expect(lines(scene)).toContain('I ♥ you <3 & <more>');
    expect(lines(scene)).toContain('a "quoted" note');
  });

  it('stores participant links, properties, and details without drawing anything interactive', () => {
    const src =
      'sequenceDiagram\n  participant A\n  participant B\n  links A: {"Repo": "https://example.com/repo", "Docs": "https://example.com/docs"}\n' +
      '  link A: Tests @ https://example.com/?a=1&b=2@x\n  properties B: {"class": "external svc", "icon": "@clock"}\n  details B: some-element\n  A->>B: hi';
    const m = model(src);
    expect([...m.actors.get('A')!.links]).toEqual([
      ['Repo', 'https://example.com/repo'],
      ['Docs', 'https://example.com/docs'],
      ['Tests', 'https://example.com/?a=1&b=2@x'],
    ]);
    expect([...m.actors.get('B')!.properties]).toEqual([
      ['class', 'external svc'],
      ['icon', '@clock'],
    ]);
    expect(m.actors.get('B')!.details).toBe('some-element');
    const result = draw(src);
    expect(result.links).toEqual([]);
    expect(JSON.stringify(result.scene)).not.toContain('example.com');
    expect(items(result.scene, 'pele-actor').filter((a) => a.id === 'B').every((a) => a.kind.endsWith('external svc'))).toBe(true);
  });

  it('ignores menu statements whose text is not valid JSON', () => {
    const m = model('sequenceDiagram\n  participant A\n  links A: not json\n  properties A: {"a": }');
    expect(m.actors.get('A')!.links.size).toBe(0);
    expect(m.actors.get('A')!.properties.size).toBe(0);
  });

  it('titles the diagram from a statement or from front matter', () => {
    expect(model('sequenceDiagram\n  title My title\n  A->>B: x').title).toBe('My title');
    expect(model('sequenceDiagram\n  title: Legacy title\n  A->>B: x').title).toBe('Legacy title');
    expect(model('---\ntitle: From front matter\n---\nsequenceDiagram\n  A->>B: x').title).toBe('From front matter');
    const scene = sceneOf('sequenceDiagram\n  title My title\n  A->>B: x');
    const title = scene.texts.find((t) => lineOf(t) === 'My title')!;
    expect(title.item).toBe(-1);
    expect(title.weight).toBeGreaterThan(400);
    expect(draw('sequenceDiagram\n  title My title\n  A->>B: x').height).toBeGreaterThan(draw('sequenceDiagram\n  A->>B: x').height);
  });

  it('treats a bare title as no title', () => {
    for (const src of ['sequenceDiagram\ntitle\nA->>B: Hi\nB->>A: Bye', 'sequenceDiagram\ntitle: \nA->>B: Hi\nB->>A: Bye']) {
      const m = model(src);
      expect(m.title, src).toBeUndefined();
      expect(m.messages.map((x) => x.message), src).toEqual(['Hi', 'Bye']);
    }
    expect(model('sequenceDiagram\n  title My title\n  A->>B: x').title).toBe('My title');
  });

  it('reads a multi-line accessible description', () => {
    const multi = model('sequenceDiagram\n  accDescr {\n    Two\n    lines\n  }\n  A->>B: x');
    expect(multi.accDescr).toBe('Two\nlines');
  });

  it('hides participants no message mentions when asked', () => {
    const src = 'sequenceDiagram\n  participant A\n  participant Unused\n  participant B\n  A->>B: x';
    expect([...lifelines(sceneOf(src)).keys()]).toEqual(['A', 'Unused', 'B']);
    expect([...lifelines(sceneOf(src, { config: { sequence: { hideUnusedParticipants: true } } })).keys()]).toEqual(['A', 'B']);
  });

  it('spaces messages by messageMargin', () => {
    const src = 'sequenceDiagram\n  A->>B: one\n  A->>B: two\n  A->>B: three';
    const base = draw(src).height;
    const loose = draw(src, { config: { sequence: { messageMargin: 75 } } }).height;
    expect(loose).toBe(base + 3 * 40);
  });

  it('aligns message text as messageAlign says', () => {
    const src = 'sequenceDiagram\n  A->>B: a message that sets the width\n  A->>B: hi';
    const textX = (scene: Scene): number => textsOf(scene, labelOf(scene, 'i1'))[0].x;
    const center = textX(sceneOf(src));
    expect(textX(sceneOf(src, { config: { sequence: { messageAlign: 'left' } } }))).toBeLessThan(center - 50);
    expect(textX(sceneOf(src, { config: { sequence: { messageAlign: 'right' } } }))).toBeGreaterThan(center + 50);
  });

  it('keeps every drawn coordinate inside the reported size', () => {
    for (const src of corpus) {
      const result = tryDraw(src);
      if (result === undefined) continue;
      const where = JSON.stringify(src).slice(0, 80);
      const { scene } = result;
      for (const shape of scene.shapes) {
        if (shape.kind !== 'fill') continue;
        expect(shape.box.x0, where).toBeGreaterThanOrEqual(scene.x - 0.01);
        expect(shape.box.y0, where).toBeGreaterThanOrEqual(scene.y - 0.01);
        expect(shape.box.x1, where).toBeLessThanOrEqual(scene.x + scene.w + 0.01);
        expect(shape.box.y1, where).toBeLessThanOrEqual(scene.y + scene.h + 0.01);
      }
    }
  });

  it('treats keywords without regard to case and keeps names as written', () => {
    const m = model('sequenceDiagram\n  PARTICIPANT Alice AS A\n  Alice->>BOB: hi\n  NOTE OVER Alice: n\n  LOOP x\n  Alice->>Alice: y\n  END');
    expect([...m.actors.keys()]).toEqual(['Alice', 'BOB']);
    expect(m.actors.get('Alice')?.description).toBe('A');
    expect(m.messages.map((x) => x.type)).toEqual([LINETYPE.SOLID, LINETYPE.NOTE, LINETYPE.LOOP_START, LINETYPE.SOLID, LINETYPE.LOOP_END]);
  });

  it('keeps the character before a comment', () => {
    expect(model('sequenceDiagram\n  A->>B:%% comment').messages.map((m) => m.message)).toEqual(['%% comment']);
    expect(() => model('sequenceDiagram\n  autonumber 5%% comment')).toThrow(PeleError);
  });

  it('throws structured errors', () => {
    const error = (() => {
      try {
        draw('sequenceDiagram\n  Alice->>Bob\n');
      } catch (e) {
        return e as PeleError;
      }
    })();
    expect(error).toBeInstanceOf(PeleError);
    expect(error?.code).toBe('syntax');
    expect(error?.line).toBe(2);
    expect(error?.message).toMatch(/Expecting 'TXT', got 'NEWLINE'/);
    expect(() => draw('sequenceDiagram\n  participant\n')).toThrow(/Lexical error on line 2/);
    expect(() => draw('sequenceDiagram\n  loop x\n  A->>B: y')).toThrow(PeleError);
  });
});
