// Editing a table cell inside its rendered widget (PLAN.md §5, Phase 5). These functions work out
// where each cell's text sits in the document and what a cell edit should change; they have no
// DOM, so they can be unit-tested.

import { rowCells, splitRow, type CellRange } from '../../src/tableCells';

export type { CellRange };

/**
 * The range of each cell on one table line, between its pipes (padding spaces included).
 * `lineFrom` is the document offset of the line's first character. A pipe written `\|` belongs
 * to the cell's text and does not split it. With `columns`, the table's column count, a row with
 * too many cells is read with the pipes inside formulas left alone (see `rowCells`).
 */
export function cellRanges(lineFrom: number, text: string, columns?: number): CellRange[] {
  const ranges = columns === undefined ? splitRow(text) : rowCells(text, columns);
  return ranges.map((r) => ({ from: lineFrom + r.from, to: lineFrom + r.to }));
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
  const flat = typed.replace(/\r?\n/g, ' ').trim();
  // A cell left as it was is not touched, even if it holds a bare pipe (inside a formula).
  if (flat === original.trim()) return null;
  const clean = flat.replace(/(?<!\\)\|/g, '\\|');
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

export interface TableLine {
  from: number;
  to: number;
  text: string;
}

/**
 * Inserts a new empty row above or below `row` (0 = header, 1..N = body rows).
 * Returns null if inserting above the header or if indices are out of range.
 */
export function insertRowAt(
  lines: { headerEnd: number; delimiterEnd: number; rowLines: readonly TableLine[] },
  row: number,
  where: 'above' | 'below',
  colCount: number,
): { from: number; to: number; insert: string } | null {
  if (colCount <= 0 || row < 0 || row >= lines.rowLines.length) return null;
  if (row === 0 && where === 'above') return null;
  const reference = lines.rowLines[row];
  const indent = /^\s*/.exec(reference.text)?.[0] ?? '';
  const insert = '\n' + indent + '|' + '  |'.repeat(colCount);
  const at =
    (row === 0 && where === 'below') || (row === 1 && where === 'above')
      ? lines.delimiterEnd
      : where === 'above'
        ? lines.rowLines[row - 1].to
        : reference.to;
  return { from: at, to: at, insert };
}

/**
 * Deletes body row `row` (1..N). Returns null for the header row (0) or out-of-range indices.
 */
export function deleteRowAt(
  rowLines: readonly { from: number; to: number }[],
  row: number,
): { from: number; to: number } | null {
  if (row <= 0 || row >= rowLines.length) return null;
  return { from: rowLines[row].from - 1, to: rowLines[row].to };
}

/**
 * Inserts an empty column to the left or right of `col` across all table lines without
 * re-aligning existing cells. Returns null if any row lacks cell `col`.
 */
export function insertColumnAt(
  allLines: readonly { from: number; text: string; isDelimiter?: boolean }[],
  col: number,
  where: 'left' | 'right',
): { from: number; to: number; insert: string }[] | null {
  const columns = splitRow(allLines[0]?.text ?? '').length;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const line of allLines) {
    const cells = cellRanges(line.from, line.text, columns);
    if (col < 0 || col >= cells.length) return null;
    const cell = cells[col];
    const at = where === 'left' ? cell.from : cell.to;
    const insert =
      where === 'left'
        ? line.isDelimiter
          ? ' --- |'
          : '  |'
        : line.isDelimiter
          ? '| --- '
          : '|  ';
    changes.push({ from: at, to: at, insert });
  }
  return changes;
}

/**
 * Deletes column `col` across all table lines without re-aligning remaining cells.
 * Returns null if the table has only one column or any row lacks cell `col`.
 */
export function deleteColumnAt(
  allLines: readonly { from: number; text: string }[],
  col: number,
): { from: number; to: number }[] | null {
  const columns = splitRow(allLines[0]?.text ?? '').length;
  const changes: { from: number; to: number }[] = [];
  for (const line of allLines) {
    const cells = cellRanges(line.from, line.text, columns);
    if (cells.length <= 1 || col < 0 || col >= cells.length) return null;
    const cell = cells[col];
    changes.push(
      col < cells.length - 1
        ? { from: cell.from, to: cell.to + 1 }
        : { from: cell.from - 1, to: cell.to },
    );
  }
  return changes;
}
