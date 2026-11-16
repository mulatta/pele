import { describe, expect, it } from 'vitest';
import { Paint, type Out } from '../../src/draw/out.js';
import { SceneOut } from '../../src/draw/scene.js';
import { layoutLabel } from '../../src/text/label.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { sceneDifference, svgToScene } from '../support/svg-scene.js';

const ROOT = '<svg xmlns="http://www.w3.org/2000/svg" class="pele pele-test" viewBox="0 0 200 100" width="200" height="100" style="max-width:100%;height:auto;--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#1f1f1f);--_m:var(--pele-muted,#6e6e6e);--_l:var(--pele-line,#1f1f1f);--_s:var(--pele-surface,#f3f3f3);--_a:var(--pele-surface-alt,#e6e6e6);--_b:var(--pele-border,#8a8a8a);--_c:var(--pele-accent,#5b7bd5);color:var(--_fg);--_w:var(--pele-bold-weight,bold);--_fm:var(--pele-font-mono,monospace);font:16px sans-serif;letter-spacing:normal;word-spacing:normal;text-transform:none;direction:ltr;font-family:var(--pele-font,sans-serif)" fill="var(--_fg)" role="graphics-document document" aria-roledescription="test">';

// The calls drawn into a scene, with the SVG pele wrote for the same calls when it wrote SVG: a
// scene is to show what that SVG shows, as an SVG reader sees it.
function both(draw: (out: Out) => void, inner: string) {
  const scene = new SceneOut();
  draw(scene);
  scene.done(200, 100);
  return { svg: `${ROOT}${inner}</svg>`, scene: scene.scene! };
}

describe('drawing outputs', () => {
  it('draw the picture the SVG showed', () => {
    const label = layoutLabel('Two **words**', true, metricsMeasurer, 16, 200);
    const { svg, scene } = both(
      (out) => {
        out.section('edges', ' class="pele-edges" fill="none" stroke="var(--_l)"');
        out.section('nodes', ' class="pele-nodes"', true);
        out.group({ cls: 'pele-node', id: 'a&b', source: { line: 2 }, x: 40, y: 30 });
        out.fragment('<rect x="-20" y="-10" width="40" height="20" fill="var(--_s)" stroke="var(--_b)"/>');
        out.link();
        out.label(label, 0, 0, ' class="pele-label"');
        out.end();
        out.end();
        out.section('edges', ' class="pele-edges" fill="none" stroke="var(--_l)"');
        out.group({ cls: 'pele-edge', id: 'e1' });
        out.path('M0,0L10,10', ' stroke-width="2.5"', [77, 2, 0, 0, 76, 2, 10, 10]);
        out.fragment('<g class="pele-edge-label" data-id="e1-label"><text x="5" y="5" text-anchor="middle">on <tspan font-weight="var(--_w)">edge</tspan></text></g>');
        out.end();
        out.shift(100, 50);
        out.fragment('<circle r="4" fill="var(--_c)"/>');
        out.end();
      },
      '<g class="pele-edges" fill="none" stroke="var(--_l)"><g class="pele-edge" data-id="e1"><path d="M0,0L10,10" stroke-width="2.5"/><g class="pele-edge-label" data-id="e1-label"><text x="5" y="5" text-anchor="middle">on <tspan font-weight="var(--_w)">edge</tspan></text></g></g><g transform="translate(100,50)"><circle r="4" fill="var(--_c)"/></g></g><g class="pele-nodes"><g class="pele-node" data-id="a&amp;b" data-line="2" transform="translate(40,30)"><rect x="-20" y="-10" width="40" height="20" fill="var(--_s)" stroke="var(--_b)"/><a href="https://example.com"><text class="pele-label" text-anchor="middle" xml:space="preserve"><tspan x="0" y="5.6">Two </tspan><tspan font-weight="var(--_w)">words</tspan></text></a></g></g>'
    );
    expect(sceneDifference(scene, svgToScene(svg))).toBeNull();
    expect(scene.items.map((i) => i.id)).toEqual(['e1', 'e1-label', 'a&b']);
    expect(scene.texts.map((t) => t.spans.map((s) => s.text).join(''))).toEqual(['on edge', 'Two words']);
  });

  it('turn what a turned group holds, and leave out empty layers and unknown transforms', () => {
    const { svg, scene } = both((out) => {
      out.section('labels', ' class="pele-labels"');
      out.section('main');
      out.group({ cls: 'pele-axis', id: 'y', attrs: ' transform="translate(20,40) rotate(-90)"' });
      out.fragment('<text x="0" y="0">turned</text>');
      out.rect(0, 0, 10, 4, ' fill="var(--_s)" stroke="var(--_b)" stroke-width="2"');
      out.group({ attrs: ' transform="scale(2)"' });
      out.circle(5, 0, 1, ' fill="var(--_c)"');
      out.end();
      out.end();
      out.group({ cls: 'pele-axis', id: 'x', attrs: ' transform="translate(5,6)"' });
      out.fragment('<text x="0" y="0">moved</text>');
      out.end();
      out.group({ cls: 'pele-axis', id: 'z', attrs: ' transform="perspective(2)"' });
      out.fragment('<text x="0" y="0">unread</text>');
      out.end();
    }, '<g class="pele-axis" data-id="y" transform="translate(20,40) rotate(-90)"><text x="0" y="0">turned</text><rect x="0" y="0" width="10" height="4" fill="var(--_s)" stroke="var(--_b)" stroke-width="2"/><g transform="scale(2)"><circle cx="5" cy="0" r="1" fill="var(--_c)"/></g></g><g class="pele-axis" data-id="x" transform="translate(5,6)"><text x="0" y="0">moved</text></g><g class="pele-axis" data-id="z" transform="perspective(2)"><text x="0" y="0">unread</text></g>');
    expect(sceneDifference(scene, svgToScene(svg))).toBeNull();
    expect(scene.items.map((i) => i.id)).toEqual(['y', 'x']);
    expect(scene.texts.map((t) => [t.spans[0].text, t.x, t.y, t.angle])).toEqual([
      ['turned', 20, 40, -90],
      ['moved', 5, 6, undefined],
    ]);
    // The rect runs up from (20, 40); the scaled circle sits 10 above it, at twice the size.
    const [fill, stroke, dot] = scene.shapes;
    expect(fill.box).toMatchObject({ x0: 20, y0: 30, x1: 24, y1: 40 });
    expect(stroke.width).toBe(2);
    for (const [k, v] of Object.entries({ x0: 18, y0: 28, x1: 22, y1: 32 })) expect(dot.box[k as keyof typeof dot.box]).toBeCloseTo(v, 9);
    expect(scene.skipped).toEqual({ transform: 1 });
  });

  it('draw shapes, path data and paints as numbers', () => {
    const edge = new Paint(' fill="none" stroke="var(--_l)" stroke-width="2"');
    const { svg, scene } = both((out) => {
      out.group({ cls: 'pele-node', id: 'n', x: 10, y: 5 });
      out.circle(0, 0, 4, edge);
      out.circle(9, 9, 3, ' fill="var(--_c)"');
      out.ellipse(20, 10, 6, 3, ' fill="var(--_s)"');
      out.line(0, 0, 30, 0, edge);
      out.polygon([0, 0, 10, 0, 5, 8], ' fill="var(--_b)"');
      out.path(out.pen().M(0, 0).L(1.234, 5).H(9).V(2).C(1, 2, 3, 4, 5, 6).Q(7, 8, 9, 10).A(4, 4, 0, 0, 1, 12, 12).Z(), edge);
      out.text(3, 4, 'a<b', edge, ' text-anchor="end"');
      out.end();
    }, '<g class="pele-node" data-id="n" transform="translate(10,5)"><circle cx="0" cy="0" r="4" fill="none" stroke="var(--_l)" stroke-width="2"/><circle cx="9" cy="9" r="3" fill="var(--_c)"/><ellipse cx="20" cy="10" rx="6" ry="3" fill="var(--_s)"/><line x1="0" y1="0" x2="30" y2="0" fill="none" stroke="var(--_l)" stroke-width="2"/><polygon points="0,0 10,0 5,8" fill="var(--_b)"/><path d="M0,0L1.23,5H9V2C1,2 3,4 5,6Q7,8 9,10A4,4 0 0 1 12,12Z" fill="none" stroke="var(--_l)" stroke-width="2"/><text fill="none" stroke="var(--_l)" stroke-width="2" x="3" y="4" text-anchor="end">a&lt;b</text></g>');
    expect(sceneDifference(scene, svgToScene(svg))).toBeNull();
    expect(scene.shapes.length).toBe(6);
  });

  it('draw relative path data, shapes at the origin, runs of text and icons', () => {
    const { svg, scene } = both((out) => {
      out.group({ cls: 'pele-node', id: 'n', x: 4, y: 2 });
      out.path(out.pen().M(1, 1).l(2, 3).h(4).v(-1).c(1, 1, 2, 2, 3, 0).s(1, 1, 2, 0).q(1, 2, 3, 0).t(2, 0).a(2, 2, 0, 0, 1, 4, 0).z().m(5, 5).S(9, 9, 10, 10).T(12, 9).Z(), ' fill="var(--_s)" stroke="var(--_b)"');
      out.circle(null, null, 3, ' fill="var(--_c)"');
      out.circle(null, 6, 2, ' fill="var(--_c)"');
      out.rect(null, null, 8, 5, ' fill="var(--_s)"');
      out.spans(0, 9, [{ text: 'a & ' }, { text: 'b', attrs: ' font-weight="var(--_w)"' }, { text: ' c', attrs: ' fill="var(--_m)"' }], ' font-size="12"', ' text-anchor="middle"');
      out.opaque('<svg class="pele-icon" data-icon="x" x="2" y="1" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--_m)" stroke-width="2"><path d="M4 4h16v16H4z"/><circle cx="12" cy="12" r="4" fill="var(--_c)" stroke-dasharray="2 1"/></svg>', 'icon');
      out.circle(null, null, 1.5, ' fill="var(--_l)"');
      out.end();
    }, '<g class="pele-node" data-id="n" transform="translate(4,2)"><path d="M1,1l2,3h4v-1c1,1 2,2 3,0s1,1 2,0q1,2 3,0t2,0a2,2 0 0 1 4,0zm5,5S9,9 10,10T12,9Z" fill="var(--_s)" stroke="var(--_b)"/><circle r="3" fill="var(--_c)"/><circle cy="6" r="2" fill="var(--_c)"/><rect width="8" height="5" fill="var(--_s)"/><text font-size="12" x="0" y="9" text-anchor="middle">a &amp; <tspan font-weight="var(--_w)">b</tspan><tspan fill="var(--_m)"> c</tspan></text><svg class="pele-icon" data-icon="x" x="2" y="1" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--_m)" stroke-width="2"><path d="M4 4h16v16H4z"/><circle cx="12" cy="12" r="4" fill="var(--_c)" stroke-dasharray="2 1"/></svg><circle r="1.5" fill="var(--_l)"/></g>');
    expect(sceneDifference(scene, svgToScene(svg))).toBeNull();
    expect(scene.texts[0].spans).toEqual([{ text: 'a & ' }, { text: 'b', weight: 700 }, { text: ' c', paint: 'var(--_m)' }]);
    // The icon's 24-unit viewBox is drawn at half size in its 12-unit box, line widths too.
    const icon = scene.shapes.filter((s) => s.paint === 'var(--_m)');
    expect(icon.map((s) => [s.kind, s.width, s.cmds.slice(0, 3)])).toEqual([
      ['stroke', 1, [0, 8, 5]],
      ['stroke', 1, [0, 10, 9]],
    ]);
    expect(scene.shapes.find((s) => s.kind === 'stroke' && s.dash)?.dash).toEqual([1, 0.5]);
    expect(scene.skipped).toEqual({});
  });

  it('place, order and keep what the SVG did', () => {
    const cases: [string, (out: Out) => void, string][] = [
      ['a group moved down only', (out) => {
        out.group({ y: 30 });
        out.rect(0, 0, 10, 10, ' fill="red"');
        out.end();
      }, '<g transform="translate(0,30)"><rect x="0" y="0" width="10" height="10" fill="red"/></g>'],
      ['a section drawn within another', (out) => {
        out.section('outer');
        out.rect(0, 0, 1, 1, ' fill="red"');
        out.section('other');
        out.rect(0, 0, 1, 1, ' fill="green"');
        out.section('inner', '', false, 'outer');
        out.rect(0, 0, 1, 1, ' fill="blue"');
      }, '<rect x="0" y="0" width="1" height="1" fill="red"/><rect x="0" y="0" width="1" height="1" fill="blue"/><rect x="0" y="0" width="1" height="1" fill="green"/>'],
      ['a pen drawn on after it is drawn', (out) => {
        const pen = out.pen().M(0, 0).L(10, 0);
        out.path(pen, ' stroke="black"');
        pen.L(10, 10);
        out.path(pen, ' stroke="red"');
      }, '<path d="M0,0L10,0" stroke="black"/><path d="M0,0L10,0L10,10" stroke="red"/>'],
      ['a source placeholder in an id', (out) => {
        out.group({ id: 'A\uFB02\u00B0amp\u00B6\u00DFB' });
        out.rect(0, 0, 10, 10, ' fill="red"');
        out.end();
      }, '<g data-id="A&amp;B"><rect x="0" y="0" width="10" height="10" fill="red"/></g>'],
    ];
    for (const [name, draw, inner] of cases) {
      const { svg, scene } = both(draw, inner);
      expect(sceneDifference(scene, svgToScene(svg)), name).toBeNull();
    }
  });

  // Attribute text is SVG: its entities mean their characters, before CSS reads a style.
  it('read paints as the attribute text means them', () => {
    const out = new SceneOut();
    out.rect(0, 0, 1, 1, ' fill="a&amp;b" stroke="#&#49;23"');
    out.rect(0, 0, 1, 1, ' style="fill:x&quot;y"');
    out.done(10, 10);
    expect(out.scene!.shapes.map((s) => s.paint)).toEqual(['a&b', '#123', 'x"y']);
  });

  // An icon is drawn in currentColor, which is the text color unless a group sets another.
  it('paint currentColor in the text color', () => {
    const out = new SceneOut();
    out.circle(0, 0, 1, ' fill="currentColor"');
    out.group({ attrs: ' color="var(--_m)"' });
    out.circle(0, 0, 1, ' fill="currentColor"');
    out.end();
    out.done(10, 10);
    expect(out.scene!.shapes.map((s) => s.paint)).toEqual(['var(--_fg)', 'var(--_m)']);
  });

  it('keep each attempt apart and take the one adopted', () => {
    const out = new SceneOut();
    const attempts = [100, 200].map((w) => {
      const o = out.fork();
      o.group({ cls: 'pele-node', id: `w${w}` });
      o.end();
      o.done(w, 10);
      return o;
    });
    out.adopt(attempts[1]);
    expect(out.scene!.items.map((i) => i.id)).toEqual(['w200']);
  });
});
