import * as vscode from 'vscode';
import { DocumentSync } from './DocumentSync';
import { isWebviewMessage, type TextChange } from './protocol';
import { getNonce } from './util/nonce';

export class MdEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'mdEditor.editor';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      MdEditorProvider.viewType,
      new MdEditorProvider(context.extensionUri),
      { supportsMultipleEditorsPerDocument: true },
    );
  }

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist');
    webview.options = { enableScripts: true, localResourceRoots: [distUri] };
    webview.html = this.getHtml(webview, distUri);

    const sync = new DocumentSync(document, {
      applyEdit: (changes) => vscode.workspace.applyEdit(toWorkspaceEdit(document.uri, changes)),
      post: (message) => void webview.postMessage(message),
      executeCommand: (command) => void vscode.commands.executeCommand(command),
    });

    const subscriptions = [
      webview.onDidReceiveMessage((message: unknown) => {
        if (isWebviewMessage(message)) {
          void sync.handleMessage(message);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Events with no content changes only report a dirty-state change.
        if (event.document === document && event.contentChanges.length > 0) {
          sync.onDocumentChanged();
        }
      }),
    ];
    panel.onDidDispose(() => subscriptions.forEach((s) => s.dispose()));
  }

  private getHtml(webview: vscode.Webview, distUri: vscode.Uri): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      // CodeMirror adds its own <style> elements, tagged with the nonce (EditorView.cspNonce).
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
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
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
