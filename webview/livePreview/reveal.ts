import { EditorSelection, Facet, type EditorState } from '@codemirror/state';

/** True in Reading mode, where symbols are never revealed (PLAN.md §3.5). */
export const readingFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/** A selection that touches nothing: a cursor before the start of the document. */
const NOWHERE = EditorSelection.single(-1);

/** The selection that decides which symbols are shown: the real one, except in Reading mode. */
export function revealSelection(state: EditorState): EditorSelection {
  return state.facet(readingFacet) ? NOWHERE : state.selection;
}

/**
 * True if any selection range touches [from, to], edges included, so the symbols of a node
 * are shown while the cursor is inside it or right next to it (PLAN.md §3.5).
 */
export function isTouched(selection: EditorSelection, from: number, to: number): boolean {
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}
