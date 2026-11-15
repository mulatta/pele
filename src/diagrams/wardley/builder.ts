import { PeleError } from '../../errors.js';
import type { SourceInfo } from '../../types.js';

export type SourceStrategy = 'build' | 'buy' | 'outsource' | 'market';
export type Flow = 'forward' | 'backward' | 'bidirectional';

// Coordinates are percentages: x is evolution, y is visibility.
export interface WardleyNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
  // 'anchor', 'component', or 'pipeline-component'
  className?: string;
  labelOffsetX?: number;
  labelOffsetY?: number;
  inPipeline?: boolean;
  isPipelineParent?: boolean;
  inertia?: boolean;
  sourceStrategy?: SourceStrategy;
  source?: SourceInfo;
}

export interface WardleyLink {
  source: string;
  target: string;
  dashed?: boolean;
  label?: string;
  flow?: Flow;
  written?: SourceInfo;
}

export interface WardleyTrend {
  nodeId: string;
  targetX: number;
  targetY: number;
  source?: SourceInfo;
}

export interface WardleyPipeline {
  nodeId: string;
  componentIds: string[];
  source?: SourceInfo;
}

export interface WardleyAnnotation {
  number: number;
  coordinates: { x: number; y: number }[];
  text?: string;
  source?: SourceInfo;
}

export interface WardleyNote {
  text: string;
  x: number;
  y: number;
}

export interface WardleyForce {
  name: string;
  x: number;
  y: number;
  source?: SourceInfo;
}

export interface WardleyAxesConfig {
  xLabel?: string;
  yLabel?: string;
  stages?: string[];
  // Right edge of each stage, from 0 to 1.
  stageBoundaries?: number[];
}

export interface WardleyBuildResult {
  nodes: WardleyNode[];
  links: WardleyLink[];
  trends: WardleyTrend[];
  pipelines: WardleyPipeline[];
  annotations: WardleyAnnotation[];
  notes: WardleyNote[];
  accelerators: WardleyForce[];
  deaccelerators: WardleyForce[];
  annotationsBox?: { x: number; y: number };
  axes: WardleyAxesConfig;
  size?: { width: number; height: number };
}

export class WardleyBuilder {
  private nodes = new Map<string, WardleyNode>();
  private labels: Map<string, string> | undefined;
  private links: WardleyLink[] = [];
  private trends = new Map<string, WardleyTrend>();
  private pipelines = new Map<string, WardleyPipeline>();
  private annotations: WardleyAnnotation[] = [];
  private notes: WardleyNote[] = [];
  private accelerators: WardleyForce[] = [];
  private deaccelerators: WardleyForce[] = [];
  private annotationsBox?: { x: number; y: number };
  private axes: WardleyAxesConfig = {};
  private size?: { width: number; height: number };

  // A node added again keeps its class and label offsets unless the new one sets them, and takes
  // the rest, its place included, from the new one: so it comes from the new one's statement.
  // `source`, here and below: where a statement is written, when the host asks for sources.
  addNode(node: WardleyNode, source?: SourceInfo): void {
    const existing = this.nodes.get(node.id) ?? { id: node.id, label: node.label };
    const next: WardleyNode = {
      ...existing,
      ...node,
      className: node.className ?? existing.className,
      labelOffsetX: node.labelOffsetX ?? existing.labelOffsetX,
      labelOffsetY: node.labelOffsetY ?? existing.labelOffsetY,
    };
    if (source !== undefined) next.source = source;
    this.nodes.set(node.id, next);
    this.labels = undefined;
  }

  addLink(link: WardleyLink, source?: SourceInfo): void {
    if (source !== undefined) link.written = source;
    this.links.push(link);
  }

  // A later trend for a node replaces the one before, its statement too.
  addTrend(trend: WardleyTrend, source?: SourceInfo): void {
    if (source !== undefined) trend.source = source;
    this.trends.set(trend.nodeId, trend);
  }

  // A later pipeline for a node replaces the one before, its statement too.
  startPipeline(nodeId: string, source?: SourceInfo): void {
    const pipeline: WardleyPipeline = { nodeId, componentIds: [] };
    if (source !== undefined) pipeline.source = source;
    this.pipelines.set(nodeId, pipeline);
    const node = this.nodes.get(nodeId);
    if (node) node.isPipelineParent = true;
  }

  addPipelineComponent(pipelineNodeId: string, componentId: string): void {
    this.pipelines.get(pipelineNodeId)?.componentIds.push(componentId);
    const node = this.nodes.get(componentId);
    if (node) node.inPipeline = true;
  }

  addAnnotation(annotation: WardleyAnnotation, source?: SourceInfo): void {
    if (source !== undefined) annotation.source = source;
    this.annotations.push(annotation);
  }

  addNote(note: WardleyNote): void {
    this.notes.push(note);
  }

  addAccelerator(accelerator: WardleyForce, source?: SourceInfo): void {
    if (source !== undefined) accelerator.source = source;
    this.accelerators.push(accelerator);
  }

  addDeaccelerator(deaccelerator: WardleyForce, source?: SourceInfo): void {
    if (source !== undefined) deaccelerator.source = source;
    this.deaccelerators.push(deaccelerator);
  }

  setAnnotationsBox(x: number, y: number): void {
    this.annotationsBox = { x, y };
  }

  setAxes(partial: WardleyAxesConfig): void {
    this.axes = { ...this.axes, ...partial };
  }

  setSize(width: number, height: number): void {
    this.size = { width, height };
  }

  getNode(id: string): WardleyNode | undefined {
    return this.nodes.get(id);
  }

  // A name is a node id, or else the label of the first node that has it. Pipeline components
  // have ids like "Parent_Child" and are linked by label.
  resolveNodeId(name: string): string {
    if (this.nodes.has(name)) return name;
    if (!this.labels) {
      this.labels = new Map();
      for (const [id, node] of this.nodes) if (!this.labels.has(node.label)) this.labels.set(node.label, id);
    }
    return this.labels.get(name) ?? name;
  }

  build(): WardleyBuildResult {
    const nodes: WardleyNode[] = [];
    for (const node of this.nodes.values()) {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') {
        throw new PeleError(`Node "${node.label}" is missing coordinates`, 'semantic', { type: 'wardley' });
      }
      nodes.push(node);
    }
    return {
      nodes,
      links: [...this.links],
      trends: [...this.trends.values()],
      pipelines: [...this.pipelines.values()],
      annotations: [...this.annotations],
      notes: [...this.notes],
      accelerators: [...this.accelerators],
      deaccelerators: [...this.deaccelerators],
      annotationsBox: this.annotationsBox,
      axes: { ...this.axes },
      size: this.size,
    };
  }
}
