// Live, Source and Reading modes (PLAN.md §3.5). The text and the syntax highlighting are the
// same in all three; the modes differ in which parts of the live preview are switched on.

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Mode } from '../src/protocol';
import { blockPreview } from './livePreview/blocks';
import { inlinePreview } from './livePreview/inline';
import { readingFacet } from './livePreview/reveal';

const previewCompartment = new Compartment();
const readingCompartment = new Compartment();

/** The preview decorations, present in Live and Reading mode but not in Source mode. */
function preview(mode: Mode, baseUri: string): Extension {
  return mode === 'source' ? [] : [inlinePreview, blockPreview(baseUri)];
}

/** Reading mode: symbols stay hidden wherever the selection is, and nothing can be typed. */
function reading(mode: Mode): Extension {
  return mode === 'reading'
    ? [readingFacet.of(true), EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [];
}

export function modeExtensions(mode: Mode, baseUri: string): Extension {
  return [previewCompartment.of(preview(mode, baseUri)), readingCompartment.of(reading(mode))];
}

export function setMode(view: EditorView, mode: Mode, baseUri: string): void {
  view.dispatch({
    effects: [
      previewCompartment.reconfigure(preview(mode, baseUri)),
      readingCompartment.reconfigure(reading(mode)),
    ],
  });
}
