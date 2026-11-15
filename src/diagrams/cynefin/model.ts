import type { SourceInfo } from '../../types.js';
import type { CynefinAst, DomainName, Written } from './parser.js';

export type { DomainName } from './parser.js';

export interface CynefinItem {
  label: string;
  source?: SourceInfo;
}

export interface CynefinDomain {
  name: DomainName;
  items: CynefinItem[];
  source?: SourceInfo;
}

export interface CynefinTransition {
  from: DomainName;
  to: DomainName;
  label?: string;
  source?: SourceInfo;
}

export interface CynefinModel {
  type: 'cynefin';
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  // The domains the source declares. All five are drawn either way.
  domains: Map<DomainName, CynefinDomain>;
  transitions: CynefinTransition[];
  // Where each domain without a block of its own is first named, when sources are recorded.
  named?: Map<DomainName, SourceInfo>;
}

export interface DomainBlock extends Written {
  domain: string;
  items?: ({ label: string } & Written)[];
}

export interface Transition extends Written {
  from: string;
  to: string;
  label?: string;
}

// The lines a statement is written on, when they are recorded.
const lines = (node: Written): SourceInfo | undefined =>
  node.$line === undefined ? undefined : node.$end === undefined ? { line: node.$line } : { line: node.$line, end: node.$end };

export class CynefinDb {
  domains = new Map<DomainName, CynefinDomain>();
  transitions: CynefinTransition[] = [];

  // A later block for a domain replaces an earlier one, so the domain comes from the last.
  setDomains(blocks: DomainBlock[] | null | undefined): void {
    if (!blocks) return;
    for (const block of blocks) {
      const name = block.domain as DomainName;
      const at = lines(block);
      this.domains.set(name, {
        name,
        items: (block.items ?? []).map((item) => ({ label: item.label, source: lines(item) })),
        source: at && { ...at, symbol: name },
      });
    }
  }

  setTransitions(transitions: Transition[] | null | undefined): void {
    if (!transitions) return;
    this.transitions = transitions
      .filter((t) => t.from !== t.to)
      .map((t) => {
        const at = lines(t);
        const source = at && { ...at, from: t.from, to: t.to };
        return { from: t.from as DomainName, to: t.to as DomainName, label: t.label || undefined, source };
      });
  }
}

export function buildCynefin(ast: CynefinAst, title: string | undefined): CynefinModel {
  const db = new CynefinDb();
  db.setDomains(ast.domains);
  db.setTransitions(ast.transitions);
  const model: CynefinModel = {
    type: 'cynefin',
    title: ast.title || title,
    accTitle: ast.accTitle ? ast.accTitle.replace(/^\s+/g, '') : undefined,
    accDescr: ast.accDescr ? ast.accDescr.replace(/\n\s+/g, '\n') : undefined,
    domains: db.domains,
    transitions: db.transitions,
  };
  // All five domains are drawn, so one without a block comes from the first transition that names
  // it, one that loops back to its own domain included.
  const named = new Map<DomainName, SourceInfo>();
  for (const transition of ast.transitions) {
    const at = lines(transition);
    if (at === undefined) continue;
    for (const name of [transition.from, transition.to]) {
      if (!db.domains.has(name) && !named.has(name)) named.set(name, { ...at, symbol: name });
    }
  }
  if (named.size > 0) model.named = named;
  return model;
}
