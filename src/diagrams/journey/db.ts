import type { SourceInfo } from '../../types.js';

export interface JourneyTask {
  task: string;
  // As written: any number, or NaN when the score is not one.
  score: number;
  people: string[];
  // Name of the section in force when the task was declared, '' before the first one.
  section: string;
  // Where the task is written, and the section statement it comes under (see SourceInfo).
  source?: SourceInfo;
  sectionSource?: SourceInfo;
}

export interface JourneyModel {
  type: 'journey';
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  sections: string[];
  tasks: JourneyTask[];
}

// Everyone named on a task, once each, in code unit order.
export function journeyActors(tasks: JourneyTask[]): string[] {
  const names = new Set<string>();
  for (const task of tasks) for (const name of task.people) names.add(name);
  return [...names].sort();
}

// Where a statement is written: its line, and its last when it spans several.
const lines = (line: number, end: number | undefined): SourceInfo =>
  end !== undefined && end > line ? { line, end } : { line };

export class JourneyDb implements JourneyModel {
  readonly type = 'journey' as const;
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  sections: string[] = [];
  tasks: JourneyTask[] = [];
  // The lines of the statement the parser is at: the section or task added next comes from them.
  line: number | undefined;
  end: number | undefined;

  private currentSection = '';
  private sectionSource: SourceInfo | undefined;

  setDiagramTitle(text: string): void {
    this.title = text;
  }

  setAccTitle(text: string): void {
    this.accTitle = text.replace(/^\s+/g, '');
  }

  setAccDescription(text: string): void {
    this.accDescr = text.replace(/\n\s+/g, '\n');
  }

  addSection(text: string): void {
    this.currentSection = text;
    this.sections.push(text);
    this.sectionSource = this.line === undefined ? undefined : lines(this.line, this.end);
  }

  // `data` is the rest of the line from its first colon: `:score` or `:score:actor, actor`.
  addTask(task: string, data: string): void {
    const pieces = data.substring(1).split(':');
    const people = pieces.length === 1 ? [] : pieces[1].split(',').map((name) => name.trim());
    const item: JourneyTask = { task, score: Number(pieces[0]), people, section: this.currentSection };
    if (this.line !== undefined) item.source = lines(this.line, this.end);
    if (this.sectionSource) item.sectionSource = this.sectionSource;
    this.tasks.push(item);
  }

  getActors(): string[] {
    return journeyActors(this.tasks);
  }
}
