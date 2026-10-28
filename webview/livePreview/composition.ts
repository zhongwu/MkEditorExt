// IME input (PLAN.md Phase 6). While a composition is under way (Chinese, Japanese or Korean
// text being chosen from a candidate list), the browser owns the text being composed, and
// decorations that change under it can cancel the composition or lose characters. So the live
// preview holds back: it keeps what it has, only mapped through the typing, and catches up in
// one go when the composition ends.

import { type EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const setComposing = StateEffect.define<boolean>();

/** True from the start of an IME composition until its end. */
export const composingField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setComposing)) return effect.value;
    }
    return value;
  },
});

/** True if the transaction that took `start` to `end` is the one that ends a composition. */
export function compositionEnded(start: EditorState, end: EditorState): boolean {
  return !!start.field(composingField, false) && !end.field(composingField, false);
}

/** Ends the composition in the state if the browser never said so (a lost focus, say). */
function release(view: EditorView): void {
  if (view.state.field(composingField) && !view.composing) {
    view.dispatch({ effects: setComposing.of(false) });
  }
}

/** Tracks composition in the state, so the preview fields (which have no view) can hold back. */
export const compositionTracking = [
  composingField,
  EditorView.domEventHandlers({
    compositionstart(_event, view) {
      // Not while an update is in progress: CodeMirror starts the composition itself first.
      setTimeout(() => view.composing && view.dispatch({ effects: setComposing.of(true) }));
      return false;
    },
    compositionend(_event, view) {
      // CodeMirror applies the composed text just after this event, so wait for it.
      setTimeout(() => {
        if (view.state.field(composingField)) view.dispatch({ effects: setComposing.of(false) });
      }, 20);
      return false;
    },
    blur(_event, view) {
      setTimeout(() => release(view), 20);
      return false;
    },
    keydown(event, view) {
      // A key that is not part of a composition means no composition is going on.
      if (!event.isComposing && event.keyCode !== 229) release(view);
      return false;
    },
  }),
];
