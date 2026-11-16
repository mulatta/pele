// Writes a drawing as SVG text, each layer in a buffer of its own until the document is put
// together.
import { esc, escText, labelSvg, num, sourceAttrs } from '../svg/builder.js';
import { svgDocument, type Accessible } from '../svg/root.js';
import type { Label } from '../text/label.js';
import type { IconResolver, RenderOptions } from '../types.js';
import type { Attrs, Group, Item, Out, Pen, Run } from './out.js';

const text = (a: Attrs): string => (typeof a === 'string' ? a : a.attrs);

class SvgPen implements Pen {
  d = '';
  M(x: number, y: number): this {
    this.d += 'M' + num(x) + ',' + num(y);
    return this;
  }
  L(x: number, y: number): this {
    this.d += 'L' + num(x) + ',' + num(y);
    return this;
  }
  H(x: number): this {
    this.d += 'H' + num(x);
    return this;
  }
  V(y: number): this {
    this.d += 'V' + num(y);
    return this;
  }
  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.d += 'C' + num(x1) + ',' + num(y1) + ' ' + num(x2) + ',' + num(y2) + ' ' + num(x) + ',' + num(y);
    return this;
  }
  Q(x1: number, y1: number, x: number, y: number): this {
    this.d += 'Q' + num(x1) + ',' + num(y1) + ' ' + num(x) + ',' + num(y);
    return this;
  }
  A(rx: number, ry: number, rotation: number, large: 0 | 1, sweep: 0 | 1, x: number, y: number): this {
    this.d += 'A' + num(rx) + ',' + num(ry) + ' ' + num(rotation) + ' ' + large + ' ' + sweep + ' ' + num(x) + ',' + num(y);
    return this;
  }
  Z(): this {
    this.d += 'Z';
    return this;
  }
  S(x2: number, y2: number, x: number, y: number): this {
    this.d += 'S' + num(x2) + ',' + num(y2) + ' ' + num(x) + ',' + num(y);
    return this;
  }
  T(x: number, y: number): this {
    this.d += 'T' + num(x) + ',' + num(y);
    return this;
  }
  m(dx: number, dy: number): this {
    this.d += 'm' + num(dx) + ',' + num(dy);
    return this;
  }
  l(dx: number, dy: number): this {
    this.d += 'l' + num(dx) + ',' + num(dy);
    return this;
  }
  h(dx: number): this {
    this.d += 'h' + num(dx);
    return this;
  }
  v(dy: number): this {
    this.d += 'v' + num(dy);
    return this;
  }
  c(dx1: number, dy1: number, dx2: number, dy2: number, dx: number, dy: number): this {
    this.d += 'c' + num(dx1) + ',' + num(dy1) + ' ' + num(dx2) + ',' + num(dy2) + ' ' + num(dx) + ',' + num(dy);
    return this;
  }
  s(dx2: number, dy2: number, dx: number, dy: number): this {
    this.d += 's' + num(dx2) + ',' + num(dy2) + ' ' + num(dx) + ',' + num(dy);
    return this;
  }
  q(dx1: number, dy1: number, dx: number, dy: number): this {
    this.d += 'q' + num(dx1) + ',' + num(dy1) + ' ' + num(dx) + ',' + num(dy);
    return this;
  }
  t(dx: number, dy: number): this {
    this.d += 't' + num(dx) + ',' + num(dy);
    return this;
  }
  a(rx: number, ry: number, rotation: number, large: 0 | 1, sweep: 0 | 1, dx: number, dy: number): this {
    this.d += 'a' + num(rx) + ',' + num(ry) + ' ' + num(rotation) + ' ' + large + ' ' + sweep + ' ' + num(dx) + ',' + num(dy);
    return this;
  }
  z(): this {
    this.d += 'z';
    return this;
  }
  both(svg: string): this {
    this.d += svg;
    return this;
  }
}

interface Layer {
  name: string;
  attrs: string;
  always: boolean;
  body: string;
  // The layers written in this one's group, after it.
  inner: Layer[] | null;
  within: boolean;
}

export class SvgOut implements Out {
  svg = '';
  readonly sources: boolean;
  readonly numbers = false;
  // What is written to the current layer since it was switched to; kept out of the layer object,
  // where every write would be one more lookup.
  private body = '';
  private current: Layer = { name: 'main', attrs: '', always: false, body: '', inner: null, within: false };
  private layers: Layer[] = [this.current];
  private open: string[] = [];
  // The moved group around later layers, and the first layer in it.
  private framed: { x: number; y: number; from: number } | null = null;

  constructor(private readonly options: RenderOptions) {
    this.sources = options.sourceInfo === true;
  }

  fork(): SvgOut {
    return new SvgOut(this.options);
  }

  adopt(attempt: Out): void {
    this.svg = (attempt as SvgOut).svg;
  }

  section(name: string, attrs = '', always = false, within?: string): void {
    if (this.current.name === name) return;
    this.current.body += this.body;
    this.body = '';
    let layer = this.layer(name);
    if (!layer) {
      layer = this.add({ name, attrs, always, body: '', inner: null, within: within !== undefined });
      if (within !== undefined) {
        const outer = this.layer(within)!;
        (outer.inner ??= []).push(layer);
      }
    }
    this.current = layer;
  }

  private layer(name: string): Layer | undefined {
    const layers = this.layers;
    for (let i = 0; i < layers.length; i++) if (layers[i].name === name) return layers[i];
    return undefined;
  }

  private add(layer: Layer): Layer {
    this.layers.push(layer);
    return layer;
  }

  frame(x: number, y: number): void {
    if (this.framed) {
      this.framed.x = x;
      this.framed.y = y;
    } else this.framed = { x, y, from: this.layers.length };
  }

  into(name: string, attrs: string, draw: () => void): void {
    const back = this.current.name;
    this.section(name, attrs);
    draw();
    this.section(back);
  }

  group(g: Group): void {
    this.body +=
      (g.cls === undefined ? '<g' : '<g class="' + g.cls + '"') +
      (g.before ?? '') +
      (g.id === undefined ? '' : ' data-id="' + escText(g.id) + '"') +
      (g.source === undefined || !this.sources ? '' : sourceAttrs(g.source)) +
      (g.attrs ?? '') +
      (g.x === undefined ? '>' : ' transform="translate(' + num(g.x) + ',' + num(g.y ?? 0) + ')">');
    this.open.push('</g>');
  }


  shift(x: number, y: number): void {
    this.group({ x, y });
  }

  link(attrs: string): void {
    this.body += `<a${attrs}>`;
    this.open.push('</a>');
  }

  end(): void {
    this.body += this.open.pop() ?? '';
  }

  tooltip(text: string): void {
    this.body += `<title>${escText(text)}</title>`;
  }

  fragment(svg: string): void {
    this.body += svg;
  }

  // ` class="…" data-id="…"` and the source, for a shape that is a part.
  private head(item: Item | undefined): string {
    if (item === undefined) return '';
    let s = item.cls === undefined ? '' : ' class="' + item.cls + '"';
    if (item.id !== undefined) s += ' data-id="' + escText(item.id) + '"';
    if (item.source !== undefined && this.sources) s += sourceAttrs(item.source);
    return s;
  }

  // Hot paths: one `+` chain per element is faster than a template here, and most shapes are not
  // parts, so they skip head().
  rect(x: number | null, y: number | null, w: number, h: number, attrs: Attrs, item?: Item): void {
    this.body +=
      (item === undefined ? '<rect' : '<rect' + this.head(item)) +
      (x === null ? '' : ' x="' + num(x) + '"') + (y === null ? '' : ' y="' + num(y) + '"') +
      ' width="' + num(w) + '" height="' + num(h) + '"' + (typeof attrs === 'string' ? attrs : attrs.attrs) + '/>';
  }

  circle(cx: number | null, cy: number | null, r: number, attrs: Attrs, item?: Item): void {
    this.body +=
      (item === undefined ? '<circle' : '<circle' + this.head(item)) +
      (cx === null ? '' : ' cx="' + num(cx) + '"') + (cy === null ? '' : ' cy="' + num(cy) + '"') +
      ' r="' + num(r) + '"' + (typeof attrs === 'string' ? attrs : attrs.attrs) + '/>';
  }

  ellipse(cx: number | null, cy: number | null, rx: number, ry: number, attrs: Attrs, item?: Item): void {
    this.body +=
      (item === undefined ? '<ellipse' : '<ellipse' + this.head(item)) +
      (cx === null ? '' : ' cx="' + num(cx) + '"') + (cy === null ? '' : ' cy="' + num(cy) + '"') +
      ' rx="' + num(rx) + '" ry="' + num(ry) + '"' + (typeof attrs === 'string' ? attrs : attrs.attrs) + '/>';
  }

  line(x1: number, y1: number, x2: number, y2: number, attrs: Attrs, item?: Item): void {
    this.body +=
      (item === undefined ? '<line x1="' : '<line' + this.head(item) + ' x1="') +
      num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '"' + (typeof attrs === 'string' ? attrs : attrs.attrs) + '/>';
  }

  polygon(points: number[], attrs: Attrs, item?: Item): void {
    let p = '';
    for (let i = 0; i + 1 < points.length; i += 2) p += (i ? ' ' : '') + num(points[i]) + ',' + num(points[i + 1]);
    this.body += (item === undefined ? '<polygon points="' : '<polygon' + this.head(item) + ' points="') + p + '"' + (typeof attrs === 'string' ? attrs : attrs.attrs) + '/>';
  }

  text(x: number, y: number, s: string, attrs: Attrs, after = ''): void {
    this.body += '<text' + (typeof attrs === 'string' ? attrs : attrs.attrs) + ' x="' + num(x) + '" y="' + num(y) + '"' + after + '>' + esc(s) + '</text>';
  }

  spans(x: number, y: number, runs: Run[], attrs: Attrs, after = ''): void {
    let body = '';
    for (const r of runs) body += r.attrs === undefined ? esc(r.text) : '<tspan' + r.attrs + '>' + esc(r.text) + '</tspan>';
    this.body += '<text' + (typeof attrs === 'string' ? attrs : attrs.attrs) + ' x="' + num(x) + '" y="' + num(y) + '"' + after + '>' + body + '</text>';
  }

  opaque(svg: string): void {
    this.body += svg;
  }

  both(svg: () => string): void {
    this.body += svg();
  }

  pen(): Pen {
    return new SvgPen();
  }

  path(d: string | Pen, attrs: Attrs, _tokens?: number[], item?: Item): void {
    this.body +=
      (item === undefined ? '<path d="' : '<path' + this.head(item) + ' d="') + (typeof d === 'string' ? d : (d as SvgPen).d) + '"' + (typeof attrs === 'string' ? attrs : attrs.attrs) + '/>';
  }

  at(x: number, y: number, draw: (x: number, y: number) => string): void {
    this.body += draw(x, y);
  }

  label(label: Label, cx: number, cy: number, attrs: Attrs, icons?: IconResolver): void {
    this.body += labelSvg(label, cx, cy, text(attrs), icons);
  }

  raw(svg: string): void {
    this.body += svg;
  }

  done(type: string, width: number, height: number, fontSize: number, options: RenderOptions, acc: Accessible): string {
    this.current.body += this.body;
    this.body = '';
    let content = '';
    const framed = this.framed;
    const layers = this.layers;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (framed && i === framed.from) content += `<g transform="translate(${num(framed.x)},${num(framed.y)})">`;
      if (layer.within) continue;
      let body = layer.body;
      if (layer.inner) for (const inner of layer.inner) body += inner.body;
      if (body !== '' || layer.always) content += layer.attrs ? `<g${layer.attrs}>${body}</g>` : body;
    }
    if (framed) content += framed.from === layers.length ? `<g transform="translate(${num(framed.x)},${num(framed.y)})"></g>` : '</g>';
    this.svg = svgDocument(type, width, height, fontSize, options, acc, content);
    return this.svg;
  }
}
