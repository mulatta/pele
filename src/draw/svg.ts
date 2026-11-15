// Writes a drawing as SVG text, each layer in a buffer of its own until the document is put
// together.
import { esc, escText, labelSvg, num, sourceAttrs } from '../svg/builder.js';
import { svgDocument, type Accessible } from '../svg/root.js';
import type { Label } from '../text/label.js';
import type { IconResolver, RenderOptions } from '../types.js';
import type { Attrs, Group, Item, Out, Pen } from './out.js';

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
    let tag = g.cls === undefined ? '<g' : '<g class="' + g.cls + '"';
    if (g.before !== undefined) tag += g.before;
    if (g.id !== undefined) tag += ' data-id="' + escText(g.id) + '"';
    if (g.source !== undefined && this.sources) tag += sourceAttrs(g.source);
    if (g.attrs !== undefined) tag += g.attrs;
    if (g.x !== undefined) tag += ' transform="translate(' + num(g.x) + ',' + num(g.y ?? 0) + ')"';
    this.body += tag + '>';
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

  rect(x: number, y: number, w: number, h: number, attrs: Attrs, item?: Item): void {
    this.body += `<rect${this.head(item)} x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${text(attrs)}/>`;
  }

  circle(cx: number, cy: number, r: number, attrs: Attrs, item?: Item): void {
    this.body += `<circle${this.head(item)} cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"${text(attrs)}/>`;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, attrs: Attrs, item?: Item): void {
    this.body += `<ellipse${this.head(item)} cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}"${text(attrs)}/>`;
  }

  line(x1: number, y1: number, x2: number, y2: number, attrs: Attrs, item?: Item): void {
    this.body += `<line${this.head(item)} x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"${text(attrs)}/>`;
  }

  polygon(points: number[], attrs: Attrs, item?: Item): void {
    let p = '';
    for (let i = 0; i + 1 < points.length; i += 2) p += (i ? ' ' : '') + num(points[i]) + ',' + num(points[i + 1]);
    this.body += `<polygon${this.head(item)} points="${p}"${text(attrs)}/>`;
  }

  text(x: number, y: number, s: string, attrs: Attrs, after = ''): void {
    this.body += `<text${text(attrs)} x="${num(x)}" y="${num(y)}"${after}>${esc(s)}</text>`;
  }

  pen(): Pen {
    return new SvgPen();
  }

  path(d: string | Pen, attrs: Attrs, _tokens?: number[], item?: Item): void {
    this.body += `<path${this.head(item)} d="${typeof d === 'string' ? d : (d as SvgPen).d}"${text(attrs)}/>`;
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
