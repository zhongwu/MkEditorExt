// The formatting toolbar and the mode switch above the editor (PLAN.md §5, Phase 4).
// Buttons are real <button>s with labels, so they work with the keyboard and screen readers.

import { MODES, type ExportFormat, type Mode } from '../src/protocol';
import { l10n } from './l10n';

export interface ToolbarActions {
  /** Runs a formatting command on the editor. */
  run(name: keyof typeof BUTTON_LABELS): void;
  setMode(mode: Mode): void;
  exportAs(format: ExportFormat): void;
}

const isMac = /Mac/.test(navigator.platform);
const mod = isMac ? 'Cmd' : 'Ctrl';

/** Visible text, the accessible name and the shortcut of each button. */
const BUTTON_LABELS = {
  bold: ['B', l10n.t('Bold'), `${mod}+B`],
  italic: ['I', l10n.t('Italic'), `${mod}+I`],
  strike: ['S', l10n.t('Strikethrough'), `${mod}+Shift+X`],
  code: ['</>', l10n.t('Inline code'), `${mod}+E`],
  h1: ['H1', l10n.t('Heading 1'), `${mod}+Alt+1`],
  h2: ['H2', l10n.t('Heading 2'), `${mod}+Alt+2`],
  h3: ['H3', l10n.t('Heading 3'), `${mod}+Alt+3`],
  bullet: ['•', l10n.t('Bulleted list'), `${mod}+Shift+8`],
  number: ['1.', l10n.t('Numbered list'), `${mod}+Shift+7`],
  task: ['☐', l10n.t('Task list'), ''],
  toggleTask: ['☑', l10n.t('Tick or untick task'), `${mod}+Enter`],
  quote: ['"', l10n.t('Quote'), `${mod}+Shift+9`],
  link: ['Link', l10n.t('Link'), `${mod}+Alt+K`],
  table: ['Table', l10n.t('Insert table'), ''],
  image: ['Image', l10n.t('Insert image from a file'), ''],
} satisfies Record<string, readonly [string, string, string]>;

const GROUPS: (keyof typeof BUTTON_LABELS)[][] = [
  ['bold', 'italic', 'strike', 'code'],
  ['h1', 'h2', 'h3'],
  ['bullet', 'number', 'task', 'toggleTask', 'quote'],
  ['link', 'table', 'image'],
];

const icon = (paths: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Buttons drawn as an icon instead of text; the label and tooltip still name them. */
const ICONS = {
  link: icon(
    '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>',
  ),
  table: icon(
    '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.5h12M2 9.8h12M6 3v10"/>',
  ),
  image: icon(
    '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.6" cy="6.3" r="1"/><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3"/>',
  ),
} as const;

/** A globe for the web page, a page with a folded corner for the PDF. */
const EXPORT_ICONS = {
  html: icon(
    '<circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c2 1.9 2.9 4 2.9 6.2S10 12.3 8 14.2M8 1.8C6 3.7 5.1 5.8 5.1 8S6 12.3 8 14.2"/>',
  ),
  pdf: icon(
    '<path d="M3.5 1.8h6l3 3v9.4h-9z"/><path d="M9.5 1.8v3h3M5.5 8h5M5.5 10.2h5M5.5 12.2h3"/>',
  ),
} as const satisfies Record<ExportFormat, string>;

const MODE_LABELS: Record<Mode, string> = {
  live: l10n.t('Live'),
  source: l10n.t('Source'),
  reading: l10n.t('Reading'),
};

export function createToolbar(container: HTMLElement, actions: ToolbarActions) {
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', l10n.t('Markdown formatting'));

  const formatButtons: HTMLButtonElement[] = [];
  for (const names of GROUPS) {
    const group = document.createElement('div');
    group.className = 'md-toolbar-group';
    for (const name of names) {
      const [text, label, shortcut] = BUTTON_LABELS[name];
      const button = document.createElement('button');
      button.type = 'button';
      if (name in ICONS) {
        // The icons are fixed markup written here, not from the document.
        button.innerHTML = ICONS[name as keyof typeof ICONS];
      } else {
        button.textContent = text;
      }
      button.setAttribute('aria-label', label);
      button.title = shortcut ? `${label} (${shortcut})` : label;
      // Keep the focus and the selection in the editor when a button is pressed.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => actions.run(name));
      group.append(button);
      formatButtons.push(button);
    }
    container.append(group);
  }

  const separator = document.createElement('div');
  separator.className = 'md-toolbar-separator';
  separator.setAttribute('role', 'separator');
  container.append(separator);

  // Exporting changes nothing in the document, so these stay enabled in Reading mode.
  const exports = document.createElement('div');
  exports.className = 'md-toolbar-group';
  for (const [format, label] of [
    ['html', l10n.t('Export to HTML')],
    ['pdf', l10n.t('Export to PDF')],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    // The icons are fixed markup written here, not from the document.
    button.innerHTML = EXPORT_ICONS[format];
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => actions.exportAs(format));
    exports.append(button);
  }
  container.append(exports);

  const modes = document.createElement('div');
  modes.className = 'md-toolbar-group md-toolbar-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', l10n.t('Editor mode'));
  const modeButtons = new Map<Mode, HTMLButtonElement>();
  for (const mode of MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = MODE_LABELS[mode];
    button.addEventListener('click', () => actions.setMode(mode));
    modes.append(button);
    modeButtons.set(mode, button);
  }
  container.append(modes);

  return {
    showMode(current: Mode): void {
      for (const [mode, button] of modeButtons) {
        button.setAttribute('aria-pressed', String(mode === current));
      }
      // Nothing can be changed in Reading mode.
      for (const button of formatButtons) button.disabled = current === 'reading';
    },
  };
}
