# Pele

Pele draws Mermaid text as vector scenes for a host to paint, with theme tokens for its colors.

## Conventions

- Comment only non-obvious decisions, intentional differences from Mermaid, and preserved quirks. Keep comments brief.
- Use a short imperative commit subject; add a body only when needed.
- No library runtime dependencies. Dev dependencies are allowed.
- Strict TypeScript, ESM. Rendering must be synchronous, without DOM access.
- Identical inputs and text measurer must produce identical scenes.

## Layout

- `src/diagrams/<type>/`: parser, model, layout, renderer.
- `tests/compat/<type>/`: ported Mermaid specs and model adapters. Record skipped cases in the adjacent `SKIPPED.md`.
- `tests/render/`, `tests/layout/`: scene behaviour and invariants.
- `tests/scene/`: scene output, and `baseline.json`, a signature of every corpus scene.

## Validation

- Library code changes: run `npm run typecheck`, `npm test`, and `npm run build`.
- A change meant to change scenes: write `tests/scene/baseline.json` again with `UPDATE_SCENE_BASELINE=1 npx vitest run tests/scene/scene.test.ts` and review its diff.
