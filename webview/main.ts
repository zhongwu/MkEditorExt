import type { EditorView } from '@codemirror/view';
import type { HostMessage } from '../src/protocol';
import { createEditor, remoteChange } from './editor';
import { WebviewSync, minimalChange, normalizeLineEndings } from './sync';
import './styles/editor.css';

const vscode = acquireVsCodeApi();
// The bundle runs as a classic script, so currentScript is our own <script nonce="…">.
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';
const parent = document.getElementById('editor') as HTMLElement;

const sync = new WebviewSync((message) => vscode.postMessage(message));
let view: EditorView | undefined;

/** Replaces the editor's text with the host's, changing only the part that differs. */
function setText(view: EditorView, text: string): void {
  const change = minimalChange(view.state.doc.toString(), text);
  if (change) {
    view.dispatch({ changes: change, annotations: remoteChange.of(true) });
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (!view) {
    if (message.type !== 'init') {
      return;
    }
    view = createEditor({
      parent,
      doc: normalizeLineEndings(message.text),
      nonce,
      onLocalChange: (changes, startDoc) => sync.localChange(changes, startDoc),
      onHistory: (command) => vscode.postMessage({ type: command }),
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
