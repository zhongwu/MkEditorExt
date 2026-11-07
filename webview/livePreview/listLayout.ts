// Where the text of a list item starts, so that lists, and the blocks inside them, line up.
// The sizes follow VS Code's Markdown preview, where each level of a list moves in by the same step.

/** The left edge of the editor's text, in px (CodeMirror's line padding). */
const BASE = 6;
/** How far each level of a list moves in, in px. */
const STEP = 60;

/** The left edge of the text of an item at `depth` (1 for a top-level item). */
export function listColumn(depth: number): number {
  return BASE + STEP * depth;
}

/** The width of a list marker, which hangs to the left of the text. */
export const MARKER_WIDTH = '1.6em';
