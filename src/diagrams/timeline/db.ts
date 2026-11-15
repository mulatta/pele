import { PeleError } from '../../errors.js';
import type { SourceInfo } from '../../types.js';

export interface TimelinePeriod {
  text: string;
  events: string[];
  // Name of the section in force when the period was declared, '' before the first one.
  section: string;
  // Index into `sections` of that section, -1 before the first one.
  sectionIndex: number;
  // Where the period is written, on to the last line that adds an event to it (see SourceInfo).
  source?: SourceInfo;
}

export interface TimelineModel {
  type: 'timeline';
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  direction: 'LR' | 'TD';
  sections: string[];
  // Where each section is written, by its index in `sections`, when lines are recorded.
  sectionSources?: SourceInfo[];
  periods: TimelinePeriod[];
}

// Where a statement is written: its line, and its last when it spans several.
const lines = (line: number, end: number | undefined): SourceInfo =>
  end !== undefined && end > line ? { line, end } : { line };

export class TimelineDb implements TimelineModel {
  readonly type = 'timeline' as const;
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  direction: 'LR' | 'TD' = 'LR';
  sections: string[] = [];
  sectionSources: SourceInfo[] = [];
  periods: TimelinePeriod[] = [];
  // The lines of the statement the parser is at: the section, period or event added next comes from them.
  line: number | undefined;
  end: number | undefined;

  private currentSection = '';

  // The grammar reaches the title and accessibility setters through this.
  getCommonDb(): this {
    return this;
  }

  setDiagramTitle(text: string): void {
    this.title = text;
  }

  setAccTitle(text: string): void {
    this.accTitle = text.replace(/^\s+/g, '');
  }

  setAccDescription(text: string): void {
    this.accDescr = text.replace(/\n\s+/g, '\n');
  }

  setDirection(direction: 'LR' | 'TD'): void {
    this.direction = direction;
  }

  addSection(text: string): void {
    this.currentSection = text;
    this.sections.push(text);
    if (this.line !== undefined) this.sectionSources[this.sections.length - 1] = lines(this.line, this.end);
  }

  addTask(period: string, _length?: number, event?: string): void {
    const item: TimelinePeriod = {
      text: period,
      events: event ? [event] : [],
      section: this.currentSection,
      sectionIndex: this.sections.length - 1,
    };
    if (this.line !== undefined) item.source = lines(this.line, this.end);
    this.periods.push(item);
  }

  addEvent(event: string): void {
    const period = this.periods[this.periods.length - 1];
    // Mermaid fails here too, with a TypeError.
    if (!period) throw new PeleError('An event needs a time period before it.', 'semantic', { type: 'timeline' });
    period.events.push(event);
    // A period is drawn with its events, so it runs on to the line of an event written below it.
    const source = period.source;
    const end = this.end ?? this.line;
    if (source?.line !== undefined && end !== undefined && end > (source.end ?? source.line)) source.end = end;
  }
}
