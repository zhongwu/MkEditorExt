# MkEditorExt

A live-preview Markdown editor for VS Code. Formatting is shown rendered as you type, and it **never rewrites parts of the file you didn't touch**.

> **Status: planning.** There is no code yet. The full design and roadmap are in [PLAN.md](PLAN.md).

## The idea

Open a `.md` file and edit it in a single tab that looks like the finished page: headings are large, bold is bold, and images, tables, checkboxes, math and diagrams appear in place. The Markdown symbols (`**`, `#`, `[text](url)`) show up only around the cursor, so you can still edit them directly. This is similar to Obsidian's Live Preview.

### Why another Markdown editor?

Most WYSIWYG Markdown editors convert your file into their own document format and write it back out when you save. That can quietly reformat lists, swap `*` for `_` or re-space tables, so changing one word produces a large Git diff.

This extension edits the file's text directly and draws the rendered look over it. **Change one word, and one word changes on disk.** Diffs stay small and easy to review.

## Planned features

- **Live mode:** rendered formatting, with symbols revealed only for the part you're editing.
- **Source mode:** plain Markdown with syntax highlighting. Also the recommended mode for screen readers.
- **Reading mode:** read-only and fully rendered.
- GitHub-style Markdown: tables, task lists, strikethrough and autolinks, plus math (KaTeX) and Mermaid diagrams.
- Clickable task checkboxes, each a one-character edit.
- A formatting toolbar and shortcuts, list continuation on Enter, and pasting images into an `assets/` folder.
- Insert images by pasting, by dropping a file while holding Shift, or with the Image button.
- Go to Heading (Ctrl/Cmd+Shift+O) and working `#anchor` links.
- Ctrl/Cmd+Alt+M switches to Source mode and back.
- Works with VS Code's own save, undo/redo, unsaved-changes marker, Git and Live Share.
- Follows your VS Code theme (light, dark and high contrast) and fonts.
- Export to HTML: one standalone page with images and math embedded.
- Export buttons (HTML, PDF) in the toolbar.
- Export to PDF with the Chrome or Edge you already have installed (`mdEditor.browserPath` if it is somewhere unusual).
- Edit table cells right in the rendered table; Tab moves to the next cell.
- Your own CSS for the editor (`mdEditor.customCss`).

## Roadmap

| Phase | Goal |
|---|---|
| 0 | Project setup; compare how other Markdown editors handle Git diffs |
| 1 | Editor core and reliable sync with VS Code |
| 2 | Live preview of inline formatting |
| 3 | Live preview of blocks: images, tables, checkboxes, math, diagrams |
| 4 | Editing helpers, modes and accessibility |
| 5 | Extras: table editing, HTML export, settings |
| 6 | Speed and reliability (large files, IME input, remote workspaces) |
| 7 | Testing and Marketplace release |

See [PLAN.md](PLAN.md) for details, architecture and risks.

## Using it

Once released, open any `.md` file, right-click its tab, choose **Reopen Editor With…**, then **Markdown Live Editor**. It won't replace VS Code's default editor unless you choose it as the default.

## Development

Requires Node.js 22 or later.

```sh
npm install
npm run build              # bundle the extension and webview into dist/
npm run watch              # rebuild on change
npm test                   # unit tests (Vitest)
npm run test:integration   # integration tests in a downloaded copy of VS Code
npm run lint               # ESLint
npm run typecheck          # TypeScript
```

To try it, open this folder in VS Code and press **F5**. In the new window, open a `.md` file, right-click its tab, choose **Reopen Editor With…**, then **Markdown Live Editor**.

| Folder | Contents |
|---|---|
| `src/` | Extension host: the custom editor provider and the host side of the sync |
| `webview/` | The editor inside the webview: CodeMirror setup and the webview side of the sync |
| `test/unit/` | Unit tests, including a randomized simulation of the sync |
| `test/integration/` | Tests that run inside VS Code |
