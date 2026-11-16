# Pele

Pele draws [Mermaid](https://mermaid.js.org) diagrams as vector scenes: shapes, lines of text and the parts of the diagram, as numbers a host paints itself. It is small, synchronous and has no runtime dependencies.

This is a fork of [pele](https://github.com/obsidianmd/pele) that draws scenes only; it writes no SVG. It supports every diagram type built into Mermaid 12.1.0.

## Use

```ts
import { renderScene } from 'pele';

const { scene, width, height, links } = renderScene(`flowchart LR
  A[Mermaid text] --> B[Scene]`);
```

A scene (`SCENE_VERSION` 4) holds:

- `shapes`: fills and strokes in painting order, each a path of numbers (`M L C Q A Z` op codes, see `src/draw/scene.ts`), its paint, opacity, outline width and dashes, and bounds.
- `texts`: lines of text with their position, size, weight, anchor, paint and runs.
- `items`: the parts a host can point at (nodes, edges, labels), with their class, role, bounds and where the source wrote them.
- `vars`: what the CSS variables paints name stand for, such as `--_s: var(--pele-surface,#f3f3f3)`, and the series colors a diagram's `themeVariables` set (`--pele-series-1: red`).

Paints stay theme tokens such as `var(--_s)` or `var(--pele-series-1,#4c78a8)`. A host resolves them through `vars` against its own values for pele's CSS variables, as a page with pele's CSS would:

```css
--pele-bg: #fffcf0;
--pele-fg: #100f0f;
--pele-muted: #6f6e69;
--pele-line: #100f0f;
--pele-surface: #f2f0e5;
--pele-surface-alt: #e6e4d9;
--pele-border: #cecdc3;
--pele-accent: #205ea6;
```

Charts also use `--pele-series-1` through `--pele-series-8`, and some labels `--pele-fg-on-light`, `--pele-fg-on-dark` and `--pele-critical`. Any variable a host leaves unset takes the default in the paint or in `vars`. `--pele-radius`, the `--pele-*-weight` variables and fonts are drawn at their defaults: a scene has corners as path numbers and weights as numbers, and text is set in the host's fonts.

The main entry point includes every diagram type. Reduce the initial bundle size by registering individual types or loading them on demand:

```ts
import { register, renderScene } from 'pele/core';
import flowchart from 'pele/diagrams/flowchart';

register(flowchart);
```

```ts
import { renderSceneAsync } from 'pele/lazy';

const { scene } = await renderSceneAsync(text);
```

## Security

Pele filters links and styles and limits source and output size. A host still paints what a scene says: resolve paints against your own theme, and follow `links` only through your own URL policy.

## Compatibility

Pele targets Mermaid 12.1.0 syntax, with its own layout and visual style. Its parsers are tested against Mermaid's parser specs and with differential fuzzing.

## Develop

```sh
npm install
npm test
npm run build
npm run bench
```

`tests/scene/baseline.json` holds a signature of the scene of every diagram in `tests/corpus`. After a change meant to change scenes, write it again with `UPDATE_SCENE_BASELINE=1 npx vitest run tests/scene/scene.test.ts` and review the diff.

See [Contributing](CONTRIBUTING.md) for parser testing.

## License

MIT. The specs under `tests/compat` and the grammar files beside them come from Mermaid, which is also MIT licensed.
