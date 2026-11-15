import type { SourceInfo } from '../../types.js';

export interface Requirement {
  name: string;
  type: string;
  requirementId: string;
  text: string;
  risk: string;
  verifyMethod: string;
  cssStyles: string[];
  classes: string[];
  source?: SourceInfo;
}

export interface RequirementElement {
  name: string;
  type: string;
  docRef: string;
  cssStyles: string[];
  classes: string[];
  source?: SourceInfo;
}

export interface Relation {
  type: string;
  src: string;
  dst: string;
  source?: SourceInfo;
}

export interface RequirementClass {
  id: string;
  styles: string[];
  textStyles: string[];
}

export interface RequirementModel {
  type: 'requirement';
  direction: string;
  requirements: Map<string, Requirement>;
  elements: Map<string, RequirementElement>;
  relations: Relation[];
  classes: Map<string, RequirementClass>;
  title?: string;
  accTitle?: string;
  accDescr?: string;
}
