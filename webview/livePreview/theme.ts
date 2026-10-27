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

  '.cm-line.cm-md-frontmatter-source': { fontFamily: codeFont, fontSize: '0.92em', color: muted },

  '.cm-md-hr': {
    margin: '0.6em 24px',
    borderTop: '1px solid var(--vscode-textBlockQuote-border)',
  },

  '.cm-md-table': { borderCollapse: 'collapse', margin: '0.4em 24px' },
  '.cm-md-table th, .cm-md-table td': {
    border: '1px solid var(--vscode-textBlockQuote-border)',
    padding: '3px 10px',
  },
  '.cm-md-table th': {
    fontWeight: '600',
    backgroundColor: 'var(--vscode-textCodeBlock-background)',
  },
  '.cm-md-table code': {
    fontFamily: codeFont,
    fontSize: '0.92em',
    backgroundColor: 'var(--vscode-textCodeBlock-background)',
  },

  '.cm-md-frontmatter': {
    margin: '0.4em 24px',
    padding: '6px 12px',
    fontFamily: codeFont,
    fontSize: '0.9em',
    color: muted,
    border: '1px solid var(--vscode-textBlockQuote-border)',
    borderRadius: '4px',
  },
  '.cm-md-frontmatter-title': { fontWeight: '600', marginBottom: '2px' },
  '.cm-md-frontmatter-key': { marginRight: '0.6em', color: 'var(--vscode-editor-foreground)' },

  '.cm-md-image img': { maxWidth: '100%', verticalAlign: 'middle' },
  '.cm-md-image-below': { padding: '2px 24px' },
  '.cm-md-image-broken': { color: muted, fontStyle: 'italic' },

  '.cm-md-checkbox': {
    display: 'inline-block',
    width: '0.95em',
    height: '0.95em',
    marginRight: '0.4em',
    verticalAlign: '-0.1em',
    border: '1px solid var(--vscode-descriptionForeground)',
    borderRadius: '3px',
    cursor: 'pointer',
    boxSizing: 'border-box',
    textAlign: 'center',
    lineHeight: '0.9em',
    fontSize: '0.85em',
  },
  '.cm-md-checkbox-checked': {
    backgroundColor: 'var(--vscode-textLink-foreground)',
    borderColor: 'var(--vscode-textLink-foreground)',
    color: 'var(--vscode-editor-background)',
  },
  '.cm-md-checkbox-checked::after': { content: '"\u2713"' },

  '.cm-line.cm-md-codeblock': {
    fontFamily: codeFont,
    fontSize: '0.92em',
    backgroundColor: 'var(--vscode-textCodeBlock-background)',
  },
});
