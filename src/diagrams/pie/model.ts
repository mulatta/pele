import { PeleError } from '../../errors.js';
import type { SourceInfo } from '../../types.js';
import type { PieAst } from './parser.js';

export interface PieModel {
  type: 'pie';
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  showData: boolean;
  sections: Map<string, number>;
  // Where each section is written, by label, when the parser recorded it.
  sources?: Map<string, SourceInfo>;
}

export function buildPie(ast: PieAst, title: string | undefined): PieModel {
  const sections = new Map<string, number>();
  let sources: Map<string, SourceInfo> | undefined;
  for (const { label, value, source } of ast.sections) {
    if (value < 0) {
      throw new PeleError(
        `"${label}" has invalid value: ${value}. Negative values are not allowed in pie charts. All slice values must be >= 0.`,
        'semantic',
        { type: 'pie' }
      );
    }
    // The first section with a label is the one drawn, so it is where the slice comes from.
    if (!sections.has(label)) {
      sections.set(label, value);
      if (source) (sources ??= new Map()).set(label, source);
    }
  }
  const model: PieModel = {
    type: 'pie',
    title: ast.title || title,
    accTitle: ast.accTitle ? ast.accTitle.replace(/^\s+/g, '') : undefined,
    accDescr: ast.accDescr ? ast.accDescr.replace(/\n\s+/g, '\n') : undefined,
    showData: ast.showData,
    sections,
  };
  if (sources) model.sources = sources;
  return model;
}
