// Keeps the cursor, selection and scroll position across the webview being hidden and shown again
// (PLAN.md Phase 6). Without `retainContextWhenHidden`, VS Code throws the page away when its tab
// is not visible; `setState` keeps a small record that survives that, and `getState` returns it
// when the page is made again. The text itself comes from the host (`init`), so the record holds
// only positions, which are checked against the text that arrives.

import { EditorSelection, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Offsets into the document: the selection, and the start of the line at the top of the view. */
export interface SavedView {
  anchor: number;
  head: number;
  top: number;
}

/** The saved record, if `value` is one, with every position kept inside the document. */
export function readSavedView(value: unknown, docLength: number): SavedView | undefined {
  const saved = value as Partial<SavedView> | null | undefined;
  if (typeof saved !== 'object' || saved === null) return undefined;
  const { anchor, head, top } = saved;
  if (![anchor, head, top].every((n) => Number.isInteger(n) && (n as number) >= 0)) {
    return undefined;
  }
  const clamp = (n: number) => Math.min(n, docLength);
  return {
    anchor: clamp(anchor as number),
    head: clamp(head as number),
    top: clamp(top as number),
  };
}

/** Puts the selection and scroll position back. Does not take the focus. */
export function restoreView(view: EditorView, saved: SavedView): void {
  view.dispatch({
    selection: EditorSelection.single(saved.anchor, saved.head),
    effects: EditorView.scrollIntoView(saved.top, { y: 'start' }),
  });
}

/** Calls `save` (after a short pause) whenever the selection or the scroll position changes. */
export function trackView(view: EditorView, save: (state: SavedView) => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { main } = view.state.selection;
      const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
      save({ anchor: main.anchor, head: main.head, top });
    }, 250);
  };
  view.scrollDOM.addEventListener('scroll', schedule, { passive: true });
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) schedule();
      }),
    ),
  });
}
