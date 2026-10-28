import type { EditorView } from '@codemirror/view';
import type { EditorSettings, HostMessage, Mode } from '../src/protocol';
import { commands } from './commands';
import { createEditor, remoteChange, setRenderHtml } from './editor';
import { configureAssets } from './livePreview/lazy';
import './livePreview/shared';
import { setMode as applyModeToEditor } from './modes';
import { createToolbar } from './toolbar';
import { WebviewSync, minimalChange, normalizeLineEndings } from './sync';
import './styles/editor.css';

const vscode = acquireVsCodeApi();
// The bundle runs as a classic script, so currentScript is our own <script nonce="…">.
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';
const parent = document.getElementById('editor') as HTMLElement;
const toolbar = createToolbar(document.getElementById('toolbar') as HTMLElement, {
  run: (name) => {
    if (view) {
      commands[name](view);
      view.focus();
    }
  },
  setMode: (mode) => {
    changeMode(mode);
    vscode.postMessage({ type: 'setMode', mode });
  },
});
// KaTeX and Mermaid are separate bundles next to this one, loaded when a document needs them.
configureAssets({
  base: (document.currentScript as HTMLScriptElement | null)?.src.replace(/[^/]*$/, '') ?? '',
  nonce,
});

const sync = new WebviewSync((message) => vscode.postMessage(message));
let view: EditorView | undefined;
let baseUri = '';
let renderHtml = false;
let mode: Mode = 'live';

function changeMode(next: Mode): void {
  mode = next;
  toolbar.showMode(mode);
  if (view) {
    applyModeToEditor(view, mode, baseUri);
  }
}

/** Replaces the editor's text with the host's, changing only the part that differs. */
function setText(view: EditorView, text: string): void {
  const change = minimalChange(view.state.doc.toString(), text);
  if (change) {
    view.dispatch({ changes: change, annotations: remoteChange.of(true) });
  }
}

function applySettings(settings: EditorSettings): void {
  baseUri = settings.baseUri;
  if (view && renderHtml !== settings.renderHtml) {
    setRenderHtml(view, settings.renderHtml);
  }
  renderHtml = settings.renderHtml;
  const root = document.documentElement.style;
  if (settings.proseFontFamily) {
    root.setProperty('--md-prose-font', settings.proseFontFamily);
  } else {
    root.removeProperty('--md-prose-font');
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === 'settings') {
    applySettings(message.settings);
    return;
  }
  if (message.type === 'mode') {
    changeMode(message.mode);
    return;
  }
  if (!view) {
    if (message.type !== 'init') {
      return;
    }
    view = createEditor({
      parent,
      doc: normalizeLineEndings(message.text),
      nonce,
      baseUri,
      renderHtml,
      mode,
      onLocalChange: (changes, startDoc) => sync.localChange(changes, startDoc),
      onHistory: (command) => vscode.postMessage({ type: command }),
      onOpenLink: (href) => vscode.postMessage({ type: 'openLink', href }),
    });
    sync.reset(message.version);
    view.focus();
    return;
  }
  const current = view;
  if (sync.receive(message, (text) => setText(current, text))) {
    vscode.postMessage({ type: 'ready' });
  }
});

vscode.postMessage({ type: 'ready' });
