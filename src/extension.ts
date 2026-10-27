import * as vscode from 'vscode';
import { MdEditorProvider } from './MdEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    MdEditorProvider.register(context),
    vscode.commands.registerCommand('mdEditor.openEditor', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showInformationMessage('Open a Markdown file first.');
        return;
      }
      return vscode.commands.executeCommand('vscode.openWith', target, MdEditorProvider.viewType);
    }),
  );
}

export function deactivate(): void {}
