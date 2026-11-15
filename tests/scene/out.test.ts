import { describe, expect, it } from 'vitest';
import { Paint, type Out } from '../../src/draw/out.js';
import { SceneOut } from '../../src/draw/scene.js';
import { SvgOut } from '../../src/draw/svg.js';
import { layoutLabel } from '../../src/text/label.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { sceneDifference, svgToScene } from '../support/svg-scene.js';

// Draws the same calls into both outputs.
function both(draw: (out: Out) => void) {
  const svg = new SvgOut({ sourceInfo: true });
  const scene = new SceneOut();
  for (const out of [svg, scene]) {
    draw(out);
    out.done('test', 200, 100, 16, {}, {});
  }
  return { svg: svg.svg, scene: scene.scene! };
}

describe('drawing outputs', () => {
  it('write the same picture as SVG and as a scene', () => {
    const label = layoutLabel('Two **words**', true, metricsMeasurer, 16, 200);
    const { svg, scene } = both(
      (out) => {
        out.section('edges', ' class="pele-edges" fill="none" stroke="var(--_l)"');
        out.section('nodes', ' class="pele-nodes"', true);
        out.group({ cls: 'pele-node', id: 'a&b', source: { line: 2 }, x: 40, y: 30 });
        out.tooltip('hint');
        out.fragment('<rect x="-20" y="-10" width="40" height="20" fill="var(--_s)" stroke="var(--_b)"/>');
        out.link(' href="https://example.com"');
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
        out.raw('<image href="x.png" width="4" height="4"/>');
      }
    );
    expect(svg).toContain('<g class="pele-edges" fill="none" stroke="var(--_l)"><g class="pele-edge" data-id="e1">');
    expect(svg).toContain('<g class="pele-node" data-id="a&amp;b" data-line="2" transform="translate(40,30)"><title>hint</title>');
    expect(sceneDifference(scene, svgToScene(svg))).toBeNull();
    expect(scene.items.map((i) => i.id)).toEqual(['e1', 'e1-label', 'a&b']);
    expect(scene.texts.map((t) => t.spans.map((s) => s.text).join(''))).toEqual(['on edge', 'Two words']);
  });

  it('leave out a group the scene cannot turn, and empty layers', () => {
    const { svg, scene } = both((out) => {
      out.section('labels', ' class="pele-labels"');
      out.section('main');
      out.group({ cls: 'pele-axis', id: 'y', attrs: ' transform="rotate(-90)"' });
      out.fragment('<text x="0" y="0">turned</text>');
      out.end();
      out.group({ cls: 'pele-axis', id: 'x', attrs: ' transform="translate(5,6)"' });
      out.fragment('<text x="0" y="0">moved</text>');
      out.end();
    });
    expect(svg).not.toContain('pele-labels');
    expect(sceneDifference(scene, svgToScene(svg))).toBeNull();
    expect(scene.items.map((i) => i.id)).toEqual(['x']);
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
    });
    expect(svg).toContain('<path d="M0,0L1.23,5H9V2C1,2 3,4 5,6Q7,8 9,10A4,4 0 0 1 12,12Z" fill="none" stroke="var(--_l)" stroke-width="2"/>');
    expect(svg).toContain('<polygon points="0,0 10,0 5,8" fill="var(--_b)"/>');
    expect(sceneDifference(scene, svgToScene(svg))).toBeNull();
    expect(scene.shapes.length).toBe(6);
  });

  it('keep each attempt apart and take the one adopted', () => {
    for (const out of [new SvgOut({}), new SceneOut()]) {
      const attempts = [100, 200].map((w) => {
        const o = out.fork();
        o.group({ cls: 'pele-node', id: `w${w}` });
        o.end();
        o.done('test', w, 10, 16, {}, {});
        return o;
      });
      out.adopt(attempts[1]);
      if (out instanceof SvgOut) expect(out.svg).toContain('data-id="w200"');
      else expect(out.scene!.items.map((i) => i.id)).toEqual(['w200']);
    }
  });
});
