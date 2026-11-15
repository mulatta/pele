export type PeleErrorCode = 'unsupported-diagram' | 'syntax' | 'semantic' | 'limit';

export class PeleError extends Error {
  code: PeleErrorCode;
  type: string | null;
  mermaidType: string | null;
  line: number;
  column: number;
  snippet: string;

  constructor(
    message: string,
    code: PeleErrorCode = 'syntax',
    info: { type?: string | null; mermaidType?: string | null; line?: number; column?: number; snippet?: string } = {}
  ) {
    super(message);
    this.name = 'PeleError';
    this.code = code;
    this.type = info.type ?? null;
    this.mermaidType = info.mermaidType ?? null;
    this.line = info.line ?? 0;
    this.column = info.column ?? 0;
    this.snippet = info.snippet ?? '';
  }
}

// Input range [from, to) replaced by `length` output characters.
export type Edit = [from: number, to: number, length: number];

export function replacements(text: string, re: RegExp, length: number): Edit[] {
  return Array.from(text.matchAll(re), (match): Edit => [match.index, match.index + match[0].length, length]);
}

function stepInput(edits: Edit[], at: number): number {
  let shift = 0;
  for (const [from, to, length] of edits) {
    const start = from - shift;
    if (at < start) break;
    if (at < start + length) return from + Math.min(at - start, to - from - 1);
    shift += to - from - length;
  }
  return at + shift;
}

// inputOffset for many offsets in ascending order at once: each step's edits are walked once.
export function inputOffsets(steps: Edit[][], offsets: number[]): number[] {
  const out = offsets.slice();
  for (let s = steps.length - 1; s >= 0; s--) {
    const edits = steps[s];
    let shift = 0;
    let e = 0;
    for (let k = 0; k < out.length; k++) {
      const at = out[k];
      let mapped = -1;
      while (e < edits.length) {
        const [from, to, length] = edits[e];
        const start = from - shift;
        if (at < start) break;
        if (at < start + length) {
          mapped = from + Math.min(at - start, to - from - 1);
          break;
        }
        shift += to - from - length;
        e++;
      }
      out[k] = mapped >= 0 ? mapped : at + shift;
    }
  }
  return out;
}

export function inputOffset(steps: Edit[][], at: number): number {
  for (let s = steps.length - 1; s >= 0; s--) at = stepInput(steps[s], at);
  return at;
}

interface Origin {
  parsed: string;
  find(offset: number): [source: string, offset: number];
  // Elements record the lines they come from (see sourceLine) only when the host asks for
  // sources, which maps many offsets at once.
  record?: boolean;
  findAll?(offsets: number[]): [source: string, offsets: number[]];
  table?: LineTable;
}

// For each line of the parsed text: the line it comes from in the text as written, and whether
// all of it does (an edit that removed a line break inside it makes it come from several).
interface LineTable {
  starts: number[];
  lines: number[];
  whole: boolean[];
}

const lastAtOrBefore = (sorted: number[], at: number): number => {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const lineStartsOf = (text: string): number[] => {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
};

let lastStarts: { text: string; starts: number[] } | undefined;
const startsOf = (text: string): number[] => {
  if (lastStarts?.text !== text) lastStarts = { text, starts: lineStartsOf(text) };
  return lastStarts.starts;
};

// Maps the first and last character of every line of `parsed` in one pass.
function lineTable(parsed: string, findAll: (offsets: number[]) => [string, number[]]): LineTable {
  const starts = lineStartsOf(parsed);
  const marks: number[] = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] - 1 : parsed.length;
    marks.push(starts[k], Math.max(starts[k], end - 1));
  }
  const [text, mapped] = findAll(marks);
  const written = lineStartsOf(text);
  const lines: number[] = [];
  const whole: boolean[] = [];
  let w = 0;
  const lineOf = (at: number): number => {
    while (w + 1 < written.length && written[w + 1] <= at) w++;
    return w + 1;
  };
  for (let k = 0; k < starts.length; k++) {
    const first = lineOf(mapped[2 * k]);
    lines.push(first);
    whole.push(lineOf(mapped[2 * k + 1]) === first);
  }
  return { starts, lines, whole };
}

let origin: Origin | undefined;

// Report positions in the original source while `run` parses.
export function locatingIn<T>(next: Origin, run: () => T): T {
  const outer = origin;
  origin = next;
  try {
    return run();
  } finally {
    origin = outer;
  }
}

// Maps only when `src` is exactly the text being parsed.
export function written(src: string, offset: number): [source: string, offset: number] {
  return origin !== undefined && src === origin.parsed ? origin.find(offset) : [src, offset];
}

// The 1-based line, in the text as written, of `offset` in `src` (the text being parsed); undefined
// unless the host asked for sources (see RenderOptions.sourceInfo).
export function sourceLine(src: string, offset: number): number | undefined {
  const o = origin;
  // A parser called on its own, as its tests do, has no host asking.
  if (o === undefined || !o.record) return undefined;
  if (src === o.parsed && o.findAll !== undefined) {
    const t = (o.table ??= lineTable(o.parsed, o.findAll));
    const k = lastAtOrBefore(t.starts, offset);
    if (t.whole[k]) return t.lines[k];
  }
  const [text, at] = written(src, offset);
  return lastAtOrBefore(startsOf(text), at) + 1;
}

export function locate(src: string, offset: number): { line: number; column: number; snippet: string } {
  // Keep EOF errors on the last content line.
  const end = src.trimEnd().length;
  if (end > 0 && offset >= end) {
    [src, offset] = written(src, end - 1);
    offset++;
  } else {
    [src, offset] = written(src, offset);
  }
  let line = 1;
  let lineStart = 0;
  for (let i = src.indexOf('\n'); i !== -1 && i < offset; i = src.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  let lineEnd = src.indexOf('\n', offset);
  if (lineEnd === -1) lineEnd = src.length;
  const column = offset - lineStart + 1;
  const text = src.slice(lineStart, lineEnd);
  return { line, column, snippet: text + '\n' + '-'.repeat(column - 1) + '^' };
}

export function syntaxError(
  type: string,
  src: string,
  offset: number,
  detail: string,
  lexical = false
): PeleError {
  const loc = locate(src, offset);
  const head = lexical
    ? `Lexical error on line ${loc.line}. Unrecognized text.`
    : `Parse error on line ${loc.line}:`;
  const message = lexical ? `${head}\n${loc.snippet}` : `${head}\n${loc.snippet}\n${detail}`;
  return new PeleError(message, 'syntax', { type, ...loc });
}
