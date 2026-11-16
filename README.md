# Pele

Pele draws [Mermaid](https://mermaid.js.org) diagrams as vector scenes: shapes, lines of text and the parts of the diagram, as numbers a host paints itself. It is small, synchronous and has no runtime dependencies.

This is a fork of [pele](https://github.com/obsidianmd/pele) that draws scenes only; it writes no SVG. It supports every diagram type built into Mermaid 12.1.0.

## Use

```ts
import { renderScene } from 'pele';

const { scene, width, height, links } = renderScene(`flowchart LR
  A[Mermaid text] --> B[Scene]`);
```

A scene (`SCENE_VERSION` 3) holds:

- `shapes`: fills and strokes in painting order, each a path of numbers (`M L C Q A Z` op codes, see `src/draw/scene.ts`), its paint, opacity, outline width and dashes, and bounds.
- `texts`: lines of text with their position, size, weight, anchor, paint and runs.
- `items`: the parts a host can point at (nodes, edges, labels), with their class, role, bounds and where the source wrote them.

Paints stay theme tokens such as `var(--_s)` for the host to resolve: `--_bg`, `--_fg`, `--_m` (muted), `--_l` (line), `--_s` (surface), `--_a` (surface alt), `--_b` (border), `--_c` (accent), and `var(--pele-series-N, …)` for chart series.

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
