import type { SourceInfo } from '../../types.js';

export interface IshikawaNode {
  text: string;
  children: IshikawaNode[];
  // The line the node is written on; its children are on lines of their own (see SourceInfo).
  source?: SourceInfo;
}

// The root is the effect; its children are the categories of causes, theirs the causes, and so on.
export interface IshikawaModel {
  type: 'ishikawa';
  title: string | undefined;
  root: IshikawaNode | undefined;
}
