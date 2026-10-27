import { EditorView } from '@codemirror/view';

const codeFont = 'var(--vscode-editor-font-family)';
const muted = 'var(--vscode-descriptionForeground)';

/**
 * Styles for the live preview. Colors and fonts come from the VS Code theme, so light, dark and
 * high-contrast themes all work. Nothing here changes size on reveal (PLAN.md §3.5).
 */
export const livePreviewTheme = EditorView.theme({
  '.cm-md-heading': { fontWeight: '600' },
  '.cm-md-h1': { fontSize: '1.6em' },
  '.cm-md-h2': { fontSize: '1.4em' },
  '.cm-md-h3': { fontSize: '1.2em' },
  '.cm-md-h4': { fontSize: '1.1em' },
  '.cm-md-h6': { color: muted },
  '.cm-md-setext-mark': { color: muted },

  '.cm-md-strong': { fontWeight: 'bold' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': {
    fontFamily: codeFont,
    fontSize: '0.92em',
    backgroundColor: 'var(--vscode-textCodeBlock-background)',
    borderRadius: '3px',
    padding: '0 2px',
  },
  '.cm-md-link': {
    color: 'var(--vscode-textLink-foreground)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },

  '.cm-line.cm-md-quote': {
    paddingLeft: '40px',
    // A bar in the left padding, drawn as a background so it costs no width.
    backgroundImage:
      'linear-gradient(to right, transparent 24px, var(--vscode-textBlockQuote-border) 24px, var(--vscode-textBlockQuote-border) 27px, transparent 27px)',
  },
  '.cm-md-bullet, .cm-md-listmark': { color: muted },

  '.cm-line.cm-md-codeblock': {
    fontFamily: codeFont,
    fontSize: '0.92em',
    backgroundColor: 'var(--vscode-textCodeBlock-background)',
  },
});
