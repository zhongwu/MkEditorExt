// The promise from PLAN.md §3.6 in the real editor: opening a file, typing, undoing everything and
// saving leaves the file exactly as it was, byte for byte, for every file in test/corpus.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const VIEW_TYPE = 'mdEditor.editor';
const corpusDir = path.join(__dirname, '..', '..', 'test', 'corpus');

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

suite('Corpus files', () => {
  teardown(() => vscode.commands.executeCommand('workbench.action.closeAllEditors'));

  for (const name of fs.readdirSync(corpusDir).filter((file) => file.endsWith('.md'))) {
    test(`${name}: open, type, undo, save leaves the bytes unchanged`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-corpus-'));
      const file = path.join(dir, name);
      fs.copyFileSync(path.join(corpusDir, name), file);
      // Images and other files the document points at, so nothing is reported as missing.
      for (const extra of fs.readdirSync(corpusDir)) {
        if (!extra.endsWith('.md') && fs.statSync(path.join(corpusDir, extra)).isFile()) {
          fs.copyFileSync(path.join(corpusDir, extra), path.join(dir, extra));
        }
      }
      const before = fs.readFileSync(file);
      const uri = vscode.Uri.file(file);

      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor(
        () =>
          vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom,
        'the custom editor tab',
      );
      const document = await vscode.workspace.openTextDocument(uri);
      // Give the page time to start: if it edited the text on its own, it would show here.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.strictEqual(document.isDirty, false, 'opening changed the document');
      assert.strictEqual(Buffer.from(document.getText()).equals(before), true);

      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), 'x');
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.strictEqual(document.getText().startsWith('x'), true);

      await vscode.commands.executeCommand('undo');
      await waitFor(() => !document.getText().startsWith('x'), 'undo');
      assert.ok(await document.save());

      assert.strictEqual(fs.readFileSync(file).equals(before), true, 'the saved bytes differ');
    });
  }
});
