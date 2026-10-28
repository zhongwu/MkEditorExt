# Development plan: Markdown live-preview editor for VS Code

## 1. What we're building and why it's different

A **live-preview Markdown editor**, in the style of Obsidian's Live Preview, that opens `.md` files in a single VS Code tab. Formatting is shown rendered as you type: headings are large, bold is bold, images, tables and checkboxes appear in place. The Markdown symbols (`**`, `#`, `[text](url)`) appear only around the cursor, so you can still edit them directly.

**The promise that sets it apart: the editor never rewrites parts of the file you didn't touch.** Editing one word changes one word on disk, with no reformatted lists, swapped `*`/`_` or re-spaced tables. Git diffs stay small and reviewable.

This is possible because the editor works on the **file text itself**, not on a converted document. CodeMirror 6 keeps the text, and the rendered look is drawn on top of it with decorations. Most WYSIWYG editors parse the file into a document tree and write it back out, which is where unwanted rewrites come from.

### Where it sits

| | Edits the file text directly | Rendered while editing | Notes |
|---|---|---|---|
| VS Code text editor + preview (`Ctrl+K V`) | Yes | No, preview is separate | Two panes, preview is read-only. |
| VS Code built-in "Markdown Editor" (since ~1.135) | Unverified | Yes | Early reviews mention text shifting and line-ending display problems. |
| Marketplace WYSIWYG extensions (Vditor-, Milkdown-based) | Usually no | Yes | Built on editors that convert and re-serialize the document. |
| **This extension** | **Yes** | **Yes** | Rendered look over the original text. |

The "Unverified" and "Usually no" cells are assumptions. **Phase 0 checks them** before any real work starts (see §5).

### Main design choice

A `CustomTextEditorProvider` whose webview runs CodeMirror 6. VS Code's `TextDocument` stays the single source of truth, so save, unsaved-changes markers, Git diff, Live Share, and (once handed to VS Code, §3.1) undo/redo keep working.

### Non-goals (for v1)

- Notion-style block editing (drag handles, slash menus that restructure the document).
- Real-time collaborative editing beyond what Live Share already gives through `TextDocument`.
- PDF export.
- MDX rendering, or Markdown dialects beyond CommonMark + GitHub-style extensions, math and the diagram/footnote/alert syntax listed in Phase 3.
- A rendered view inside diff editors; diffs keep opening as text.
- Niche features (e.g. `[[wiki links]]`, backlinks, docs-site admonitions). Choose one after v1, based on who actually uses it.

## 2. Tech stack

- **Language:** TypeScript. Bundle the extension host and the webview separately with **esbuild**.
- **VS Code version:** `engines.vscode` at least `^1.74`, so activation events are generated from `contributes` automatically.
- **Editor:** **CodeMirror 6**, *without* its `history()` extension (undo belongs to VS Code, see §3.1).
- **Markdown parsing:** `@codemirror/lang-markdown` (Lezer Markdown parser) with the GFM extensions (tables, task lists, strikethrough, autolinks), plus a small parser extension of our own for `$math$` / `$$math$$`. The parser gives a syntax tree with exact positions in the text, and parses incrementally as you type.
- **Code blocks:** highlighted in place by CodeMirror's nested language support (`@codemirror/language-data`, languages loaded on demand). No separate highlighter needed.
- **Widgets:** **KaTeX** for math, **Mermaid** for diagrams. Both are loaded only when a file uses them.
- **Export only:** **markdown-it** to produce HTML for "Export to HTML". It is not used for editing.
- **Safety:** **DOMPurify** for any HTML we render (raw HTML blocks when enabled, export), plus a strict Content Security Policy (CSP) with a nonce.
- **Testing:** **Vitest** for the sync logic, the live-preview decorations and the editing commands; `@vscode/test-electron` for host integration tests; **vscode-extension-tester** for a few end-to-end tests that type into the webview.
- **Packaging:** `@vscode/vsce` to publish to the VS Code Marketplace; `ovsx` to publish to Open VSX.
- **Web support (optional, cheap):** keep host code free of Node-only APIs (use `vscode.workspace.fs`, not `fs`) and add a `browser` entry so the extension also runs on vscode.dev and github.dev.

## 3. Architecture

```
┌──────────── Extension Host ───────────────────┐        ┌──────────── Webview (browser) ─────────────┐
│ extension.ts  → registers provider & commands │        │ main.ts                                    │
│ MdEditorProvider (CustomTextEditorProvider)   │        │  ├─ CodeMirror 6 (no history)              │
│  └─ creates one DocumentSync per open editor  │◄──────►│  ├─ sync.ts (one edit in flight)           │
│ DocumentSync (no direct vscode.window use)    │ post-  │  ├─ markdownLang (Lezer + GFM + math)      │
│  ├─ owns vscode.TextDocument (source of truth)│ Message│  ├─ livePreview/ (decorations + widgets)   │
│  ├─ applies edits one at a time               │        │  ├─ commands (toolbar, shortcuts)          │
│  └─ sends outside changes → webview           │        │  └─ modes (Live / Source / Reading)        │
│ images base URI, paste-image writes, export   │        │                                            │
└───────────────────────────────────────────────┘        └────────────────────────────────────────────┘
```

`DocumentSync` takes the document, a function that applies edits and a function that posts messages, so it can be unit-tested with fakes instead of a real webview.

### 3.1 Who owns what

- **The file's text:** `TextDocument` is the only source of truth. CodeMirror is a view of it.
- **Undo/redo:** CodeMirror's history is turned off and nothing in the webview binds `Mod-z` / `Mod-y`. VS Code's webview wrapper already blocks the browser's own undo for these keys and passes them to the workbench, which runs `undo` / `redo` on the custom editor's document. The result comes back to the webview as an outside change (§3.4), so undo history survives the webview being hidden and recreated. As a fallback, a `beforeinput` event of type `historyUndo` / `historyRedo` (e.g. from a context menu) is blocked and sent to the host as `undo` / `redo`, which runs the VS Code commands. **Phase 1 spike:** the command path is covered by an integration test; the keyboard path needs the manual check listed in Phase 1.
- **Cursor, selection, scroll position and mode:** owned by the webview, saved with `getState` / `setState`. The chosen mode is also remembered per workspace by the host.

### 3.2 Messages

Webview → host:

| Message | Contents |
|---|---|
| `ready` | Sent once the webview has loaded. |
| `edit` | `{ id, baseVersion, changes: [{ range: { start: {line, character}, end: {line, character} }, text }] }` |
| `undo` / `redo` | — |
| `openLink` | `{ href }`. The host opens http/https/mailto links in the browser and relative file links in VS Code, and refuses other schemes (`command:`, `file:` …). |
| `pasteImage` | `{ name, bytes, insertAt }`, added in Phase 4. |
| `setMode` | `{ mode }`, so the host can remember it per workspace. |

Host → webview:

| Message | Contents |
|---|---|
| `init` | `{ text, version, baseUri, mode }`, sent in reply to `ready`, including after the webview is recreated. |
| `ack` | `{ id, version }`: edit `id` was applied and the document is now at this version. |
| `replace` | `{ text, version, id? }`: with `id`, edit `id` was rejected; without `id`, the document changed from outside. |
| `settings` | `{ settings }`, sent just before `init` and again on `onDidChangeConfiguration`. Kept separate from the sync messages so `DocumentSync` only deals with text. |

Every `edit` gets exactly one answer: an `ack` or a `replace` carrying its `id`. Without ids, an outside change that arrives while an edit is in flight can be mistaken for the answer to that edit. If an `ack` arrives for an edit whose text was already overwritten by an outside `replace`, the webview sends `ready` again to get the full text.

### 3.3 Positions and line endings

Edits use **`{line, character}` positions, never character offsets.** CodeMirror turns every line ending into `\n`. In a file with Windows line endings (`\r\n`), VS Code counts each line ending as 2 characters, so offsets would drift by one per line. Line numbers are the same on both sides whatever the line endings.

- The webview converts CodeMirror changes with `tr.changes.iterChanges` and `startState.doc.lineAt(pos)`. Positions are in the document *before* the change on both sides, which is also what a multi-part `WorkspaceEdit` expects.
- VS Code converts `\n` in inserted text to the file's own line ending, so the file keeps the line endings it had.
- A unit test with a `\r\n` file goes in Phase 1.

### 3.4 Applying edits one at a time

The VS Code change event doesn't say where an edit came from, and `applyEdit` is asynchronous, so ordering is handled explicitly:

**Webview (`sync.ts`):**
1. At most **one edit is in flight**. Changes the user types while waiting are combined into a single pending change with CodeMirror's `ChangeSet.compose`.
2. On `ack`, the webview records the new version and sends the pending change, if any, with `baseVersion` set to that version.
3. On `replace`, the webview drops any pending change and replaces its text. It computes the shared start and end of the old and new text and replaces only the middle, so the cursor, scroll position and widgets elsewhere stay put. This transaction is tagged with a CodeMirror annotation so it isn't sent back as an edit. *Trade-off:* keystrokes typed in the instant an outside change arrives are lost. This is rare and keeps the logic simple and correct.

**Host (`DocumentSync`):**
1. If `edit.baseVersion !== document.version`, the webview was out of date. Reject the edit and send `replace` with the current text.
2. Otherwise set `expectedVersion = document.version + 1` and `await workspace.applyEdit(...)`.
3. In `onDidChangeTextDocument` for this document: if the new version equals `expectedVersion` while an edit is being applied, it's our own edit, so send `ack`. Any other change is an outside change, so send `replace`.
4. If `applyEdit` returns `false` (e.g. the file is read-only), send `replace` to undo the change in the webview.

### 3.5 Live preview: how the rendered look is drawn

Everything below is a CodeMirror decoration or widget over unchanged text. **Nothing in this section changes the document.**

**Inline formatting (a `ViewPlugin`, visible ranges only):**
- Walk the syntax tree for the visible part of the document.
- Style nodes with mark decorations: heading sizes, bold, italic, strikethrough, inline code, link text, blockquote bars, list bullets.
- Hide the syntax characters (`**`, `#`, `` ` ``, `[`, `](url)`) with zero-width replace decorations, **unless the selection touches that node**. Then the symbols are shown so they can be edited.

**Block widgets (a `StateField`):** CodeMirror only allows decorations that span lines or add block widgets to come from a state field, not a view plugin.
- **Images:** shown below the `![alt](src)` text. When the cursor isn't on that line, the image replaces the text.
- **Task checkboxes:** clicking one toggles `[ ]` ↔ `[x]` with a one-character edit.
- **Tables, math blocks, Mermaid diagrams, horizontal rules:** shown rendered while the cursor is outside the block; moving the cursor into the block shows its source.
- **Front matter:** shown as a bordered summary of its `key: value` lines. Clicking it or moving the cursor in shows the YAML source as plain monospace text.
- **Raw HTML blocks:** shown as source by default. The `mdEditor.renderHtml` setting draws them after sanitizing with DOMPurify (no scripts, styles, forms or frames; links never navigate; images resolve like Markdown images).
- Widgets are not in `EditorView.atomicRanges`: CodeMirror already skips a replaced range with the arrow keys, and the cursor reaching its edge counts as touching it (see `reveal.ts`), so the source appears. Clicking a widget puts the cursor in its source.

**Design rules:**
- **Revealing symbols must not change line heights.** A heading keeps its size when its `#` is shown. This limits the text-shifting problem that early reviews mention in the built-in editor.
- Symbols are revealed only for the node the cursor is in, not the whole line, and never on mouse hover.
- **Links:** Ctrl/Cmd+click opens them (same as VS Code). A plain click places the cursor, so link text stays easy to edit.
- **Images:** `asWebviewUri` only exists on the host, so the host sends `baseUri` (= `asWebviewUri` of the document's folder) in `init`. The image widget resolves relative `src` values against it. `localResourceRoots` includes the document's folder and all workspace folders.

**Modes**, switched from a toolbar button or a command:

| Mode | What it is |
|---|---|
| **Live** (default) | Everything above. |
| **Source** | Plain Markdown with syntax highlighting, nothing hidden. This is also the best mode for screen readers. |
| **Reading** | The same decorations with symbols never revealed, and the editor read-only. |

### 3.6 The "never rewrite what you didn't touch" rule

Because the document is plain text, typing can't rewrite other parts of the file. The places that *could* break the promise are our own commands, so each one must follow these rules:

- Toolbar and shortcut commands (bold, heading, list, link…) change only the selected text and the symbols directly around it.
- Clicking a checkbox is a one-character edit.
- Pasting an image inserts one link and changes nothing else.
- Table editing (if added, Phase 5) rewrites only the cell being edited. It never re-aligns the whole table.
- Nothing reformats on save.

These rules are tested automatically (Phase 7): for each command, run it on a set of sample files and check that the diff is limited to the expected lines.

### 3.7 Content Security Policy

Starting policy, with a new nonce each time the HTML is created:

```
default-src 'none';
img-src ${webview.cspSource} https: data:;
style-src ${webview.cspSource} 'unsafe-inline';
font-src ${webview.cspSource};
script-src 'nonce-${nonce}';
```

**Decision (Phase 3):** `style-src` allows `'unsafe-inline'`. CodeMirror, KaTeX and Mermaid all set inline styles, and Mermaid's `<style>` elements and style attributes can't carry a nonce. `script-src` stays locked to the nonce, so this allows inline CSS only, never script. Mermaid runs with `securityLevel: 'strict'` (it sanitizes labels), and KaTeX with `trust: false`. KaTeX and Mermaid are separate bundles (`dist/katex.js`, `dist/mermaid.js`) that the webview adds as `<script nonce>` tags the first time a document needs them, so a file without math or diagrams never loads them. `font-src` is for the KaTeX fonts.

## 4. Project layout

```
MdEditorExt/
├─ package.json             # contributes: customEditors, commands, configuration, keybindings
├─ esbuild.mjs              # bundles: extension (node + browser) + webview (browser)
├─ src/
│  ├─ extension.ts
│  ├─ MdEditorProvider.ts   # webview setup, HTML/CSP, creates DocumentSync
│  ├─ DocumentSync.ts       # versioning, edit queue, own/outside change detection (§3.4)
│  ├─ protocol.ts           # shared message types (§3.2)
│  ├─ images.ts             # writes pasted images with workspace.fs
│  ├─ export.ts             # markdown-it → standalone HTML
│  └─ util/{nonce,uri,positions}.ts
├─ webview/
│  ├─ main.ts
│  ├─ editor.ts             # CodeMirror setup (no history; undo/redo keymap → host)
│  ├─ sync.ts               # one edit in flight, compose pending, replace with prefix/suffix diff
│  ├─ markdownLang.ts       # Lezer Markdown + GFM + math extension
│  ├─ livePreview/
│  │  ├─ reveal.ts          # which nodes the selection touches
│  │  ├─ inline.ts          # ViewPlugin: marks + hidden syntax
│  │  ├─ blocks.ts          # StateField: block widgets + atomic ranges
│  │  └─ widgets/{image,checkbox,table,math,mermaid,frontMatter}.ts
│  ├─ commands.ts           # toolbar + shortcuts, minimal-edit rule (§3.6)
│  ├─ modes.ts              # Live / Source / Reading
│  └─ styles/{editor,livePreview,theme}.css
├─ test/
│  ├─ unit/
│  ├─ integration/
│  ├─ e2e/
│  └─ corpus/               # sample .md files for the minimal-diff tests
└─ media/icon.png
```

## 5. Phases

### Phase 0: Setup and checking the competition (1 day)
- [x] Generate the starting project with `yo code`, or set it up by hand with esbuild, ESLint, Prettier and Vitest.
- [x] Add `launch.json` so F5 opens an Extension Development Host for testing.
- [x] Add CI with a GitHub Actions matrix (Windows, macOS, Linux) that runs lint, unit tests and integration tests.
- [ ] **Check the differentiator:**
  1. Collect 5–10 real Markdown files in `test/corpus/`: READMEs, docs with tables, a file with `\r\n` line endings, and a file mixing `*` / `_` and `-` / `*` styles.
  2. Open each one in VS Code's built-in Markdown Editor and in one or two Marketplace WYSIWYG extensions.
  3. Change one word, save, and look at `git diff`.
  4. If they already keep diffs minimal, revisit §1 before going further.

### Phase 1: Editor core and sync (4–5 days)
- [ ] **Spike first (half a day):** confirm that the `undo` / `redo` commands sent from the webview act on the custom editor's document (§3.1), and that CodeMirror works under the CSP (§3.7). If undo doesn't work this way, rethink it before building anything else.
  - [x] VS Code's `undo` / `redo` commands act on the document while the custom editor is active (integration test `test/integration/customEditor.test.ts`).
  - [ ] Manual check (F5): Ctrl+Z / Ctrl+Y typed inside the editor undo and redo, and CodeMirror's styles load with no CSP errors in the webview developer tools.
- [x] Register `mdEditor.editor` for `*.md` and `*.markdown` with `priority: "option"`, so it appears under "Open With…" and doesn't replace the default editor.
- [x] Set up CodeMirror (no history extension) with the Markdown language and syntax highlighting. This is Source mode.
- [x] Build `DocumentSync` and `webview/sync.ts` as described in §3.2–3.4.
- [x] **Unit tests in this phase:**
  - `DocumentSync` with a fake document: own edit → `ack`; outside change → `replace`; stale `baseVersion` → rejected; `applyEdit` fails → `replace`.
  - Position conversion on `\r\n` and `\n` files.
  - Composing pending changes.
  - A randomized simulation of both halves with outside changes mixed in, checking that both sides always end with the same text (50 seeds).
- [ ] **Done when:** you can open a `.md` file, type, save, undo and redo with VS Code's history, see outside changes appear (e.g. `git checkout`), and edit a `\r\n` file without corrupting it.

### Phase 2: Live preview, inline (3–4 days)
- [x] Build `reveal.ts` and `inline.ts` (§3.5): headings, bold, italic, strikethrough, inline code, links, blockquotes and list bullets, with symbols hidden away from the cursor.
- [x] Theme it with VS Code's colors (`--vscode-*` CSS variables) and fonts (`editor.fontFamily`, `editor.fontSize`, with a separate setting for the prose font: `mdEditor.proseFontFamily`).
  - [ ] Manual check in light, dark and high-contrast themes. *(Dark checked with a test page that loads the real bundle; light and high contrast still to do.)*
- [x] Apply the design rules: no line-height change on reveal; reveal only the node under the cursor.
- [x] Ctrl/Cmd+click on links sends `openLink`. Inline, reference, auto and bare links are found (`webview/livePreview/links.ts`); the host decides what may be opened (`src/links.ts`).
- [x] **Unit tests:** for a given text and cursor position, which ranges are hidden and which are styled.
- [ ] **Done when:** writing a normal document feels like a rendered page, and moving the cursor never makes the text jump vertically.

### Phase 3: Live preview, blocks (4–5 days)
- [x] Build `blocks.ts` as a `StateField` (§3.5). `collectBlocks` is pure and unit-tested; widgets are in `widgets.ts`.
- [x] Add widgets for:
  - [x] images (relative paths resolved through `baseUri`)
  - [x] task checkboxes (one-character toggle)
  - [x] tables (rendered when the cursor is outside)
  - [x] horizontal rules
  - [x] front matter
- [x] Highlight code blocks in place with nested languages, loaded on demand (`dist/languages.js`, about 1.2 MB, loaded when a fence names a language). It shares CodeMirror and Lezer with the main bundle through `window.mdShared`; a second copy would break `instanceof` checks and highlighting tags. The main bundle is now about 0.6 MB. The opening and closing fence lines are hidden (thin strips) while the cursor is outside the block, and shown while it is inside or at its edges; `mermaid` and `math` fences are left to their widgets.
- [x] Add the math parser extension (`webview/livePreview/math.ts`) and KaTeX widgets for inline and block math. Loaded on demand.
- [x] Add Mermaid widgets for fenced `mermaid` blocks and settle Mermaid's CSP question (§3.7). Loaded on demand; the production bundle is about 5 MB, only loaded for files with diagrams.
- [x] Raw HTML blocks: source by default; the `mdEditor.renderHtml` setting renders them through DOMPurify.
- [x] Math also in ```math fences (as GitHub does), alongside `$…$` and `$$…$$`.
- [x] GitHub-style alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) drawn as colored callouts, and footnotes (`[^1]`) as superscripts with the definition as a hover tooltip.
- [ ] Other fenced diagram blocks, each loaded only when used: Graphviz/DOT (needs `wasm-unsafe-eval` in the CSP), Vega-Lite charts (large; needs the CSP-safe expression interpreter) and PlantUML (needs a server, so diagram text would leave the machine: not planned). Add one at a time, only if wanted.
- [ ] **Done when:** the files in `test/corpus/` all display correctly in Live mode, and every block shows its source when the cursor enters it.

### Phase 4: Editing helpers and modes (3 days)
- [ ] **Toolbar and shortcuts:** bold, italic, heading, link, code, list, quote, table. Each follows the minimal-edit rule (§3.6).
- [ ] **Lists:** pressing Enter continues a list or task list (`insertNewlineContinueMarkup` from `@codemirror/lang-markdown`); Backspace on an empty item removes it.
- [ ] **Paste a URL over selected text** to turn it into a link.
- [ ] **Paste or drag in images:**
  1. The webview reads the bytes and sends `pasteImage`.
  2. The host writes the file under `./assets/` with `workspace.fs`.
  3. The link is inserted through a normal `edit`.
- [ ] **Modes:** Live, Source and Reading (§3.5), switched by a toolbar button and the `mdEditor.setMode` command, and remembered per workspace.
- [ ] **Outline:** check whether VS Code's Outline view works while the custom editor is active. If it doesn't, add a simple heading list that jumps to a heading.
- [ ] **Accessibility:**
  - Toolbar buttons have `aria-label`s and can be reached with the keyboard.
  - Widgets have text alternatives (image alt text, a table summary, the math source).
  - Switching to Source mode is one shortcut away; document it as the screen-reader mode.

### Phase 5: Extras (2–3 days, pick what you want)
- [ ] **Table editing inside the widget:** typing in a cell edits only that cell's text (§3.6). Tab moves to the next cell.
- [ ] **Export to HTML** with markdown-it and DOMPurify, as a standalone file with the CSS inlined.
- [ ] **Settings:** prose font, custom CSS for the editor, default mode, render raw HTML on/off.

### Phase 6: Speed and reliability (2–3 days)
- [ ] Test with files over 5 MB and over 10,000 lines. Inline decorations cover only the visible part. If the block widgets' state field gets slow on large files, only update the blocks a change touches.
- [ ] **IME input** (Chinese, Japanese, Korean): decorations must not change during an IME composition, or the text being composed gets disrupted. Hold back reveal/hide updates while composing, and test with real IMEs on Windows and macOS.
- [ ] Handle the webview being hidden and shown again without `retainContextWhenHidden`: on `ready` the host sends `init` again, and the cursor, selection, scroll position and mode come back from `getState`. Undo history is unaffected because VS Code owns it.
- [ ] Check that it works when the same file is open in two editors (two `DocumentSync`s, each sees the other's edits as outside changes), and when the file is on a remote, WSL or virtual file system.
- [ ] If web support is wanted: run the extension on vscode.dev using `@vscode/test-web`.

### Phase 7: Testing and release (2–3 days)
- [ ] **Minimal-diff tests (the main promise, §3.6):** for every command and widget action, run it on each file in `test/corpus/` and check that only the expected lines changed. Also: open, type, undo all, save → the file is byte-for-byte unchanged.
- [ ] **Unit tests:** anything not already covered (block widget ranges, commands, math parser extension).
- [ ] **Host integration tests (`@vscode/test-electron`):**
  1. Open a file with the custom editor.
  2. Drive `DocumentSync` with fake webview messages.
  3. Check `document.getText()`, then save, undo and redo.
- [ ] **End-to-end tests (`vscode-extension-tester`, a few only):** type into the webview, check that symbols hide and reveal, toggle a checkbox, undo with Ctrl+Z, and edit a `\r\n` file.
- [ ] **Manual checklist:** all three themes, non-ASCII text and emoji (characters that take two UTF-16 units), IME input, very long lines, an empty file, a read-only file, and screen-reader basics in Source mode.
- [ ] Write the README with GIFs. Lead with the minimal-diff promise and show a side-by-side `git diff` from Phase 0. Add a CHANGELOG, a 128×128 icon and Marketplace keywords.
- [ ] Publish with `vsce package` and `vsce publish`, then with `ovsx publish` (this needs an Open VSX namespace).

**Total for one developer: about 5 weeks.**

| End of | You have |
|---|---|
| Week 1 | A working source editor with solid sync. |
| Week 2 | Inline live preview: the point where it starts to feel like the product. |
| Week 3 | Block widgets: images, tables, checkboxes, math, diagrams. |
| Weeks 4–5 | Editing helpers, reliability work and release. |

## 6. Main risks

| Risk | How to handle it |
|---|---|
| The differentiator doesn't hold (others already keep diffs minimal) | Checked in Phase 0, before real work starts. |
| Text jumping when symbols reveal (the complaint about the built-in editor) | No line-height change on reveal, reveal only the node under the cursor, no reveal on hover. |
| Our own commands rewriting text they shouldn't | Minimal-edit rule (§3.6) and automated minimal-diff tests on a corpus. |
| Undo/redo going to the wrong place | CodeMirror history off; undo/redo go to VS Code; checked in the Phase 1 spike. |
| Edits looping, getting lost or landing in the wrong place | One edit in flight, version checks, own/outside change detection (§3.4), `{line, character}` positions (§3.3), unit tests in Phase 1. |
| Corruption in files with `\r\n` line endings | Positions use lines, not offsets; `\r\n` unit and end-to-end tests. |
| IME input broken by changing decorations | Hold back decoration changes during composition; test with real IMEs (Phase 6). |
| Screen readers confused by hidden symbols | Source mode one shortcut away; text alternatives on widgets. |
| Lag on big files | Lezer parses incrementally; inline decorations only for the visible part; block updates limited to changed blocks. |
| Script injection through raw HTML in Markdown | Raw HTML shown as source by default; DOMPurify when rendered; strict CSP with a nonce. |

## 7. Key `package.json` entries

```jsonc
"engines": { "vscode": "^1.74.0" },
"main": "./dist/extension.js",
"browser": "./dist/web/extension.js",
"contributes": {
  "customEditors": [{
    "viewType": "mdEditor.editor",
    "displayName": "Markdown Live Editor",
    "selector": [
      { "filenamePattern": "*.md" },
      { "filenamePattern": "*.markdown" }
    ],
    "priority": "option"
  }],
  "commands": [
    { "command": "mdEditor.openEditor", "title": "Open in Markdown Live Editor" },
    { "command": "mdEditor.setMode", "title": "Markdown Live Editor: Switch Mode (Live / Source / Reading)" },
    { "command": "mdEditor.exportHtml", "title": "Markdown Live Editor: Export to HTML" }
  ],
  "configuration": { "properties": {
    "mdEditor.defaultMode": { "type": "string", "enum": ["live", "source", "reading"], "default": "live" },
    "mdEditor.proseFontFamily": { "type": "string", "default": "" },
    "mdEditor.renderHtml": { "type": "boolean", "default": false }
  }}
}
```
