// Writes a drawing as SVG text, each layer in a buffer of its own until the document is put
// together.
import { esc, escText, labelSvg, num, sourceAttrs } from '../svg/builder.js';
import { svgDocument, type Accessible } from '../svg/root.js';
import type { Label } from '../text/label.js';
import type { IconResolver, RenderOptions } from '../types.js';
import type { Group, Out } from './out.js';

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

  rect(x: number, y: number, w: number, h: number, attrs: string): void {
    this.body += `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${attrs}/>`;
  }

  text(x: number, y: number, text: string, attrs: string, after = ''): void {
    this.body += `<text${attrs} x="${num(x)}" y="${num(y)}"${after}>${esc(text)}</text>`;
  }

  path(d: string, attrs: string): void {
    this.body += `<path d="${d}"${attrs}/>`;
  }

  label(label: Label, cx: number, cy: number, attrs: string, icons?: IconResolver): void {
    this.body += labelSvg(label, cx, cy, attrs, icons);
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
