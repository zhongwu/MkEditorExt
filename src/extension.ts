import * as vscode from 'vscode';
import { MdEditorProvider } from './MdEditorProvider';
import { exportHtml, exportPdf } from './exportCommand';
import type { Mode } from './protocol';

const MODE_CHOICES: { label: string; description: string; mode: Mode }[] = [
  { label: 'Live', description: 'Formatted as you type; symbols show at the cursor', mode: 'live' },
  { label: 'Source', description: 'Plain Markdown, nothing hidden', mode: 'source' },
  { label: 'Reading', description: 'Formatted and read-only', mode: 'reading' },
];

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MdEditorProvider(context.extensionUri, context.workspaceState);
  const needsEditor = () =>
    vscode.window.showInformationMessage('Click in a Markdown Minimal Diff Editor tab first.');
  // Exports the focused Markdown Minimal Diff Editor, or else the Markdown file in the text editor.
  const runExport = (run: typeof exportHtml) => {
    const textEditor = vscode.window.activeTextEditor;
    const document =
      provider.activeDocument() ??
      (textEditor?.document.languageId === 'markdown' ? textEditor.document : undefined);
    if (!document) {
      void vscode.window.showInformationMessage('Open a Markdown file first.');
      return;
    }
    return run(context.extensionUri, document, (sources) =>
      provider.drawDiagrams(document, sources),
    );
  };
  context.subscriptions.push(
    provider.register(),
    vscode.commands.registerCommand('mdEditor.setMode', async () => {
      const choice = await vscode.window.showQuickPick(MODE_CHOICES, {
        title: 'Markdown Minimal Diff Editor mode',
      });
      if (choice && !provider.setActiveMode(choice.mode)) {
        void needsEditor();
      }
    }),
    vscode.commands.registerCommand('mdEditor.goToHeading', async () => {
      if (!(await provider.goToHeading())) {
        void needsEditor();
      }
    }),
    vscode.commands.registerCommand('mdEditor.exportHtml', () => runExport(exportHtml)),
    vscode.commands.registerCommand('mdEditor.exportPdf', () => runExport(exportPdf)),
    vscode.commands.registerCommand('mdEditor.insertImage', async () => {
      if (!(await provider.insertImage())) {
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
