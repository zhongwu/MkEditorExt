import type { EditorSelection } from '@codemirror/state';

/**
 * True if any selection range touches [from, to], edges included, so the symbols of a node
 * are shown while the cursor is inside it or right next to it (PLAN.md §3.5).
 */
export function isTouched(selection: EditorSelection, from: number, to: number): boolean {
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}
