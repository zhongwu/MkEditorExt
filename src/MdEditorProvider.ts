import * as vscode from 'vscode';
import { DocumentSync } from './DocumentSync';
import { findAnchor, findHeadings } from './headings';
import { classifyLink } from './links';
import { pickImage, saveImage } from './saveImage';
import {
  MODES,
  isWebviewMessage,
  type EditorSettings,
  type HostMessage,
  type Mode,
  type TextChange,
} from './protocol';
import { getNonce } from './util/nonce';

/** Where the last mode the user picked is remembered, per workspace. */
const MODE_KEY = 'mdEditor.mode';

/** One open editor: its panel and the mode it is showing. */
interface OpenEditor {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  post(message: HostMessage): void;
  chooseImage(): Promise<void>;
  mode: Mode;
}

export class MdEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'mdEditor.editor';

  private readonly editors = new Set<OpenEditor>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceState: vscode.Memento,
  ) {}

  register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(MdEditorProvider.viewType, this, {
      supportsMultipleEditorsPerDocument: true,
    });
  }

  /** The mode of the editor that has focus, or undefined if none does. */
  activeMode(): Mode | undefined {
    return this.activeEditor()?.mode;
  }

  /** Switches the editor that has focus; returns false if there isn't one. */
  setActiveMode(mode: Mode): boolean {
    const editor = this.activeEditor();
    if (!editor) {
      return false;
    }
    editor.mode = mode;
    void this.workspaceState.update(MODE_KEY, mode);
    editor.post({ type: 'mode', mode });
    return true;
  }

  /** Lets the user pick a heading in the focused editor and jumps there. */
  async goToHeading(): Promise<boolean> {
    const editor = this.activeEditor();
    if (!editor) {
      return false;
    }
    const headings = findHeadings(editor.document.getText());
    if (headings.length === 0) {
      void vscode.window.showInformationMessage('This document has no headings.');
      return true;
    }
    const choice = await vscode.window.showQuickPick(
      headings.map((heading) => ({
        label: `${'    '.repeat(heading.level - 1)}${heading.text || '(empty heading)'}`,
        description: `H${heading.level}`,
        line: heading.line,
      })),
      { title: 'Go to heading', matchOnDescription: false },
    );
    if (choice) {
      editor.post({ type: 'revealLine', line: choice.line });
    }
    return true;
  }

  /** Lets the user pick an image for the focused editor; returns false if none has focus. */
  async insertImage(): Promise<boolean> {
    const editor = this.activeEditor();
    if (!editor) {
      return false;
    }
    await editor.chooseImage();
    return true;
  }

  private activeEditor(): OpenEditor | undefined {
    return [...this.editors].find((editor) => editor.panel.active);
  }

  private initialMode(): Mode {
    const remembered = this.workspaceState.get<Mode>(MODE_KEY);
    if (remembered && MODES.includes(remembered)) {
      return remembered;
    }
    return vscode.workspace.getConfiguration('mdEditor').get<Mode>('defaultMode', 'live');
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const documentFolder = vscode.Uri.joinPath(document.uri, '..');
    // Images may sit next to the document or anywhere in the workspace.
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        distUri,
        documentFolder,
        ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
      ],
    };
    webview.html = this.getHtml(webview, distUri);

    const post = (message: HostMessage) => void webview.postMessage(message);
    const sync = new DocumentSync(document, {
      applyEdit: (changes) => vscode.workspace.applyEdit(toWorkspaceEdit(document.uri, changes)),
      post,
      executeCommand: (command) => void vscode.commands.executeCommand(command),
    });

    const editor: OpenEditor = {
      panel,
      document,
      post,
      async chooseImage() {
        const image = await pickImage(documentFolder);
        if (image) {
          post({ type: 'imageSaved', id: 0, ...image });
        }
      },
      mode: this.initialMode(),
    };
    this.editors.add(editor);

    const subscriptions = [
      webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewMessage(message)) {
          return;
        }
        if (message.type === 'setMode') {
          editor.mode = message.mode;
          void this.workspaceState.update(MODE_KEY, message.mode);
          return;
        }
        if (message.type === 'openLink') {
          void openLink(document, message.href, editor);
          return;
        }
        if (message.type === 'chooseImage') {
          void editor.chooseImage();
          return;
        }
        if (message.type === 'pasteImage') {
          void saveImage(documentFolder, message).then((path) => {
            if (path) {
              post({ type: 'imageSaved', id: message.id, path });
            }
          });
          return;
        }
        if (message.type === 'ready') {
          post({ type: 'mode', mode: editor.mode });
          post({ type: 'settings', settings: readSettings(webview, documentFolder) });
        }
        void sync.handleMessage(message);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Events with no content changes only report a dirty-state change.
        if (event.document === document && event.contentChanges.length > 0) {
          sync.onDocumentChanged();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('mdEditor')) {
          post({ type: 'settings', settings: readSettings(webview, documentFolder) });
        }
      }),
    ];
    panel.onDidDispose(() => {
      this.editors.delete(editor);
      subscriptions.forEach((s) => s.dispose());
    });
  }

  private getHtml(webview: vscode.Webview, distUri: vscode.Uri): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      // Inline styles are needed by CodeMirror, KaTeX and Mermaid; scripts stay locked to the nonce.
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Markdown Live Editor</title>
</head>
<body>
  <div id="toolbar"></div>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function readSettings(webview: vscode.Webview, documentFolder: vscode.Uri): EditorSettings {
  const config = vscode.workspace.getConfiguration('mdEditor');
  return {
    proseFontFamily: config.get<string>('proseFontFamily', ''),
    baseUri: webview.asWebviewUri(documentFolder).toString(),
    renderHtml: config.get<boolean>('renderHtml', false),
  };
}

/** Opens a Ctrl/Cmd+clicked link: web links in the browser, file links in VS Code. */
async function openLink(
  document: vscode.TextDocument,
  href: string,
  editor: OpenEditor,
): Promise<void> {
  const documentUri = document.uri;
  const target = classifyLink(href);
  if (!target) {
    void vscode.window.showWarningMessage(`This link type can't be opened: ${href}`);
    return;
  }
  switch (target.kind) {
    case 'external':
      await vscode.env.openExternal(vscode.Uri.parse(target.url));
      return;
    case 'file': {
      let uri: vscode.Uri;
      if (/^[a-zA-Z]:[\\/]/.test(target.path)) {
        uri = vscode.Uri.file(target.path);
      } else if (target.path.startsWith('/')) {
        // Absolute links are relative to the workspace folder, as on GitHub.
        const root = vscode.workspace.getWorkspaceFolder(documentUri)?.uri;
        uri = root
          ? vscode.Uri.joinPath(root, target.path)
          : vscode.Uri.joinPath(documentUri, '..', target.path);
      } else {
        uri = vscode.Uri.joinPath(documentUri, '..', target.path);
      }
      await vscode.commands.executeCommand('vscode.open', uri);
      return;
    }
    case 'anchor': {
      const heading = findAnchor(findHeadings(document.getText()), target.fragment);
      if (heading) {
        editor.post({ type: 'revealLine', line: heading.line });
      }
      return;
    }
  }
}

function toWorkspaceEdit(uri: vscode.Uri, changes: readonly TextChange[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  for (const { range, text } of changes) {
    edit.replace(
      uri,
      new vscode.Range(
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character,
      ),
      text,
    );
  }
  return edit;
}
