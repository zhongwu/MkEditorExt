// The formatting toolbar and the mode switch above the editor (PLAN.md §5, Phase 4).
// Buttons are real <button>s with labels, so they work with the keyboard and screen readers.

import { MODES, type Mode } from '../src/protocol';

export interface ToolbarActions {
  /** Runs a formatting command on the editor. */
  run(name: keyof typeof BUTTON_LABELS): void;
  setMode(mode: Mode): void;
}

const isMac = /Mac/.test(navigator.platform);
const mod = isMac ? 'Cmd' : 'Ctrl';

/** Visible text, the accessible name and the shortcut of each button. */
const BUTTON_LABELS = {
  bold: ['B', 'Bold', `${mod}+B`],
  italic: ['I', 'Italic', `${mod}+I`],
  strike: ['S', 'Strikethrough', `${mod}+Shift+X`],
  code: ['</>', 'Inline code', `${mod}+E`],
  h1: ['H1', 'Heading 1', `${mod}+Alt+1`],
  h2: ['H2', 'Heading 2', `${mod}+Alt+2`],
  h3: ['H3', 'Heading 3', `${mod}+Alt+3`],
  bullet: ['•', 'Bulleted list', `${mod}+Shift+8`],
  number: ['1.', 'Numbered list', `${mod}+Shift+7`],
  task: ['☐', 'Task list', ''],
  toggleTask: ['☑', 'Tick or untick task', `${mod}+Enter`],
  quote: ['"', 'Quote', `${mod}+Shift+9`],
  link: ['Link', 'Link', `${mod}+K`],
  table: ['Table', 'Insert table', ''],
  image: ['Image', 'Insert image from a file', ''],
} as const satisfies Record<string, readonly [string, string, string]>;

const GROUPS: (keyof typeof BUTTON_LABELS)[][] = [
  ['bold', 'italic', 'strike', 'code'],
  ['h1', 'h2', 'h3'],
  ['bullet', 'number', 'task', 'toggleTask', 'quote'],
  ['link', 'table', 'image'],
];

const MODE_LABELS: Record<Mode, string> = { live: 'Live', source: 'Source', reading: 'Reading' };

export function createToolbar(container: HTMLElement, actions: ToolbarActions) {
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', 'Markdown formatting');

  const formatButtons: HTMLButtonElement[] = [];
  for (const names of GROUPS) {
    const group = document.createElement('div');
    group.className = 'md-toolbar-group';
    for (const name of names) {
      const [text, label, shortcut] = BUTTON_LABELS[name];
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
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

  const modes = document.createElement('div');
  modes.className = 'md-toolbar-group md-toolbar-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Editor mode');
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
