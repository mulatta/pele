import { describe, expect, it } from 'vitest';
import type { SceneResult } from '../../src/index.js';
import { assertSafe, draw, sceneProblem } from '../support/scene.js';

// The check that the other security tests rely on. If it stopped objecting, they would all pass.
const SOURCE = 'flowchart LR\n  A[One] --> B[Two]\n  click A href "https://example.com/a?b=1#c"\n  style B fill:#eee,stroke-width:2px';

// A fresh scene of the source, changed the way a hostile or broken diagram might leave it.
function changed(change: (result: SceneResult) => void): SceneResult {
  const result = structuredClone(draw(SOURCE));
  change(result);
  return result;
}

const withLink = (href: string, internal = false): SceneResult => changed((r) => (r.links = [{ id: 'A', href, internal }]));

describe('the safety check', () => {
  it('accepts what Pele draws', () => {
    const drawn = draw(SOURCE);
    expect(drawn.links).toHaveLength(1);
    expect(sceneProblem(drawn)).toBeUndefined();
    expect(() => assertSafe(drawn, 'flowchart')).not.toThrow();
    for (const href of ['https://example.com', 'http://example.com/a', 'mailto:a@example.com', 'tel:+15550100', './a/b', '/a', 'a.html', '#top', '?q=1']) {
      expect(sceneProblem(withLink(href)), href).toBeUndefined();
    }
    expect(sceneProblem(withLink('obsidian://open', true))).toBeUndefined();
  });

  it('objects to anything else', () => {
    const bad: [string, SceneResult, RegExp][] = [
      ['scene version', changed((r) => (r.scene.version = 1)), /version 1/],
      ['size that is not a number', changed((r) => (r.width = NaN)), /size is not a number/],
      ['scene origin that is not a number', changed((r) => (r.scene.x = Infinity)), /size is not a number/],
      ['path number that is not a number', changed((r) => (r.scene.shapes[0].cmds[1] = NaN)), /shape number is not a number/],
      ['opacity that is not a number', changed((r) => (r.scene.shapes[0].opacity = NaN)), /shape number is not a number/],
      ['stroke width that is not a number', changed((r) => (r.scene.shapes[0].width = NaN)), /stroke width is not a number/],
      ['shape of an item that is not there', changed((r) => (r.scene.shapes[0].item = r.scene.items.length)), /shape item/],
      ['shape with a gradient that is not there', changed((r) => (r.scene.shapes[0].gradient = 'g')), /gradient g/],
      ['text position that is not a number', changed((r) => (r.scene.texts[0].x = NaN)), /text number is not a number/],
      ['text size that is not a number', changed((r) => (r.scene.texts[0].size = Infinity)), /text number is not a number/],
      ['text of an item that is not there', changed((r) => (r.scene.texts[0].item = -2)), /text item -2/],
      ['item id that is not a string', changed((r) => (r.scene.items[0].id = 1 as unknown as string)), /item id is not a string/],
      ['item box that is not a number', changed((r) => (r.scene.items[0].box = { x0: 0, y0: 0, x1: NaN, y1: 1 })), /item box is not a number/],
      ['script link', withLink('javascript:alert(1)'), /can run script/],
      ['script link in capitals and spaces', withLink(' JaVaScRiPt :alert(1)'), /can run script/],
      ['data link', withLink('data:text/html,x'), /can run script/],
      ['file link', withLink('file:///etc/passwd'), /scheme that is not allowed/],
      ['file link behind a tab', withLink('fi\tle:///etc/passwd'), /scheme that is not allowed/],
      ['network path', withLink('//evil.example/x'), /scheme that is not allowed/],
      ['backslash network path', withLink('\\\\evil.example\\x'), /scheme that is not allowed/],
      ['app link', withLink('obsidian://open'), /scheme that is not allowed/],
      ['blank page', withLink('about:blank'), /scheme that is not allowed/],
    ];
    const paints: [string, string][] = [
      ['fill that loads something', 'url(#a)'],
      ['fill that loads from elsewhere', 'url(//evil.example/x)'],
      ['expression', 'expression(alert(1))'],
      ['script', 'javascript:alert(1)'],
      ['stylesheet', '@import x'],
      ['declaration that ends early', 'red;stroke:blue'],
      ['rule', 'red}a{x:y'],
      ['markup', '"><script>'],
    ];
    for (const [what, paint] of paints) {
      bad.push(
        [`shape ${what}`, changed((r) => (r.scene.shapes[0].paint = paint)), /paint/],
        [`text ${what}`, changed((r) => (r.scene.texts[0].paint = paint)), /paint/],
        [`run ${what}`, changed((r) => (r.scene.texts[0].spans[0].paint = paint)), /paint/],
        [`text outline ${what}`, changed((r) => (r.scene.texts[0].stroke = paint)), /paint/],
        [
          `gradient stop ${what}`,
          changed((r) => (r.scene.gradients = { g: { x1: 0, y1: 0, x2: 1, y2: 1, stops: [{ offset: 0, paint }] } })),
          /paint/,
        ]
      );
    }
    for (const [name, result, message] of bad) {
      expect(sceneProblem(result) ?? 'no objection', name).toMatch(message);
      expect(() => assertSafe(result, name), name).toThrow(message);
    }
  });

  // An internal link is a note name the host looks up, whatever the text spells it as.
  it('leaves internal links to the host', () => {
    expect(sceneProblem(withLink('javascript:alert(1)', true))).toBeUndefined();
  });

  it('names where it was when it objects', () => {
    expect(() => assertSafe(withLink('javascript:x'), 'timeline: mutated')).toThrow('timeline: mutated: link "javascript:x" can run script');
  });
});
