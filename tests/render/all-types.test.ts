import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, renderScene, type RenderOptions, type SceneResult } from '../../src/index.js';
import { all } from '../../src/diagrams/registry.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, lineOf, lines, options, textOf } from '../support/scene.js';

// A gantt chart marks the present, so the time is given: two drawings a moment apart could differ.
const NOW = Date.UTC(2026, 0, 15, 12);

const drawAt = (source: string | ReturnType<typeof parse>, extra: RenderOptions = {}): SceneResult => renderScene(source, { ...options, now: NOW, ...extra });

const corpora = readdirSync('tests/corpus')
  .filter((file) => file.endsWith('-docs.json'))
  .sort()
  .map((file) => ({ name: file.replace('-docs.json', ''), sources: JSON.parse(readFileSync(`tests/corpus/${file}`, 'utf8')) as string[] }));

// What a scene shows, without where in the source each part was written, which a model from parse() no longer knows.
const shown = (result: SceneResult): unknown => ({ ...result.scene, items: result.scene.items.map(({ id, kind, role, box }) => ({ id, kind, role, box })) });

const where = (name: string, src: string): string => `${name}: ${JSON.stringify(src).slice(0, 120)}`;

describe('every diagram type', () => {
  it.each(['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'])(
    'renders other diagram types with %s in their labels',
    (keyword) => {
      const sources = [
        ['flowchart', `flowchart LR\n  a[Web app] --> b[${keyword} view]`],
        ['sequence', `sequenceDiagram\n  Alice->>Bob: ${keyword} view`],
      ];
      for (const [type, source] of sources) {
        const result = drawAt(source);
        expect(detectType(source)).toBe(type);
        expect(result.type).toBe(type);
        expect(textOf(result.scene)).toContain(keyword);
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
      }
    }
  );

  it('has documentation examples', () => {
    const drawn = new Set<string>();
    for (const { sources } of corpora) for (const src of sources) drawn.add(drawAt(src).type);
    expect([...drawn].sort()).toEqual(all.map((d) => d.type).sort());
  });

  it("draws all of Mermaid's documentation examples", { timeout: 120000 }, () => {
    let count = 0;
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const at = where(name, src);
        const result = drawAt(src);
        const { width, height } = result;
        assertSafe(result, at);
        expect(textOf(result.scene), at).not.toMatch(/NaN|Infinity|undefined/);
        expect(Number.isInteger(width) && Number.isInteger(height) && width >= 0 && height >= 0, at).toBe(true);
        expect(drawAt(src).scene, at).toEqual(result.scene);
        count++;
      }
    }
    expect(count).toBeGreaterThan(500);
  });

  it('draws a model that parse() returned as it draws the text, however often and at any width', { timeout: 120000 }, () => {
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const at = where(name, src);
        const model = parse(src);
        for (const maxWidth of [undefined, 320, 500, undefined]) {
          expect(shown(drawAt(model, { maxWidth })), at).toEqual(shown(drawAt(src, { maxWidth })));
        }
      }
    }
  });

  it('reads the limits and the configuration when the text is parsed', () => {
    const src = 'flowchart LR\n  A --> B --> C';
    expect(() => parse(src, { maxEdges: 1 })).toThrow(PeleError);
    expect(() => parse(src, { limit: 5 })).toThrow(PeleError);
    expect(drawAt(parse(src), { maxEdges: 1, limit: 5 }).type).toBe('flowchart');
    const config = { flowchart: { rankSpacing: 200 } };
    expect(shown(drawAt(parse(src, { config })))).toEqual(shown(drawAt(src, { config })));
    expect(shown(drawAt(parse(src, { config })))).not.toEqual(shown(drawAt(src)));
  });

  it('refuses a model that parse() did not return', () => {
    expect(() => drawAt({ ...parse('flowchart LR\n  A --> B') })).toThrow(TypeError);
  });

  it('draws a title given in front matter', () => {
    // Types whose documentation examples all carry a title of their own.
    const plain: Record<string, string> = {
      c4: 'C4Context\n  Person(a, "A")',
      cynefin: 'cynefin-beta\n  complex\n    "x"',
      journey: 'journey\n  section S\n    Task: 5: Me',
      packet: 'packet\n  0-15: "Source"',
      pie: 'pie\n  "a": 1\n  "b": 2',
      quadrant: 'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]',
      radar: 'radar-beta\n  axis a, b, c\n  curve x{1,2,3}',
      timeline: 'timeline\n  2001 : a',
      wardley: 'wardley-beta\n  component A [0.5, 0.5]',
      xychart: 'xychart\n  x-axis [a, b]\n  bar [1, 2]',
    };
    const drawn = new Set<string>();
    for (const { name, sources } of corpora) {
      const src = plain[name] ?? sources.find((s) => !s.startsWith('---') && !/^\s*title\b/m.test(s));
      expect(src, name).toBeDefined();
      const result = drawAt(`---\ntitle: Zebra crossing\n---\n${src}`);
      expect(lines(result.scene), name).toContain('Zebra crossing');
      assertSafe(result, name);
      drawn.add(result.type);
    }
    expect(drawn.size).toBe(all.length);
  });

  it('only names gradients with the prefix, so two diagrams on a page do not clash', () => {
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const { scene } = drawAt(src, { idPrefix: 'one' });
        for (const id of Object.keys(scene.gradients ?? {})) expect(id.startsWith('one'), `${where(name, src)}: gradient ${id}`).toBe(true);
      }
    }
  });

  it('reads entity codes in a link before checking it, so they cannot hide a scheme', () => {
    const links: [string, string][] = [
      ['flowchart', 'flowchart LR\n  A --> B\n  click A "URL"'],
      ['flowchart image', 'flowchart LR\n  A@{ img: "URL" }'],
      ['agentflow', 'agentflow-beta\n  A --> B\n  click A "URL"'],
      ['class', 'classDiagram\n  class A\n  click A href "URL"'],
      ['state', 'stateDiagram-v2\n  A --> B\n  click A href "URL"'],
      ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  Task :a, 2024-01-01, 1d\n  click a href "URL"'],
      ['c4', 'C4Context\n  Person(a, "A", $link="URL")'],
    ];
    for (const [name, template] of links) {
      for (const hidden of ['#106;avascript:alert(1)', '&#106;avascript:alert(1)', 'java#9;script:alert(1)', '#32;javascript:alert(1)']) {
        const result = drawAt(template.replace('URL', hidden));
        for (const link of result.links) if (!link.internal) expect(link.href.replace(/#.*$/s, ''), `${name}: ${hidden}`).not.toMatch(/script/i);
        expect(result.scene.skipped.image, `${name}: ${hidden}`).toBeUndefined();
        assertSafe(result, `${name}: ${hidden}`);
      }
      // C4 keeps the text of a link as written, so a code stays a harmless part of the address.
      const decoded = drawAt(template.replace('URL', 'https://example.com/a#35;b'));
      if (name.endsWith('image')) expect(decoded.scene.skipped.image, name).toBe(1);
      else expect(decoded.links.map((link) => link.href), name).toEqual([name === 'c4' ? 'https://example.com/a#35;b' : 'https://example.com/a#b']);
    }
  });

  const LINKS: [string, string][] = [
    ['flowchart', 'flowchart LR\n  A --> B\n  click A "URL"'],
    ['flowchart image', 'flowchart LR\n  A@{ img: "URL" }'],
    ['flowchart note', 'flowchart LR\n  A["URL"]:::internal-link'],
    ['agentflow', 'agentflow-beta\n  A --> B\n  click A "URL"'],
    ['agentflow note', 'agentflow-beta\n  A["URL"]:::internal-link --> B'],
    ['class', 'classDiagram\n  class A\n  click A href "URL"'],
    ['state', 'stateDiagram-v2\n  A --> B\n  click A href "URL"'],
    ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  Task :a, 2024-01-01, 1d\n  click a href "URL"'],
    ['kanban', "---\nconfig:\n  kanban:\n    ticketBaseUrl: 'URL'\n---\nkanban\n  todo\n    a[Card]@{ ticket: T1 }"],
    ['c4', 'C4Context\n  Person(a, "A", $link="URL")'],
    ['er', 'erDiagram\n  A["URL"]:::internal-link'],
  ];
  // What a host could follow or load: the links, and an image, which a scene leaves to its host
  // and only counts. An internal link is a name for the host to resolve, not an address.
  const hrefs = (result: SceneResult, name: string, url: string, internal = true): string[] => {
    const followed = result.links.filter((link) => internal || !link.internal).map((link) => link.href);
    return name.endsWith('image') && result.scene.skipped.image ? [...followed, url] : followed;
  };
  const named = (name: string): boolean => name.endsWith('note') || name === 'er';

  it('only follows web, mail and phone links, and only loads web images', () => {
    const blocked = [
      'file:///etc/passwd',
      'FILE:///etc/passwd',
      'fi%6ce:///etc/passwd',
      'file#58;///etc/passwd',
      '//evil.example/share',
      '%2F%2Fevil.example/share',
      '\\\\\\\\evil.example\\\\share',
      'smb://evil.example/share',
      'obsidian://open?vault=x',
      'ms-msdt:/id',
      'vscode://x/y',
      'intent://x',
      'ftp://example.com/x',
      'blob:https://example.com/x',
    ];
    for (const [name, template] of LINKS) {
      for (const url of blocked) {
        // An ER name cannot hold a percent sign or a backslash.
        if (name === 'er' && /[%\\]/.test(url)) continue;
        const result = drawAt(template.replace('URL', () => url));
        // Kanban and C4 do not read entity codes in an address, which leaves a relative one.
        const left = name === 'kanban' || name === 'c4' ? /^file#58;.*$/ : /^$/;
        for (const href of hrefs(result, name, url, false)) expect(href, `${name}: ${url}`).toMatch(left);
        assertSafe(result, `${name}: ${url}`);
      }
      const allowed = named(name) ? ['Note name', 'folder/Note#Heading'] : ['https://example.com/a', 'http://example.com/a', './a/b.html', '/a/b', 'a.html'];
      if (name === 'flowchart' || name === 'class') allowed.push('mailto:a@example.com', 'tel:+15550100');
      for (const url of allowed) {
        expect(hrefs(drawAt(template.replace('URL', () => url)), name, url), `${name}: ${url}`).toEqual([url]);
      }
    }
  });

  it('lets the host allow more schemes', () => {
    for (const [name, template] of LINKS) {
      if (named(name)) continue;
      const image = name.endsWith('image');
      const url = 'obsidian://open?vault=x';
      const src = template.replace('URL', () => url);
      expect(hrefs(drawAt(src, { [image ? 'imageSchemes' : 'linkSchemes']: ['obsidian'] }), name, url), name).toEqual([url]);
      expect(hrefs(drawAt(src, { [image ? 'linkSchemes' : 'imageSchemes']: ['obsidian'] }), name, url), name).not.toContain(url);
      // Naming the schemes replaces the defaults.
      const web = template.replace('URL', 'https://example.com/a');
      expect(hrefs(drawAt(web, { linkSchemes: [], imageSchemes: [] }), name, 'https://example.com/a'), name).not.toContain('https://example.com/a');
    }
    for (const scheme of ['javascript', 'data', 'vbscript']) {
      const { links } = drawAt(`flowchart LR\n  A --> B\n  click A "${scheme}:alert(1)"`, { linkSchemes: [scheme] });
      expect(links, scheme).toEqual([]);
    }
  });

  it('draws no link and no image for a host that wants none, whatever the address', () => {
    for (const [name, template] of LINKS) {
      for (const url of ['https://example.com/a', './a/b.html', 'a.png', 'Note name']) {
        const src = template.replace('URL', url);
        const drawn = drawAt(src);
        const none = drawAt(src, { links: false, images: false });
        expect(none.links, `${name}: ${url}`).toEqual([]);
        expect(none.scene.skipped.image, `${name}: ${url}`).toBeUndefined();
        const linksOff = drawAt(src, { links: false });
        expect([linksOff.width, linksOff.height], `${name}: ${url}`).toEqual([drawn.width, drawn.height]);
      }
    }
  });

  it('stops at the output limit', () => {
    const src = 'flowchart LR\n' + Array.from({ length: 200 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n');
    expect(() => drawAt(src)).not.toThrow();
    let error: unknown;
    try {
      drawAt(src, { outputLimit: 1000 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PeleError);
    expect(error).toMatchObject({ code: 'limit', type: 'flowchart' });
    expect(() => drawAt('mindmap\nroot\n' + ' a\n'.repeat(200), { outputLimit: 1000 })).toThrow(/output is larger than the limit/);
  });

  it('turns entity codes into characters wherever text is read as text', { timeout: 300000 }, () => {
    const placeholder = /\ufb02\u00b0|\u00b6\u00df/;
    let rendered = 0;
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const variants = [
          src.replace(/"([^"\n]*)"/g, (_, t: string) => `"${t}#35;"`),
          src.replace(/\[([^\]\n[]*)\]/g, (_, t: string) => `[${t}#35;]`),
          src.replace(/(: *)([^\n:]+)$/gm, (_, a: string, t: string) => `${a}${t}#35;`),
          src.replace(/^(\s*)([A-Za-z][\w ]*)$/gm, (_, a: string, t: string) => `${a}${t}#35;`),
          src.replace(/\b([A-Za-z]\w+)\b(?=\s*(-->|--|->|:|\(|\[|\{))/g, (_, t: string) => `${t}#35;`),
        ];
        for (const variant of variants) {
          if (variant === src) continue;
          let result: SceneResult;
          try {
            result = drawAt(variant);
          } catch (error) {
            if (error instanceof PeleError) continue;
            throw error;
          }
          rendered++;
          const at = where(name, variant);
          // A value that is checked before it is written (a colour, an address) may keep a code as it is.
          const text = result.scene.texts.map(lineOf).find((line) => placeholder.test(line));
          if (text !== undefined) expect.fail(`${at}: text ${text.slice(0, 60)}`);
          const item = result.scene.items.find((i) => placeholder.test(i.id) || placeholder.test(i.kind));
          if (item !== undefined) expect.fail(`${at}: item ${item.id.slice(0, 60)}`);
          for (const link of result.links) expect(link.id, at).not.toMatch(placeholder);
          assertSafe(result, at);
        }
      }
    }
    expect(rendered).toBeGreaterThan(600);
  });

  it('shows an entity code the same way in a label and an id', () => {
    const flow = drawAt('flowchart LR\n  A["Issue #35; fixed"]');
    expect(lines(flow.scene)).toContain('Issue # fixed');
    const pie = drawAt('pie\n  "Issue #35;": 1\n  "A #amp; B": 2');
    expect(pie.scene.items.map((i) => i.id)).toContain('Issue #');
    expect(pie.scene.items.map((i) => i.id)).toContain('A & B');
    const quoted = drawAt('pie\n  "#34; onload=#34;alert(1)": 1');
    expect(quoted.scene.items.map((i) => i.id)).toContain('" onload="alert(1)');
    assertSafe(quoted, 'quoted id');
  });

  it('leaves room for an icon only when the host has it', () => {
    const cases: [string, string, string][] = [
      ['flowchart', 'flowchart LR\n  A[fa:fa-car Car] --> B[Stop fa:fa-ban]', 'flowchart LR\n  A[Car] --> B[Stop]'],
      ['mindmap', 'mindmap\n  root\n    Read\n    ::icon(fa fa-book)\n    Write', 'mindmap\n  root\n    Read\n    Write'],
      ['kanban', 'kanban\n  todo[Todo]\n    a[Call]@{ icon: phone }', 'kanban\n  todo[Todo]\n    a[Call]'],
    ];
    for (const [name, withIcon, without] of cases) {
      const plain = drawAt(withIcon);
      expect(shown(plain), name).toEqual(shown(drawAt(without)));
      expect(drawAt(withIcon, { icons: () => null }).scene, name).toEqual(plain.scene);
      expect(drawAt(withIcon, { icons: () => '' }).scene, name).toEqual(plain.scene);
      const drawn = drawAt(withIcon, { icons: () => '<path d="M1,1H9"/>' });
      expect(drawn.scene.shapes.length, name).toBeGreaterThan(plain.scene.shapes.length);
      expect(drawn.width, name).toBeGreaterThanOrEqual(plain.width);
      assertSafe(drawn, name);
    }
  });

  it('gives the icon resolver and the returned links the names as written', () => {
    const asked: string[] = [];
    const icons = (icon: string): string => {
      asked.push(icon);
      return '';
    };
    const { links } = drawAt('flowchart LR\n  A@{ icon: "fa:user#35;", label: "x" }\n  B --> A\n  click A "https://example.com"', { icons });
    expect(asked).toContain('fa:user#');
    expect(links.map((link) => link.id)).toEqual(['A']);
  });

  it('survives hostile values for every config key a renderer reads', { timeout: 300000 }, () => {
    const values: unknown[] = [1e308, -1e308, 1e9, -1, 0, 0.5, NaN, Infinity, '"><script>alert(1)</script>', 'url(javascript:alert(1))', true, null, [], { a: 1 }, '__proto__'];
    const literals = (dir: string): string[] => {
      const found: string[] = [];
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.ts')) continue;
        for (const m of readFileSync(`${dir}/${file}`, 'utf8').matchAll(/'([a-z][A-Za-z]{2,30})'/g)) found.push(m[1]);
      }
      return found;
    };
    const folders = readdirSync('src/diagrams').filter((f) => f !== 'common' && !f.endsWith('.ts'));
    for (const { name, sources } of corpora) {
      const type = drawAt(sources[0]).type;
      const diagram = all.find((d) => d.type === type)!;
      const folder = folders.find((f) => readFileSync(`src/diagrams/${f}/index.ts`, 'utf8').includes(`type: '${type}'`))!;
      const keys = new Set([...literals(`src/diagrams/${folder}`), ...literals('src/diagrams/flowchart')]);
      for (const value of values) {
        const section = Object.fromEntries([...keys].map((key) => [key, value]));
        const config = { ...section, [diagram.section ?? type]: section, flowchart: section, themeVariables: section };
        for (const src of sources.slice(0, 2)) {
          const at = `${where(name, src)} with ${JSON.stringify(value)}`;
          let result: SceneResult;
          const started = performance.now();
          try {
            result = drawAt(src, { config: config as never });
            expect(Number.isFinite(result.width) && Number.isFinite(result.height), at).toBe(true);
          } catch (error) {
            expect(error, at).toBeInstanceOf(PeleError);
            continue;
          }
          expect(performance.now() - started, at).toBeLessThan(3000);
          expect(textOf(result.scene), at).not.toMatch(/NaN|Infinity|undefined/);
          assertSafe(result, at);
        }
      }
    }
  });

  it('treats names that are object keys as ordinary names', { timeout: 300000 }, () => {
    let rendered = 0;
    for (const { name, sources } of corpora) {
      for (const src of sources.slice(0, 6)) {
        const body = src.slice(src.indexOf('\n') + 1);
        const counts = new Map<string, number>();
        for (const m of body.matchAll(/\b[A-Za-z][A-Za-z0-9]{0,20}\b/g)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
        const words = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [word] of words) {
          for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
            const variant = src.replace(new RegExp(`\\b${word}\\b`, 'g'), key);
            let result: SceneResult;
            try {
              result = drawAt(variant);
            } catch (error) {
              if (error instanceof PeleError) continue;
              throw new Error(`${where(name, variant)}: ${(error as Error).name}: ${(error as Error).message}`);
            }
            assertSafe(result, where(name, variant));
            expect(textOf(result.scene), where(name, variant)).not.toMatch(/NaN|Infinity|undefined|\[object |function /);
            rendered++;
          }
        }
      }
    }
    expect(rendered).toBeGreaterThan(500);
  });

  it('stays inert with hostile text in place of every quoted string and bracketed label', { timeout: 600000 }, () => {
    let rendered = 0;
    const payloads = PAYLOADS.filter((_, index) => index % 3 === 0);
    for (const { name, sources } of corpora) {
      for (const src of sources.slice(0, 12)) {
        for (const payload of payloads) {
          const variants = [
            src.replace(/"[^"\n]*"/g, () => `"${payload}"`),
            src.replace(/\[[^\]\n[]*\]/g, () => `[${payload}]`),
            src.replace(/: *[^\n:]+$/gm, () => `: ${payload}`),
          ];
          for (const variant of variants) {
            if (variant === src) continue;
            let result: SceneResult;
            try {
              result = drawAt(variant);
            } catch (error) {
              if (error instanceof PeleError) continue;
              throw new Error(`${where(name, variant)}: ${(error as Error).name}: ${(error as Error).message}`);
            }
            assertSafe(result, where(name, variant));
            expect(textOf(result.scene), where(name, variant)).not.toMatch(/NaN|Infinity/);
            rendered++;
          }
        }
      }
    }
    expect(rendered).toBeGreaterThan(2000);
  });
});
