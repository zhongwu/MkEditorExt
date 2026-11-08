// Change bars at the left of the editor for a file under Git: green for added lines, blue for
// changed ones and a red mark where lines were removed, as in VS Code's own editor. The host sends
// the committed text; the comparison is done here, a moment after the last keystroke.

import {
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from '@codemirror/view';
import { diffLines } from '../src/lineDiff';
import { normalizeLineEndings } from './sync';

class ChangeMarker extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
  eq(other: ChangeMarker): boolean {
    return other.elementClass === this.elementClass;
  }
}

const added = new ChangeMarker('cm-git-added');
const modified = new ChangeMarker('cm-git-modified');
const deletedAbove = new ChangeMarker('cm-git-deleted-above');
const deletedBelow = new ChangeMarker('cm-git-deleted-below');

/** The committed text, or null if the file is not in Git. */
const setBase = StateEffect.define<string | null>();
const setMarkers = StateEffect.define<RangeSet<GutterMarker>>();

const baseField = StateField.define<string[] | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBase)) {
        return effect.value === null ? null : normalizeLineEndings(effect.value).split('\n');
      }
    }
    return value;
  },
});

const markersField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMarkers)) return effect.value;
    }
    // Until the next comparison, the bars follow the lines they were drawn on.
    return tr.docChanged ? value.map(tr.changes) : value;
  },
});

function markersFor(state: EditorState): RangeSet<GutterMarker> {
  const base = state.field(baseField);
  if (!base) return RangeSet.empty;
  const { doc } = state;
  const lines: string[] = [];
  for (const line of doc.iterLines()) lines.push(line);
  const ranges: Range<GutterMarker>[] = [];
  for (const change of diffLines(base, lines)) {
    if (change.kind === 'deleted') {
      // Between line `at` and the next one: marked on the line below, or the last line's bottom.
      if (change.at < doc.lines) {
        ranges.push(deletedAbove.range(doc.line(change.at + 1).from));
      } else {
        ranges.push(deletedBelow.range(doc.line(doc.lines).from));
      }
      continue;
    }
    const marker = change.kind === 'added' ? added : modified;
    for (let n = change.from + 1; n <= change.to; n++) ranges.push(marker.range(doc.line(n).from));
  }
  return RangeSet.of(ranges, true);
}

const COMPARE_DELAY_MS = 250;

const compare = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      const baseChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setBase)));
      if (baseChanged) {
        this.run(0);
      } else if (update.docChanged) {
        this.run(COMPARE_DELAY_MS);
      }
    }
    run(delay: number) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.view.dispatch({ effects: setMarkers.of(markersFor(this.view.state)) });
      }, delay);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);

const deletedColor = 'var(--vscode-editorGutter-deletedBackground, #f14c4c)';
const gitTheme = EditorView.theme({
  // CodeMirror's default gutter background (light grey) and border would show as a white strip.
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'inherit' },
  '.cm-git-gutter': { width: '4px', marginRight: '2px' },
  '.cm-git-gutter .cm-gutterElement': { width: '100%', padding: '0' },
  '.cm-git-added': { backgroundColor: 'var(--vscode-editorGutter-addedBackground, #2ea043)' },
  '.cm-git-modified': { backgroundColor: 'var(--vscode-editorGutter-modifiedBackground, #0078d4)' },
  '.cm-git-deleted-above': {
    backgroundImage: `linear-gradient(${deletedColor}, ${deletedColor})`,
    backgroundSize: '100% 3px',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'top',
  },
  '.cm-git-deleted-below': {
    backgroundImage: `linear-gradient(${deletedColor}, ${deletedColor})`,
    backgroundSize: '100% 3px',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'bottom',
  },
});

export function gitGutter(): Extension {
  return [
    baseField,
    markersField,
    compare,
    gutter({
      class: 'cm-git-gutter',
      markers: (view) => view.state.field(markersField),
    }),
    gitTheme,
  ];
}

/** Gives the editor the committed text of its file, or null if the file is not in Git. */
export function setGitBase(view: EditorView, text: string | null): void {
  view.dispatch({ effects: setBase.of(text) });
}
