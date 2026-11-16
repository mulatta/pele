import { describe, expect, it } from 'vitest';
import { PeleError, parse, supports } from '../../src/index.js';
import type { KanbanModel } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { draw, itemById, items, lineOf, lines, shapesOf, textsOf } from '../support/scene.js';

const BASE = "---\nconfig:\n  kanban:\n    ticketBaseUrl: 'https://example.com/browse/#TICKET#'\n---\n";

function model(src: string): KanbanModel {
  return parse(src) as KanbanModel;
}

describe('kanban rendering', () => {
  it('draws a column per section and a card per item, with counts', () => {
    const { scene, type } = draw('kanban\n  todo[To do]\n    a[First]\n    b[Second]\n  done[Done]\n    c[Third]\n  later[Later]');
    expect(type).toBe('kanban');
    expect(supports('kanban\n  a')).toBe(true);
    const columns = items(scene, 'pele-column');
    expect(columns.length).toBe(3);
    expect(items(scene, 'pele-card').length).toBe(3);
    for (const text of ['To do', 'First', 'Second', 'Done', 'Third', 'Later']) expect(lines(scene)).toContain(text);
    const counts = columns.map((column) => textsOf(scene, column).find((t) => t.anchor === 'end')?.spans[0].text);
    expect(counts).toEqual(['2', '1', '0']);
    expect(itemById(scene, 'todo', 'pele-column')).toBeDefined();
    expect(itemById(scene, 'a', 'pele-card')).toBeDefined();
  });

  it('gives every column the width of the others and the height of the tallest', () => {
    const { scene } = draw('kanban\n  a\n    one\n    two\n    three\n  b\n    four\n  c');
    const columns = items(scene, 'pele-column').map((column) => column.box!);
    expect(columns.length).toBe(3);
    expect(new Set(columns.map((box) => box.x1 - box.x0))).toEqual(new Set([200]));
    expect(new Set(columns.map((box) => box.y1 - box.y0)).size).toBe(1);
    expect(columns[1].x0 - columns[0].x0).toBe(columns[2].x0 - columns[1].x0);
    const wide = draw('---\nconfig:\n  kanban:\n    sectionWidth: 320\n---\nkanban\n  a\n    one\n  b');
    expect(items(wide.scene, 'pele-column').map((column) => column.box!.x1 - column.box!.x0)).toEqual([320, 320]);
    expect(wide.width).toBeGreaterThan(640);
  });

  it('treats every deeper line as a card of the last column', () => {
    const { sections } = model('kanban\n  root\n    child1\n      leaf1\n    child2\n  second\n      deep');
    expect(sections.map((section) => section.items.map((item) => item.id))).toEqual([['child1', 'leaf1', 'child2'], ['deep']]);
  });

  it('rejects a line after one indented less than the first column', () => {
    expect(model('kanban\n    a\n  shallow').sections[0].items[0].id).toBe('shallow');
    const bad = (): unknown => draw('kanban\n    a\n  shallow\n    b');
    expect(bad).toThrow(PeleError);
    expect(bad).toThrow('Items without section detected, found section ("shallow")');
  });

  it('reads metadata on one line and on several', () => {
    const one = model("kanban\n  todo\n    a[Task]@{ ticket: MC-2037, assigned: 'knsv', priority: 'High', icon: star }").sections[0].items[0];
    expect(one).toMatchObject({ id: 'a', label: 'Task', ticket: 'MC-2037', assigned: 'knsv', priority: 'High', icon: 'star' });
    const many = model('kanban\n  todo\n    a@{\n      assigned: knsv\n      label: "A new\n        label"\n      ticket: 12\n    }').sections[0].items[0];
    expect(many).toMatchObject({ assigned: 'knsv', label: 'A new<br/>label', ticket: '12' });
  });

  it('shows the assignee and the ticket', () => {
    const { scene, links } = draw("kanban\n  todo\n    a[Task]@{ ticket: MC-1, assigned: 'knsv' }");
    const [ticket, assigned] = textsOf(scene, itemById(scene, 'a', 'pele-card')!).slice(1);
    expect(ticket).toMatchObject({ paint: 'var(--_m)', anchor: 'start' });
    expect(ticket.spans.map((span) => span.text)).toEqual(['MC-1']);
    expect(assigned).toMatchObject({ paint: 'var(--_m)', anchor: 'end' });
    expect(assigned.spans.map((span) => span.text)).toEqual(['knsv']);
    expect(links).toEqual([]);
  });

  it('links the ticket through ticketBaseUrl', () => {
    const { links } = draw(BASE + 'kanban\n  todo\n    a[Task]@{ ticket: MC-1 }\n    b[Other]@{ ticket: "$&" }');
    expect(links).toEqual([
      { id: 'a', href: 'https://example.com/browse/MC-1', internal: false },
      { id: 'b', href: 'https://example.com/browse/$&', internal: false },
    ]);
  });

  it('drops a ticket link that is not a safe URL', () => {
    const src = "---\nconfig:\n  kanban:\n    ticketBaseUrl: 'javascript:alert(#TICKET#)'\n---\nkanban\n  todo\n    a[Task]@{ ticket: MC-1 }";
    const { scene, links } = draw(src);
    expect(lines(scene)).toContain('MC-1');
    expect(links).toEqual([]);
    const whole = draw("---\nconfig:\n  kanban:\n    ticketBaseUrl: '#TICKET#'\n---\nkanban\n  todo\n    a[Task]@{ ticket: 'javascript:alert(1)' }");
    expect(whole.links).toEqual([]);
  });

  it('marks priority with a colored edge', () => {
    const src =
      "kanban\n  todo\n    a[A]@{ priority: 'Very High' }\n    b[B]@{ priority: High }\n    c[C]@{ priority: Medium }\n" +
      "    d[D]@{ priority: 'Low' }\n    e[E]@{ priority: 'Very Low' }\n    f[F]@{ priority: high }\n    g[G]@{ priority: whenever }";
    const { scene } = draw(src);
    // The priority edge is the only 3-wide stroke of a card.
    const edge = (id: string): string | undefined => {
      const shape = shapesOf(scene, itemById(scene, id, 'pele-card')!).find((s) => s.kind === 'stroke' && s.width === 3);
      return shape && `${shape.paint} ${shape.opacity}`;
    };
    const red = 'var(--pele-critical,#e45756) ';
    const grey = 'var(--_m) ';
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(edge)).toEqual([red + 1, red + 0.5, undefined, grey + 0.5, grey + 1, red + 0.5, undefined]);
    expect(scene.shapes.some((shape) => shape.paint.includes('--pele-series-'))).toBe(false);
    expect(itemById(scene, 'a', 'pele-priority-very-high')).toBeDefined();
    expect(itemById(scene, 'g', 'pele-card')?.kind).toBe('pele-node pele-card');
  });

  it('applies classes and icons to columns and cards', () => {
    const src = 'kanban\n  todo[To do]\n  :::wide\n  ::icon(inbox)\n    a[Task]@{ icon: star }\n    :::urgent large';
    const { scene } = draw(src, { icons: () => '<path d="M0,0 L4,0 L4,4 Z"/>' });
    const column = itemById(scene, 'todo', 'wide')!;
    const card = itemById(scene, 'a', 'urgent')!;
    expect(column.kind).toBe('pele-cluster pele-column wide');
    expect(card.kind).toBe('pele-node pele-card urgent large');
    for (const item of [column, card]) expect(shapesOf(scene, item).some((shape) => shape.paint === 'var(--_fg)')).toBe(true);
  });

  it('wraps card text and breaks a word that is longer than the card', () => {
    const short = draw('kanban\n  todo\n    a[Short]');
    const long = draw('kanban\n  todo\n    a[' + 'several words that wrap '.repeat(4) + ']');
    const word = draw('kanban\n  todo\n    a[' + 'x'.repeat(120) + ']');
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.width).toBe(short.width);
    expect(word.width).toBe(short.width);
    const pieces = lines(word.scene).filter((line) => /^x+$/.test(line));
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.join('')).toBe('x'.repeat(120));
    for (const piece of pieces) expect(metricsMeasurer.width(piece, 14, 0)).toBeLessThanOrEqual(164);
  });

  it('uses a label from metadata and formats markdown', () => {
    const { scene } = draw('kanban\n  todo\n    a[Old]@{ label: "New **bold** text" }');
    expect(lines(scene)).not.toContain('Old');
    const [label] = textsOf(scene, itemById(scene, 'a', 'pele-card')!);
    expect(label.spans.map((span) => [span.text, span.weight])).toEqual([['New ', undefined], ['bold', 700], [' text', undefined]]);
  });

  it('reports metadata that is not valid YAML, and ignores metadata that is not a mapping', () => {
    expect(() => draw('kanban\n  todo\n    a@{ label: "x }')).toThrow(PeleError);
    expect(() => draw('kanban\n  todo\n    a@{ a: [ }')).toThrow(/not valid YAML/);
    expect(lines(draw('kanban\n  todo\n    a@{\n}').scene)).toContain('a');
    expect(lines(draw('kanban\n  todo\n    a@{\n - x\n}').scene)).toContain('a');
    expect(lines(draw('kanban\n  todo\n    a@{}').scene)).toContain('a');
  });

  it('rejects shape names Mermaid rejects', () => {
    expect(() => draw('kanban\n  todo\n    a@{ shape: Rect }')).toThrow('No such shape: Rect. Shape names should be lowercase.');
    expect(() => draw('kanban\n  todo\n    a@{ shape: kanban_item }')).toThrow(/No such shape/);
    expect(lines(draw('kanban\n  todo\n    a@{ shape: rect }').scene)).toContain('a');
  });

  it('ignores a decoration that comes before any node', () => {
    expect(lines(draw('kanban\n::icon(star)\n:::big\ntodo').scene)).toContain('todo');
  });

  it('draws the front matter title', () => {
    const plain = draw('kanban\n  todo\n    a');
    const titled = draw('---\ntitle: Sprint 12\n---\nkanban\n  todo\n    a');
    expect(titled.scene.texts.find((t) => lineOf(t) === 'Sprint 12')).toMatchObject({ weight: 700, item: -1 });
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it('renders a board with no columns', () => {
    expect(draw('kanban\n\n').scene.items).toEqual([]);
  });

  it('is deterministic and emits only finite numbers', () => {
    const src = BASE + "kanban\n  Todo\n    [Create Documentation]\n  id9[Ready]\n    id8[Design grammar]@{ assigned: 'knsv', ticket: MC-1, priority: 'Low' }";
    const first = JSON.stringify(draw(src).scene);
    expect(JSON.stringify(draw(src).scene)).toBe(first);
    expect(first).not.toMatch(/NaN|Infinity|undefined/);
  });
});
