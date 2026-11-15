import type { SourceInfo } from '../../types.js';

export type RailroadNode =
  | { type: 'terminal'; value: string }
  // `source`: where this reference to the rule is written.
  | { type: 'nonterminal'; name: string; source?: SourceInfo }
  | { type: 'special'; text: string }
  | { type: 'sequence'; elements: RailroadNode[] }
  | { type: 'choice'; alternatives: RailroadNode[] }
  | { type: 'optional'; element: RailroadNode }
  // max is Infinity when the count has no upper bound.
  | { type: 'repetition'; element: RailroadNode; min: number; max: number };

export interface RailroadRule {
  name: string;
  definition: RailroadNode;
  source?: SourceInfo;
}

// Which of Mermaid's four grammars the text was written in.
export type Notation = 'railroad' | 'ebnf' | 'abnf' | 'peg';

export interface RailroadModel {
  type: 'railroad';
  notation: Notation;
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  // Every rule in source order. A name defined twice appears twice.
  rules: RailroadRule[];
}
