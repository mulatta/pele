// Writes a drawing as SVG text, each layer in a buffer of its own until the document is put
// together.
import { escText, labelSvg, num, sourceAttrsFor } from '../svg/builder.js';
import { svgDocument, type Accessible } from '../svg/root.js';
import type { Label } from '../text/label.js';
import type { IconResolver, RenderOptions, SourceInfo } from '../types.js';
import type { Group, Out } from './out.js';

interface Layer {
  name: string;
  attrs: string;
  always: boolean;
  body: string;
}

export class SvgOut implements Out {
  svg = '';
  // What is written to the current layer since it was switched to; kept out of the layer object,
  // where every write would be one more lookup.
  private body = '';
  private current: Layer = { name: 'main', attrs: '', always: false, body: '' };
  private layers: Layer[] = [this.current];
  private open: string[] = [];

  constructor(
    private readonly options: RenderOptions,
    private readonly source: (info: SourceInfo | undefined) => string = sourceAttrsFor(options)
  ) {}

  fork(): SvgOut {
    return new SvgOut(this.options, this.source);
  }

  adopt(attempt: Out): void {
    this.svg = (attempt as SvgOut).svg;
  }

  section(name: string, attrs = '', always = false): void {
    if (this.current.name === name) return;
    this.current.body += this.body;
    this.body = '';
    this.current = this.layer(name) ?? this.add({ name, attrs, always, body: '' });
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

  into(name: string, attrs: string, draw: () => void): void {
    const back = this.current.name;
    this.section(name, attrs);
    draw();
    this.section(back);
  }

  group(g: Group): void {
    this.body +=
      '<g' +
      (g.cls !== undefined ? ` class="${g.cls}"` : '') +
      (g.id !== undefined ? ` data-id="${escText(g.id)}"` : '') +
      this.source(g.source) +
      (g.attrs ?? '') +
      (g.x !== undefined ? ` transform="translate(${num(g.x)},${num(g.y ?? 0)})"` : '') +
      '>';
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
    for (const layer of this.layers) {
      if (layer.body !== '' || layer.always) content += layer.attrs ? `<g${layer.attrs}>${layer.body}</g>` : layer.body;
    }
    this.svg = svgDocument(type, width, height, fontSize, options, acc, content);
    return this.svg;
  }
}
