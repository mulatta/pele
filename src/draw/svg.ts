// Writes a drawing as SVG text, each layer in a buffer of its own until the document is put
// together.
import { escText, labelSvg, num, sourceAttrsFor } from '../svg/builder.js';
import { svgDocument, type Accessible } from '../svg/root.js';
import type { Label } from '../text/label.js';
import type { IconResolver, RenderOptions, SourceInfo } from '../types.js';
import type { Group, Out } from './out.js';

interface Layer {
  attrs: string;
  always: boolean;
  body: string;
}

export class SvgOut implements Out {
  svg = '';
  private layers = new Map<string, Layer>();
  private current!: Layer;
  private open: string[] = [];
  private readonly source: (info: SourceInfo | undefined) => string;

  constructor(private readonly options: RenderOptions) {
    this.source = sourceAttrsFor(options);
    this.section('main');
  }

  fork(): SvgOut {
    return new SvgOut(this.options);
  }

  adopt(attempt: Out): void {
    this.svg = (attempt as SvgOut).svg;
  }

  section(name: string, attrs = '', always = false): void {
    let layer = this.layers.get(name);
    if (!layer) {
      layer = { attrs, always, body: '' };
      this.layers.set(name, layer);
    }
    this.current = layer;
  }

  into(name: string, attrs: string, draw: () => void): void {
    const back = this.current;
    this.section(name, attrs);
    draw();
    this.current = back;
  }

  group(g: Group): void {
    this.current.body +=
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
    this.current.body += `<a${attrs}>`;
    this.open.push('</a>');
  }

  end(): void {
    this.current.body += this.open.pop() ?? '';
  }

  tooltip(text: string): void {
    this.current.body += `<title>${escText(text)}</title>`;
  }

  fragment(svg: string): void {
    this.current.body += svg;
  }

  path(d: string, attrs: string): void {
    this.current.body += `<path d="${d}"${attrs}/>`;
  }

  label(label: Label, cx: number, cy: number, attrs: string, icons?: IconResolver): void {
    this.current.body += labelSvg(label, cx, cy, attrs, icons);
  }

  raw(svg: string): void {
    this.current.body += svg;
  }

  done(type: string, width: number, height: number, fontSize: number, options: RenderOptions, acc: Accessible, order: string[]): string {
    let content = '';
    const names = [...order.filter((n) => this.layers.has(n)), ...[...this.layers.keys()].filter((n) => !order.includes(n))];
    for (const name of names) {
      const layer = this.layers.get(name)!;
      if (layer.body === '' && !layer.always) continue;
      content += layer.attrs ? `<g${layer.attrs}>${layer.body}</g>` : layer.body;
    }
    this.svg = svgDocument(type, width, height, fontSize, options, acc, content);
    return this.svg;
  }
}
