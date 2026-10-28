import type { EditorView } from '@codemirror/view';
import type { EditorSettings, HostMessage, Mode } from '../src/protocol';
import { commands } from './commands';
import { imageAlt, imageMarkdown } from '../src/images';
import { createEditor, remoteChange, revealLine, setRenderHtml } from './editor';
import { readBase64 } from './imagePaste';
import { configureAssets } from './livePreview/lazy';
import { drawDiagrams } from './livePreview/renderWidgets';
import './livePreview/shared';
import { setMode as applyModeToEditor } from './modes';
import { createToolbar } from './toolbar';
import { readSavedView, restoreView, trackView } from './viewState';
import { WebviewSync, minimalChange, normalizeLineEndings } from './sync';
import './styles/editor.css';

const vscode = acquireVsCodeApi();
// The bundle runs as a classic script, so currentScript is our own <script nonce="…">.
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';
const parent = document.getElementById('editor') as HTMLElement;
const toolbar = createToolbar(document.getElementById('toolbar') as HTMLElement, {
  run: (name) => {
    if (name === 'image') {
      vscode.postMessage({ type: 'chooseImage' });
    } else if (view) {
      commands[name](view);
      view.focus();
    }
  },
  exportAs: (format) => vscode.postMessage({ type: 'export', format }),
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
/** The user's own CSS (`mdEditor.customCss`), added after the editor's styles. */
const customStyle = document.head.appendChild(document.createElement('style'));
let mode: Mode = 'live';
let nextImageId = 1;
/** Images sent to the host and not yet saved, with where to put the link. */
const pendingImages = new Map<number, { alt: string; pos: number | null }>();

function sendImages(files: File[], pos: number | null): void {
  for (const file of files) {
    readBase64(file).then(
      (data) => {
        const id = nextImageId++;
        pendingImages.set(id, { alt: imageAlt(file.name), pos });
        vscode.postMessage({ type: 'pasteImage', id, name: file.name, mime: file.type, data });
      },
      () => undefined,
    );
  }
}

/** Inserts the link to a saved image, at the drop position or the cursor. */
function insertImage(id: number, path: string, alt?: string): void {
  // Id 0 is an image the user picked with Insert Image: it is linked at the cursor.
  const pending = pendingImages.get(id) ?? (alt === undefined ? undefined : { alt, pos: null });
  pendingImages.delete(id);
  if (!view || !pending || view.state.readOnly) {
    return;
  }
  const { doc, selection } = view.state;
  const at =
    pending.pos === null
      ? selection.main
      : { from: Math.min(pending.pos, doc.length), to: Math.min(pending.pos, doc.length) };
  const insert = imageMarkdown(pending.alt, path);
  view.dispatch({
    changes: { from: at.from, to: at.to, insert },
    selection: { anchor: at.from + insert.length },
    userEvent: 'input.paste',
  });
  view.focus();
}

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
  customStyle.textContent = settings.customCss;
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
  if (message.type === 'imageSaved') {
    insertImage(message.id, message.path, message.alt);
    return;
  }
  if (message.type === 'drawDiagrams') {
    void drawDiagrams(message.sources).then((svgs) =>
      vscode.postMessage({ type: 'diagrams', id: message.id, svgs }),
    );
    return;
  }
  if (message.type === 'revealLine') {
    if (view) {
      revealLine(view, message.line);
    }
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
      onImages: sendImages,
    });
    sync.reset(message.version);
    // Back from being hidden: the cursor and scroll position as they were.
    const saved = readSavedView(vscode.getState(), view.state.doc.length);
    if (saved) restoreView(view, saved);
    trackView(view, (state) => vscode.setState(state));
    view.focus();
    return;
  }
  const current = view;
  if (sync.receive(message, (text) => setText(current, text))) {
    vscode.postMessage({ type: 'ready' });
  }
});

vscode.postMessage({ type: 'ready' });
