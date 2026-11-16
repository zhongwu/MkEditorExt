import { Annotation, Compartment, EditorState, type ChangeSet, type Text } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import type { Mode } from '../src/protocol';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { formattingKeymap } from './commands';
import { gitGutter } from './gitGutter';
import { imageHandlers } from './imagePaste';
import { renderHtmlFacet } from './livePreview/blocks';
import { headingCompletion } from './livePreview/completion';
import { footnoteExtension } from './livePreview/footnotes';
import { lazyMarkdown } from './livePreview/languages';
import { linkAt } from './livePreview/links';
import { l10n } from './l10n';
import { mathExtension } from './livePreview/math';
import { engage, pristineField } from './livePreview/reveal';
import { livePreviewTheme } from './livePreview/theme';
import { modeExtensions } from './modes';
import { createVscodeSearchPanel, openFindPanel, searchPanelTheme } from './searchPanel';

/** Marks transactions that apply the host's text, so they aren't sent back as edits. */
export const remoteChange = Annotation.define<boolean>();

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  /** CSP nonce for the <style> elements CodeMirror creates. */
  nonce: string;
  /** The document's folder as a webview URI; relative image paths resolve against it. */
  baseUri: string;
  /** Draw raw HTML blocks (sanitized) instead of showing their source. */
  renderHtml: boolean;
  mode: Mode;
  onLocalChange(changes: ChangeSet, startDoc: Text, composing: boolean): void;
  onCompositionEnd?(): void;
  onHistory(command: 'undo' | 'redo'): void;
  onOpenLink(href: string): void;
  /** Image files pasted or dropped; `pos` is the drop position, or null for a paste. */
  onImages(files: File[], pos: number | null): void;
}

// Colors come from the VS Code theme, so light, dark and high-contrast all work.
// Prose uses `mdEditor.proseFontFamily` (set as --md-prose-font) or VS Code's UI font.
const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    fontSize: 'var(--vscode-editor-font-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--md-prose-font, var(--vscode-font-family))',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--vscode-editorCursor-foreground)' },
  '.cm-line': { padding: '0 24px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
  // The selection is drawn above the text: behind it, the current-line and code-block
  // backgrounds would cover it. It is translucent so the text stays readable.
  '.cm-selectionLayer': { zIndex: '1 !important', pointerEvents: 'none' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor:
      'color-mix(in srgb, var(--vscode-editor-selectionBackground) 60%, transparent)',
  },
  '.cm-selectionBackground': {
    backgroundColor:
      'color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 70%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor:
      'var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background))',
    color: 'var(--vscode-editorSuggestWidget-foreground, var(--vscode-foreground))',
    border:
      '1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-editorWidget-border, transparent))',
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 'var(--vscode-font-size)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor:
      'var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground))',
    color:
      'var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)))',
  },
  '.cm-completionDetail': {
    color: 'var(--vscode-descriptionForeground)',
    marginLeft: '0.6em',
  },
});

const highlightStyle = HighlightStyle.define([
  // Headings, emphasis, links and quotes are styled by the live preview (livePreview/theme.ts).
  { tag: tags.url, color: 'var(--vscode-textLink-activeForeground)' },
  { tag: tags.monospace, color: 'var(--vscode-textPreformat-foreground)' },
  {
    tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
    color: 'var(--vscode-descriptionForeground)',
  },
  // Tokens inside fenced code blocks.
  { tag: tags.keyword, color: 'var(--vscode-symbolIcon-keywordForeground)' },
  { tag: [tags.string, tags.regexp], color: 'var(--vscode-debugTokenExpression-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--vscode-debugTokenExpression-number)' },
  { tag: tags.comment, fontStyle: 'italic', color: 'var(--vscode-descriptionForeground)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--vscode-symbolIcon-functionForeground)',
  },
  { tag: tags.typeName, color: 'var(--vscode-symbolIcon-classForeground)' },
]);

const htmlCompartment = new Compartment();

/** From the first click or key press on, the symbols at the cursor are shown (see `pristineField`). */
function engageEditor(view: EditorView): void {
  if (view.state.field(pristineField, false)) view.dispatch({ effects: engage.of(null) });
}

/** Turns drawing of raw HTML blocks on or off in a running editor. */
export function setRenderHtml(view: EditorView, enabled: boolean): void {
  view.dispatch({ effects: htmlCompartment.reconfigure(renderHtmlFacet.of(enabled)) });
}

/** Puts the cursor at the start of a (zero-based) line and scrolls it to the top. */
export function revealLine(view: EditorView, line: number): void {
  const target = view.state.doc.line(Math.min(Math.max(line + 1, 1), view.state.doc.lines));
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 12 }),
  });
  view.focus();
}

export function createEditor(options: EditorOptions): EditorView {
  const markdownSupport = lazyMarkdown([mathExtension, footnoteExtension]);
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        EditorView.cspNonce.of(options.nonce),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        pristineField,
        gitGutter(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        // No history() and no history keymap: undo and redo belong to VS Code (PLAN.md §3.1).
        // VS Code's webview wrapper forwards Ctrl+Z / Ctrl+Y to the workbench, which undoes
        // the document; the result arrives as a `replace`.
        search({ top: true, createPanel: createVscodeSearchPanel }),
        highlightSelectionMatches(),
        headingCompletion,
        keymap.of([
          ...formattingKeymap,
          { key: 'Mod-f', run: (v) => openFindPanel(v, false), scope: 'editor search-panel' },
          { key: 'Ctrl-h', run: (v) => openFindPanel(v, true), scope: 'editor search-panel' },
          { key: 'Mod-Alt-f', run: (v) => openFindPanel(v, true), scope: 'editor search-panel' },
          ...searchKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        markdownSupport.extension,
        syntaxHighlighting(highlightStyle),
        modeExtensions(options.mode, options.baseUri),
        htmlCompartment.of(renderHtmlFacet.of(options.renderHtml)),
        imageHandlers(options.onImages),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': l10n.t('Markdown editor') }),
        theme,
        searchPanelTheme,
        livePreviewTheme,
        EditorView.domEventHandlers({
          // Ctrl+click (Cmd+click on macOS) opens a link, as in VS Code's own editor.
          // A plain click only places the cursor, so link text stays easy to edit.
          mousedown(event, view) {
            engageEditor(view);
            if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) {
              return false;
            }
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const href = pos === null ? undefined : linkAt(view.state, pos);
            if (!href) {
              return false;
            }
            event.preventDefault();
            options.onOpenLink(href);
            return true;
          },
          compositionend(_event, view) {
            setTimeout(() => {
              if (!view.composing) options.onCompositionEnd?.();
            }, 20);
            return false;
          },
          blur(_event, view) {
            setTimeout(() => {
              if (!view.composing) options.onCompositionEnd?.();
            }, 20);
            return false;
          },
          keydown(event, view) {
            engageEditor(view);
            if (!event.isComposing && event.keyCode !== 229 && !view.composing) {
              options.onCompositionEnd?.();
            }
            return false;
          },
          // Fallback if the browser's own undo reaches the editor (e.g. from a context menu):
          // never let it change the text directly; ask VS Code instead.
          beforeinput(event) {
            if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
              event.preventDefault();
              options.onHistory(event.inputType === 'historyUndo' ? 'undo' : 'redo');
              return true;
            }
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            if (tr.docChanged && !tr.annotation(remoteChange)) {
              const composing = update.view.composing || tr.isUserEvent('input.type.compose');
              options.onLocalChange(tr.changes, tr.startState.doc, composing);
            }
          }
        }),
      ],
    }),
  });
  markdownSupport.attach(view);
  // Open Find & Replace even when focus is in the toolbar or an edited table cell.
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const isMac = /Mac/.test(navigator.platform);
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && !event.shiftKey && (key === 'f' || (key === 'h' && !isMac))) {
      event.preventDefault();
      engageEditor(view);
      openFindPanel(view, key === 'h');
    }
  });
  // A link Ctrl/Cmd+clicked in a table cell (the table widget reports it).
  view.dom.addEventListener('md-open-link', (event) => {
    options.onOpenLink((event as CustomEvent<string>).detail);
  });
  return view;
}
