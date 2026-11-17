import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, renderScene, type DiagramModel, type RenderOptions } from '../../src/index.js';
import type { Scene } from '../../src/draw/scene.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { literalLabel, breakLabel } from '../../src/diagrams/common/literal-label.js';
import { layoutLabel } from '../../src/text/label.js';
import { assertSafe, itemById, items, lineOf, shapesOf, textsOf } from '../support/scene.js';

const options = { measurer: metricsMeasurer, now: 0 };
const phone = { ...options, maxWidth: 320 };
const render = (source: string | DiagramModel, extra: RenderOptions = options) => renderScene(source, extra);
const sources = (name: string): string[] => JSON.parse(readFileSync(`tests/corpus/${name}-docs.json`, 'utf8'));
const squash = (text: string): string => text.replace(/\s/g, '');
// Each line of text without its spaces, in drawing order.
const texts = (scene: Scene): string[] => scene.texts.map((t) => squash(lineOf(t)));
// All the text run together, for what a narrow drawing may wrap onto several lines.
const flat = (scene: Scene): string => texts(scene).join('');
const same = (a: Scene, b: Scene): boolean => JSON.stringify(a) === JSON.stringify(b);
const sizes = (scene: Scene): number[] => [...new Set(scene.texts.map((t) => t.size))];
// The boxes of cards, pills and the like: a rounded or plain rectangle drawn as a fill.
const boxes = (scene: Scene): { x: number; y: number; w: number; h: number }[] =>
  scene.shapes.filter((s) => s.kind === 'fill' && s.cmds.length === 48).map((s) => ({ x: s.box.x0, y: s.box.y0, w: s.box.x1 - s.box.x0, h: s.box.y1 - s.box.y0 }));
// Where an edge's line turns: after leaving its node it runs to the rail, whose x is the second corner.
const railOf = (scene: Scene, id: string): number => shapesOf(scene, itemById(scene, id, 'pele-edge')!).find((s) => s.kind === 'stroke')!.cmds[4];

const TREE = 'treeView-beta\n  project/\n    very_long_filename_that_must_wrap_without_losing_any_characters.ts :::highlight ## A description that should move below its filename on a phone\n    source/\n      app.ts\n';

describe('mobile diagram layouts', () => {
  it('compacts every newly supported type while retaining its model and desktop drawing', () => {
    for (const name of ['sequence', 'railroad', 'journey', 'packet', 'c4', 'architecture', 'eventmodeling', 'swimlane', 'block', 'ishikawa']) {
      const source = sources(name).sort((a, b) => render(b).width - render(a).width)[0];
      const model = parse(source), before = JSON.stringify(model);
      const wide = render(model);
      const narrow = render(model, phone);
      expect(narrow.width, name).toBeLessThan(wide.width);
      expect(JSON.stringify(model), name).toBe(before);
      expect(same(render(model, { ...options, maxWidth: wide.width }).scene, wide.scene), name).toBe(true);
      expect(same(render(model).scene, wide.scene), name).toBe(true);
      assertSafe(narrow, name);
    }
  });

  it('keeps participants, messages, notes and numbering readable in a four-party sequence', () => {
    const source = sources('sequence')[1];
    const wide = render(source), narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(narrow.height).toBeGreaterThan(wide.height);
    const labels = flat(narrow.scene);
    for (const label of texts(wide.scene)) expect(labels).toContain(label);
    expect(items(narrow.scene, 'pele-activation').length).toBe(items(wide.scene, 'pele-activation').length);
  });

  it('wraps nested railroad sequences without losing grammar elements or overlapping boxes', () => {
    const source = sources('railroad')[8];
    const wide = render(source), narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(texts(narrow.scene)).toEqual(texts(wide.scene));
    const placed = boxes(narrow.scene);
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= narrow.width && a.y + a.h <= narrow.height).toBe(true);
      for (const b of placed.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    // The start and end markers are circles.
    const markers = (scene: Scene): number => scene.shapes.filter((s) => s.kind === 'fill' && s.cmds.length === 20).length;
    expect(markers(narrow.scene)).toBe(markers(wide.scene));
  });

  it('preserves every bit and field when packet rows split, including descending numbering', () => {
    for (const bitOrder of ['ascending', 'descending']) {
      const source = `---\nconfig:\n  packet:\n    bitOrder: ${bitOrder}\n---\npacket\n0-31: "Header"\n32-39: "Flags"\n40-127: "Payload"`;
      const narrow = render(source, phone);
      const ranges = items(narrow.scene, 'pele-node').map((item) => item.id.split('-').map(Number));
      let next = 0;
      for (const [from, to] of ranges) { expect(from).toBe(next); next = to + 1; }
      expect(next).toBe(128);
      expect(narrow.width).toBeLessThanOrEqual(320);
      for (const name of ['Header', 'Flags', 'Payload']) expect(texts(narrow.scene)).toContain(name);
      expect(flat(narrow.scene)).not.toContain('…');
      expect(same(render(source, { ...phone, autoDirection: false }).scene, render(source).scene)).toBe(true);
    }
  });

  it('uses taller rows only where packet labels need them', () => {
    const narrow = render(sources('packet')[0], phone);
    expect(new Set(boxes(narrow.scene).map((box) => box.h)).size).toBeGreaterThan(1);
    // A one-bit field is too narrow for its label, which is stacked a letter to a line.
    for (const label of ['URG', 'ACK', 'PSH', 'RST', 'SYN', 'FIN']) expect(flat(narrow.scene)).toContain(label);
    expect(narrow.height).toBeLessThan(1200);
  });

  it('keeps journey order, section headings, scores and actors in the vertical drawing', () => {
    const source = 'journey\n  title Delivery\n  section Prepare\n    Read requirements: 3: Alice, Bob\n    Make a plan: 4: Alice\n  section Finish\n    Review the result: 5: Bob';
    const narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const labels = texts(narrow.scene);
    for (const value of ['Delivery', 'Prepare', 'Finish', 'Readrequirements', 'Makeaplan', 'Reviewtheresult', 'Alice', 'Bob', '3', '4', '5']) expect(labels).toContain(value);
    const steps = items(narrow.scene, 'pele-journey-step').map((item) => Number(item.id));
    expect(steps).toEqual([0, 1, 2]);
  });

  it('keeps event frames, lanes, data, reset markers, explicit relations and specifications', () => {
    for (const source of sources('eventmodeling')) {
      const model = parse(source);
      if (model.type !== 'eventmodeling') throw new Error('fixture type');
      const narrow = render(model, phone);
      expect(narrow.width).toBeLessThanOrEqual(320);
      const labels = flat(narrow.scene);
      for (const box of model.boxes) {
        expect(itemById(narrow.scene, box.id), box.id).toBeDefined();
        expect(labels).toContain(squash(box.lane.label));
      }
      const wide = render(model);
      expect(items(narrow.scene, 'pele-edge').length).toBe(items(wide.scene, 'pele-edge').length);
      expect(items(narrow.scene, 'pele-em-reset').length).toBe(items(wide.scene, 'pele-em-reset').length);
      expect(items(narrow.scene, 'pele-em-specification').length).toBe(model.specifications.length);
      expect(items(narrow.scene, 'pele-em-note').length).toBe(model.notes.length);
    }
  });

  it('wraps filenames and moves descriptions underneath without changing the hierarchy', () => {
    const wide = render(TREE), narrow = render(TREE, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(flat(narrow.scene)).toBe(flat(wide.scene));
    expect(items(narrow.scene, 'pele-node').length).toBe(items(wide.scene, 'pele-node').length);
    expect(narrow.scene.shapes.length).toBe(wide.scene.shapes.length);
    const file = textsOf(narrow.scene, itemById(narrow.scene, 'very_long_filename_that_must_wrap_without_losing_any_characters.ts')!);
    const filenameY = file.find((t) => lineOf(t).startsWith('very_long'))!.y;
    const descriptionY = file.find((t) => lineOf(t).startsWith('A description'))!.y;
    expect(descriptionY).toBeGreaterThan(filenameY);
    assertSafe(narrow, 'tree');
  });

  it('retains every category and nested cause in the narrow Ishikawa tree', () => {
    const source = sources('ishikawa')[0];
    const model = parse(source);
    if (model.type !== 'ishikawa') throw new Error('fixture type');
    const narrow = render(model, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const labels = flat(narrow.scene);
    const pending = model.root ? [model.root] : [];
    let count = 0;
    for (let i = 0; i < pending.length; i++) { count++; expect(labels).toContain(squash(pending[i].text)); pending.push(...pending[i].children); }
    // The lines to the causes belong to no item.
    expect(narrow.scene.shapes.filter((s) => s.kind === 'stroke' && s.item === -1).length).toBe(count - 1);
    expect(same(render(source, { ...phone, autoDirection: false }).scene, render(source).scene)).toBe(true);
  });

  it('fits quadrant and Wardley examples to phone widths without shrinking the text', () => {
    for (const name of ['quadrant', 'wardley']) {
      for (const source of sources(name)) {
        const narrow = render(source, phone);
        expect(narrow.width, name).toBeLessThanOrEqual(322);
        for (const size of sizes(narrow.scene)) expect(sizes(render(source).scene), name).toContain(size);
      }
    }
  });

  it('keeps a packet row at a byte or more, however little room there is', () => {
    const source = 'packet-beta\n0-15: "Source Port"\n16-31: "Destination Port"\n32-4095: "Payload (variable length)"\n';
    // mount() draws at one pixel to learn whether a diagram adapts.
    const least = render(source, { ...options, maxWidth: 1 });
    expect(items(least.scene, 'pele-node').length).toBe(4096 / 8);
    expect(least.width).toBeLessThan(render(source).width);
  });

  it('gives the parts of a folded railroad sequence the room its rows have', () => {
    const source = 'railroad-ebnf-beta\nexpr = "start" ( "one" "two" "three" "four" "five" "six" "seven" | "eight" "nine" "ten" "eleven" "twelve" "thirteen" ) "finish" "really" "done" "now" ;\n';
    const wide = render(source), narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(texts(narrow.scene)).toEqual(texts(wide.scene));
  });

  it('reads entities and line breaks in the vertical Ishikawa and journey as in the wide ones', () => {
    const causes = 'ishikawa-beta\n  Late &amp; over #35;budget<br/>delivery\n  People\n    Too few<br/>reviewers &lt;3\n';
    const wide = render(causes), narrow = render(causes, { ...options, maxWidth: 200 });
    expect(same(narrow.scene, wide.scene)).toBe(false);
    expect(texts(narrow.scene).sort()).toEqual(texts(wide.scene).sort());
    for (const part of ['head', 'category']) {
      const first = (scene: Scene): string | undefined => items(scene, `pele-ishikawa-${part}`)[0]?.id;
      expect(first(narrow.scene), part).toBeDefined();
      expect(first(narrow.scene), part).toBe(first(wide.scene));
    }
    const day = 'journey\n  section Work\n    Make tea: 5: Me #35;1, Cat<br/>two\n    Go upstairs: 3: Me #35;1\n    Go downstairs: 3: Me #35;1\n    Sleep now: 3: Me #35;1\n';
    const steps = texts(render(day, { ...options, maxWidth: 200 }).scene);
    expect(steps).toContain('Me#1');
    expect(flat(render(day, { ...options, maxWidth: 200 }).scene)).toContain('Cattwo');
  });

  it('draws vertical event relations whole and on rails of their own', () => {
    const source = 'eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded ->> 01\ntf 04 rmo CartView ->> 02\ntf 05 evt CartCleared ->> 03 ->> 02\n';
    const narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const rails = new Map<string, number>();
    for (const edge of items(narrow.scene, 'pele-edge')) {
      const line = shapesOf(narrow.scene, edge).find((s) => s.kind === 'stroke')!;
      // A relation on a rail leaves its card sideways, runs to the rail, and turns along it.
      if (line.cmds[2] === line.cmds[5] && line.cmds[4] !== line.cmds[1]) rails.set(edge.id, line.cmds[4]);
    }
    expect(rails.size).toBe(4);
    expect(rails.get('02-05')).toBe(rails.get('03-05'));
    expect(new Set(rails.values()).size).toBe(3);
  });

  it('wraps a long lane heading to leave the arrow from the card above room beside it', () => {
    const source = 'eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd CustomerAccountManagement.AddItem\ntf 03 evt ItemAdded\n';
    const narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const arrow = shapesOf(narrow.scene, itemById(narrow.scene, '01-02', 'pele-edge')!)[0].cmds[1];
    const heading = itemById(narrow.scene, 'C/RM: CustomerAccountManagement', 'pele-em-lane')!;
    const lines = textsOf(narrow.scene, heading).map(lineOf);
    expect(lines).toEqual(['C/RM:', 'CustomerAccountManagement']);
    expect(shapesOf(narrow.scene, heading)).toEqual([]);
    const left = 8 + 12;
    for (const line of lines) expect(arrow).toBeGreaterThan(left + metricsMeasurer.width(line, 14, 1));
    expect(arrow).toBeLessThan(narrow.width - 8 - 24);
  });

  it('gives every overlapping event relation a rail, growing wider when they run out of room', () => {
    const frame = (i: number): string => String(i).padStart(2, '0');
    let source = 'eventmodeling\n\n';
    for (let i = 1; i <= 7; i++) source += `tf ${frame(i)} evt Source${i}\n`;
    for (let i = 8; i <= 14; i++) source += `tf ${frame(i)} rmo Target${i} ->> ${frame(i - 7)}\n`;
    for (const maxWidth of [320, 200]) {
      const narrow = render(source, { ...options, maxWidth });
      const rails = items(narrow.scene, 'pele-edge').map((edge) => railOf(narrow.scene, edge.id));
      expect(rails.length).toBe(7);
      expect(new Set(rails).size).toBe(7);
      expect(Math.max(...rails)).toBeLessThan(narrow.width - 8);
      if (maxWidth === 320) expect(narrow.width).toBeLessThanOrEqual(320);
    }
  });

  it('splits a packet field only where a narrow row ends, whatever the rows were set to', () => {
    const source = '---\nconfig:\n  packet:\n    bitsPerRow: 20\n---\npacket\n0-39: "Long field"\n40-59: "Next"\n';
    const narrow = render(source, phone);
    const ranges = items(narrow.scene, 'pele-node').map((item) => item.id);
    expect(ranges).toEqual(['0-15', '16-31', '32-39', '40-47', '48-59']);
    expect(narrow.width).toBeLessThanOrEqual(320);
  });

  it('reads journey text and scores in the vertical drawing as the wide one does', () => {
    const day = (score: string): string => `journey\n  title My <b>day</b>\n  section Go <i>to</i> work\n    Make <u>tea</u>: ${score}: Me\n    Walk: 3: Me\n    Sit: 3: Me\n    Sleep: 3: Me\n`;
    const wide = render(day('4'), options), narrow = render(day('4'), { ...options, maxWidth: 200 });
    expect(same(narrow.scene, wide.scene)).toBe(false);
    for (const label of ['My<b>day</b>', 'Go<i>to</i>work', 'Make<u>tea</u>']) {
      expect(texts(wide.scene)).toContain(label);
      expect(texts(narrow.scene)).toContain(label);
    }
    // The score of a step is the only line of it that is a number.
    const scores = (score: string): string[] => render(day(score), { ...options, maxWidth: 200 }).scene.texts.map(lineOf).filter((line) => /^\d+(?:\.\d+)?$/.test(line));
    expect(scores('4')).toEqual(['4', '3', '3', '3']);
    expect(scores('abc')).toEqual(['3', '3', '3']);
    expect(scores('1e21')).toEqual(['5', '3', '3', '3']);
    expect(scores('3.14159')).toEqual(['3.14', '3', '3', '3']);
  });

  it('wraps a long title to the width a narrow flowchart or swimlane has', () => {
    const title = '---\ntitle: Order handling from the first enquiry to the final delivery and invoice\n---\n';
    const lanes = 'swimlane-beta LR\n  subgraph Sales\n    A[Enquiry] --> B[Quote]\n  end\n  subgraph Ops\n    C[Deliver] --> D[Invoice]\n  end\n  B --> C\n';
    for (const source of [lanes, 'flowchart TB\n  A --> B\n']) {
      const wide = render(title + source, options);
      expect(wide.width).toBeGreaterThan(500);
      expect(same(render(title + source, { ...options, maxWidth: wide.width }).scene, wide.scene)).toBe(true);
      const narrow = render(title + source, phone);
      expect(narrow.width).toBeLessThanOrEqual(320);
      expect(flat(narrow.scene)).toContain('Orderhandlingfromthefirstenquirytothefinaldeliveryandinvoice');
    }
  });

  it('starts every line of a wrapped filename at one place and keeps its spaces', () => {
    const narrow = render('treeView-beta\n  "my  file  with   spaces.txt"\n  "another_really_long_file_name  with  spaces_in_it.txt"\n', { ...options, maxWidth: 200 });
    const lines = narrow.scene.texts;
    expect(lines.map(lineOf)).toEqual(['my  file  with   spaces.txt', 'another_really_long_file', '_name  with', 'spaces_in_it.txt']);
    for (const line of lines) {
      expect(line.anchor).toBe('start');
      expect(line.x).toBe(lines[0].x);
    }
  });

  it('ends a vertical event model or Ishikawa at its last card', () => {
    const pad = 8;
    const frames = 'eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded\n';
    for (const source of [frames, frames + 'note 02 {\n Checked first\n}\n', 'ishikawa-beta\n  Late delivery\n  People\n    Too few reviewers\n      No time set aside\n  Process\n']) {
      const narrow = render(source, { ...options, maxWidth: 200 });
      expect(same(narrow.scene, render(source).scene)).toBe(false);
      const bottoms = boxes(narrow.scene).map((box) => box.y + box.h);
      expect(narrow.height, source).toBe(Math.ceil(Math.max(...bottoms) + pad));
    }
  });

  it('preserves literal text, Unicode and styled spans through long-word wrapping', () => {
    const raw = '<literal>& emoji 🐈 中文 ' + 'filename_'.repeat(40);
    const label = literalLabel(raw, metricsMeasurer, 16, 100);
    const lines = label.lines.flat().map(span => span.text);
    expect(lines.join('').replace(/\s/g, '')).toBe(raw.replace(/\s/g, ''));
    for (const line of lines) expect(line).toBe(line.trim());
    expect(lines[0]).toBe('<literal>&');
    expect(label.width).toBeLessThanOrEqual(100);
    const styled = layoutLabel('<b>Supercalifragilisticexpialidocious</b>', false, metricsMeasurer, 16, 400);
    const wrapped = breakLabel(styled, metricsMeasurer, 80);
    expect(wrapped.lines.flat().map(span => span.text).join('')).toBe('Supercalifragilisticexpialidocious');
    expect(wrapped.lines.flat().every(span => span.style === 1)).toBe(true);
    expect(wrapped.width).toBeLessThanOrEqual(80);
  });
});
