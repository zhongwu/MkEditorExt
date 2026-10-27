import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const VIEW_TYPE = 'mdEditor.editor';

async function createFile(contents: string): Promise<vscode.Uri> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-'));
  const file = path.join(dir, 'test.md');
  fs.writeFileSync(file, contents);
  return vscode.Uri.file(file);
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

suite('Markdown Live Editor', () => {
  teardown(() => vscode.commands.executeCommand('workbench.action.closeAllEditors'));

  test('opens .md files with the custom editor', async () => {
    const uri = await createFile('# Hello\n');
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await waitFor(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom,
      'the custom editor tab',
    );
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as vscode.TabInputCustom;
    assert.strictEqual(input.viewType, VIEW_TYPE);
    assert.strictEqual(input.uri.toString(), uri.toString());
  });

  // The Phase 1 spike (PLAN.md §3.1): undo/redo must reach the document while the custom
  // editor is the active editor.
  test('VS Code undo and redo act on the document shown in the custom editor', async () => {
    const uri = await createFile('hello\n');
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    const document = await vscode.workspace.openTextDocument(uri);

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 5), ' world');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.strictEqual(document.getText(), 'hello world\n');

    await vscode.commands.executeCommand('undo');
    await waitFor(() => document.getText() === 'hello\n', 'undo');

    await vscode.commands.executeCommand('redo');
    await waitFor(() => document.getText() === 'hello world\n', 'redo');
  });

  test('keeps \\r\\n line endings when text with \\n is inserted', async () => {
    const uri = await createFile('a\r\nb\r\n');
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    const document = await vscode.workspace.openTextDocument(uri);

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(1, 1), '\nc');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.strictEqual(document.getText(), 'a\r\nb\r\nc\r\n');
  });
});
