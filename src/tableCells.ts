// Splitting one line of a table into its cells. Used by the live preview (webview) and by the
// HTML export, so both read a row the same way. No DOM and no editor state.

export interface CellRange {
  from: number;
  to: number;
}

const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9';

/** Where the formula that opens with the `$` at `at` ends, or -1. Same rules as livePreview/math.ts. */
function mathEnd(text: string, at: number): number {
  const double = text[at + 1] === '$';
  const open = double ? 2 : 1;
  const start = at + open;
  if (start >= text.length || (!double && text[start] === ' ')) return -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === '$') {
      const closes = double ? text[i + 1] === '$' : text[i - 1] !== ' ' && !isDigit(text[i + 1]);
      if (!closes) continue;
      return i === start ? -1 : i + open;
    }
  }
  return -1;
}

/** Where the code span that opens with the backticks at `at` ends, or -1. A pipe ends the cell first. */
function codeEnd(text: string, at: number): number {
  let run = at;
  while (text[run] === '`') run++;
  const ticks = text.slice(at, run);
  for (let i = text.indexOf(ticks, run); i !== -1; i = text.indexOf(ticks, i + 1)) {
    if (text[i - 1] === '`' || text[i + ticks.length] === '`') continue;
    return /(?<!\\)\|/.test(text.slice(run, i)) ? -1 : i + ticks.length;
  }
  return -1;
}

/**
 * The range of each cell on one table line, between its pipes (padding spaces included), counted
 * from the start of `text`. A pipe written `\|` belongs to the cell's text and does not split it.
 * With `mathAware`, neither does a pipe inside a formula: `$|x|$` stays in one cell.
 */
export function splitRow(text: string, mathAware = false): CellRange[] {
  const ranges: CellRange[] = [];
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === '|') i++;
  let start = i;
  while (i < text.length) {
    const char = text[i];
    if (char === '|' && text[i - 1] !== '\\') {
      ranges.push({ from: start, to: i });
      start = i + 1;
    } else if (mathAware && char === '\\') {
      i++;
    } else if (mathAware && char === '$') {
      const end = mathEnd(text, i);
      if (end !== -1) {
        i = end;
        continue;
      }
    } else if (mathAware && char === '`') {
      const end = codeEnd(text, i);
      if (end !== -1) {
        i = end;
        continue;
      }
      while (text[i + 1] === '`') i++;
    }
    i++;
  }
  ranges.push({ from: start, to: text.length });
  // After a closing pipe there is no further cell, only the end of the line.
  if (/(?<!\\)\|\s*$/.test(text)) ranges.pop();
  return ranges;
}

/**
 * The cells of a body row in a table of `columns` columns. A row is split at every pipe, as
 * GitHub does. Only a row that then has too many cells is read again with the pipes inside
 * formulas left alone: `| a | $|x|$ |` is two cells, which is what its author meant.
 */
export function rowCells(text: string, columns: number): CellRange[] {
  const plain = splitRow(text);
  if (plain.length <= columns) return plain;
  const lenient = splitRow(text, true);
  return lenient.length < plain.length ? lenient : plain;
}
