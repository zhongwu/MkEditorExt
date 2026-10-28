import * as vscode from 'vscode';
import { MdEditorProvider } from './MdEditorProvider';
import type { Mode } from './protocol';

const MODE_CHOICES: { label: string; description: string; mode: Mode }[] = [
  { label: 'Live', description: 'Formatted as you type; symbols show at the cursor', mode: 'live' },
  { label: 'Source', description: 'Plain Markdown, nothing hidden', mode: 'source' },
  { label: 'Reading', description: 'Formatted and read-only', mode: 'reading' },
];

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MdEditorProvider(context.extensionUri, context.workspaceState);
  const needsEditor = () =>
    vscode.window.showInformationMessage('Click in a Markdown Live Editor tab first.');
  context.subscriptions.push(
    provider.register(),
    vscode.commands.registerCommand('mdEditor.setMode', async () => {
      const choice = await vscode.window.showQuickPick(MODE_CHOICES, {
        title: 'Markdown Live Editor mode',
      });
      if (choice && !provider.setActiveMode(choice.mode)) {
        void needsEditor();
      }
    }),
    // One shortcut to and from plain Markdown, the mode that suits screen readers best.
    vscode.commands.registerCommand('mdEditor.toggleSource', () => {
      const mode = provider.activeMode();
      if (!mode) {
        void needsEditor();
        return;
      }
      provider.setActiveMode(mode === 'source' ? 'live' : 'source');
    }),
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
