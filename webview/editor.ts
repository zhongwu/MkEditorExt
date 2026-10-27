import { Annotation, EditorState, type ChangeSet, type Text } from '@codemirror/state';
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
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';

/** Marks transactions that apply the host's text, so they aren't sent back as edits. */
export const remoteChange = Annotation.define<boolean>();

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  /** CSP nonce for the <style> elements CodeMirror creates. */
  nonce: string;
  onLocalChange(changes: ChangeSet, startDoc: Text): void;
  onHistory(command: 'undo' | 'redo'): void;
}

// Colors come from the VS Code theme, so light, dark and high-contrast all work.
// Phase 2 replaces this with the live-preview styling.
const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    fontSize: 'var(--vscode-editor-font-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: '1.6' },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--vscode-editorCursor-foreground)' },
  '.cm-line': { padding: '0 24px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--vscode-editor-selectionBackground)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--vscode-editor-inactiveSelectionBackground)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)',
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'bold', color: 'var(--vscode-textLink-foreground)' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--vscode-textLink-foreground)' },
  { tag: tags.url, color: 'var(--vscode-textLink-activeForeground)' },
  { tag: tags.monospace, color: 'var(--vscode-textPreformat-foreground)' },
  { tag: tags.quote, fontStyle: 'italic', color: 'var(--vscode-descriptionForeground)' },
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

export function createEditor(options: EditorOptions): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        EditorView.cspNonce.of(options.nonce),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        // No history() and no history keymap: undo and redo belong to VS Code (PLAN.md §3.1).
        // VS Code's webview wrapper forwards Ctrl+Z / Ctrl+Y to the workbench, which undoes
        // the document; the result arrives as a `replace`.
        keymap.of([...defaultKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(highlightStyle),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown source' }),
        theme,
        EditorView.domEventHandlers({
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
              options.onLocalChange(tr.changes, tr.startState.doc);
            }
          }
        }),
      ],
    }),
  });
}
