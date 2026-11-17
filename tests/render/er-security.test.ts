import { describe, expect, it } from 'vitest';
import type { RenderOptions } from '../../src/index.js';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS } from '../support/payloads.js';
import { assertSafe, draw, itemById, textOf, tryDraw } from '../support/scene.js';

function check(src: string, extra: RenderOptions = {}): boolean {
  const result = tryDraw(src, extra);
  if (result === undefined) return false;
  assertSafe(result, JSON.stringify(src).slice(0, 160));
  return true;
}

const TEMPLATES: ((p: string) => string)[] = [
  (p) => `erDiagram\n  ${p}`,
  (p) => `erDiagram\n  "${p}"`,
  (p) => `erDiagram\n  "${p}" ||--o{ B : has`,
  (p) => `erDiagram\n  A ||--o{ "${p}" : has`,
  (p) => `erDiagram\n  A ||--o{ B : ${p}`,
  (p) => `erDiagram\n  A ||--o{ B : "${p}"`,
  (p) => `erDiagram\n  A ||--o{ A : "${p}"`,
  (p) => `erDiagram\n  A ${p} B : has`,
  (p) => `erDiagram\n  A[${p}]`,
  (p) => `erDiagram\n  A["${p}"] {\n    string name\n  }`,
  (p) => `erDiagram\n  A {\n    ${p} name\n  }`,
  (p) => `erDiagram\n  A {\n    string ${p}\n  }`,
  (p) => `erDiagram\n  A {\n    \`${p}\` \`${p}\`\n  }`,
  (p) => `erDiagram\n  A {\n    ${p}~${p}~ ~${p}~ PK "c"\n  }`,
  (p) => `erDiagram\n  A {\n    string name PK "${p}"\n  }`,
  (p) => `erDiagram\n  A {\n    string name ${p}\n  }`,
  (p) => `erDiagram\n  A {\n    string name PK, ${p}\n  }`,
  (p) => `erDiagram\n  A:::${p}`,
  (p) => `erDiagram\n  A:::${p} ||--o{ B:::${p} : has`,
  (p) => `erDiagram\n  A\n  class A ${p}`,
  (p) => `erDiagram\n  A\n  class ${p} x`,
  (p) => `erDiagram\n  A\n  classDef ${p} fill:red\n  class A ${p}`,
  (p) => `erDiagram\n  A\n  classDef c fill:${p}\n  class A c`,
  (p) => `erDiagram\n  A\n  classDef c ${p}:red\n  class A c`,
  (p) => `erDiagram\n  A\n  classDef default fill:${p},color:${p},stroke:${p}\n`,
  (p) => `erDiagram\n  A\n  style A fill:${p}\n`,
  (p) => `erDiagram\n  A { int id }\n  style A ${p}:red\n`,
  (p) => `erDiagram\n  A { int id }\n  style A color:${p},stroke:${p},font-family:${p},font-size:${p}\n`,
  (p) => `erDiagram\n  A\n  style ${p} fill:red\n`,
  (p) => `erDiagram\n  subgraph ${p}\n  A\n  end`,
  (p) => `erDiagram\n  subgraph "${p}"\n  A\n  end`,
  (p) => `erDiagram\n  subgraph s [${p}]\n  A\n  end`,
  (p) => `erDiagram\n  subgraph s ["${p}"]\n  A\n  end\n  s ||--|| B : "${p}"`,
  (p) => `erDiagram\n  subgraph s\n  A\n  end\n  style s fill:${p}\n  class s ${p}`,
  (p) => `erDiagram\n  A["${p}"]:::internal-link`,
  (p) => `erDiagram\n  "${p}":::internal-link`,
  (p) => `erDiagram\n  accTitle: ${p}\n  accDescr: ${p}\n  A`,
  (p) => `erDiagram\n  accDescr {\n ${p}\n }\n  A`,
  (p) => `erDiagram\n  direction ${p}\n  A`,
  (p) => `erDiagram\n  direction TB ${p}\n  A`,
  (p) => `---\ntitle: "${p}"\nconfig:\n  er:\n    nodeSpacing: "${p}"\n    rankSpacing: "${p}"\n---\nerDiagram\n  A ||--|| B : x`,
  (p) => `---\ntitle: ${p}\n---\nerDiagram\n  A`,
  (p) => `%%{init: {"er": {"layoutDirection": "${p}"}, "themeVariables": {"fontFamily": "${p}"}}}%%\nerDiagram\n  A`,
  (p) => `erDiagram ${p}\n  A`,
  (p) => `erDiagram\n  %% ${p}\n  A`,
];

describe('inert ER output', () => {
  it('holds for every corpus input', () => {
    for (const src of loadCorpus('er', /erDiagram/)) check(src);
  });

  it('holds with hostile text in every position', () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        if (check(template(payload))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(450);
  });

  it('shows hostile text as text', () => {
    const { scene } = draw('erDiagram\n  "<img src=x onerror=alert(1)>" {\n    `<script>` `a&b` PK "</text><script>alert(1)</script>"\n  }');
    expect(textOf(scene)).not.toContain('<script');
    expect(textOf(scene)).toContain('a&b');
    expect(itemById(scene, '<img src=x onerror=alert(1)>')).toBeDefined();
  });

  it('holds for hostile option values', () => {
    for (const payload of PAYLOADS) {
      expect(check('erDiagram\n  accTitle: t\n  A ||--o{ B : x\n  A { int id }', { idPrefix: payload, fontFamily: payload })).toBe(true);
    }
  });

  it('holds for mutated inputs', () => {
    const corpus = loadCorpus('er', /erDiagram/);
    const fragments = [...PAYLOADS, '"', '`', '~', '{', '}', '[', ']', '\n', ':::', ' : ', '||--o{', 'style A fill:', 'classDef c ', 'subgraph ', 'end\n'];
    const next = mutator(corpus, fragments, random(3));
    const count = Number(process.env.FUZZ ?? 4000);
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000) check(src);
    }
  }, 600_000);

  it('reports an internal link as written, for the host to look up', () => {
    const { links } = draw('erDiagram\n  "javascript:alert(1)":::internal-link');
    expect(links).toEqual([{ id: 'javascript:alert(1)', href: 'javascript:alert(1)', internal: true }]);
  });

  it('does not pollute prototypes', () => {
    draw('erDiagram\n  __proto__ ||--o{ constructor : toString\n  __proto__ {\n    __proto__ __proto__ PK "__proto__"\n  }');
    draw('erDiagram\n  A\n  classDef __proto__ fill:red\n  class A __proto__\n  class __proto__ constructor\n  style __proto__ fill:red\n');
    draw('erDiagram\n  subgraph __proto__ [constructor]\n  hasOwnProperty\n  end\n  __proto__ ||--|| prototype : x');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
