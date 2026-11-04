// Editing a table cell inside its rendered widget (PLAN.md §5, Phase 5). These functions work out
// where each cell's text sits in the document and what a cell edit should change; they have no
// DOM, so they can be unit-tested.

export interface CellRange {
  from: number;
  to: number;
}

/**
 * The range of each cell on one table line, between its pipes (padding spaces included).
 * `lineFrom` is the document offset of the line's first character. A pipe written `\|` belongs
 * to the cell's text and does not split it.
 */
export function cellRanges(lineFrom: number, text: string): CellRange[] {
  const ranges: CellRange[] = [];
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === '|') i++;
  let start = i;
  for (; i <= text.length; i++) {
    if (i === text.length || (text[i] === '|' && text[i - 1] !== '\\')) {
      ranges.push({ from: lineFrom + start, to: lineFrom + i });
      start = i + 1;
    }
  }
  // After a closing pipe there is no further cell, only the end of the line.
  if (/(?<!\\)\|\s*$/.test(text)) ranges.pop();
  return ranges;
}

const NEXT_BOX: Record<string, string> = { '☐': '☑', '☑': '☒', '☒': '☐' };

/** The box a click on `box` turns it into: `☐` to `☑` to `☒` and back to `☐`. */
export function nextBox(box: string): string {
  return NEXT_BOX[box] ?? '☐';
}

/**
 * `[ ]` becomes `☐` and `[x]` becomes `☑`, so the file holds characters that every app shows.
 * Text in `code` and a bracket after a backslash are left as they are.
 */
function boxCharacters(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/(?<!\\)\[ \]/g, '☐').replace(/(?<!\\)\[[xX]\]/g, '☑'),
    )
    .join('');
}

/**
 * The change that makes a cell contain `typed`, or null if its text is already that. Only the
 * cell between its pipes is replaced, so nothing else in the table moves. Line breaks become
 * spaces and a typed `|` is escaped, since either would break the table. A typed `[ ]` or `[x]`
 * becomes `☐` or `☑`, but only in a cell that was changed.
 */
export function cellChange(
  range: CellRange,
  original: string,
  typed: string,
): { from: number; to: number; insert: string } | null {
  const clean = typed
    .replace(/\r?\n/g, ' ')
    .trim()
    .replace(/(?<!\\)\|/g, '\\|');
  if (clean === original.trim()) return null;
  const text = boxCharacters(clean);
  if (text === original.trim()) return null;
  return { from: range.from, to: range.to, insert: text ? ` ${text} ` : ' ' };
}

/**
 * The change that appends a new empty row to a table on `tableLastLine`.
 */
export function insertRowChange(
  tableLastLine: { to: number; text: string },
  colCount: number,
): { from: number; to: number; insert: string } {
  const indent = /^\s*/.exec(tableLastLine.text)?.[0] ?? '';
  const insert = '\n' + indent + '|' + '  |'.repeat(colCount);
  return { from: tableLastLine.to, to: tableLastLine.to, insert };
}
