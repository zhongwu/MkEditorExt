# Changelog

## 0.1.12 (2026-11-07)

- A file under Git gets change bars at the left, as in VS Code's own editor: green for added lines, blue for changed lines and a red mark where lines were removed. They compare with the staged text and follow your typing.
- The Live, Source and Reading buttons in the toolbar are icons.
- A heading underlined with `===` or `---` no longer shows the underline until the cursor is on the heading. Level 1 and 2 headings have a thin line under them, as in VS Code's Markdown preview.

## 0.1.11 (2026-11-06)

- Lists are indented as in VS Code's Markdown preview. The bullet or number sits just before the text, wrapped lines line up under the text, and each nested level moves further in. Nested bullets are drawn as `•`, `◦` and `▪`. Tables, formulas and diagrams inside a list item line up with its text.
- Ctrl/Cmd+click on a link inside a table cell opens it. Before, it started editing the cell.

## 0.1.10 (2026-11-04)

- A link to another file with a heading, such as `other.md#usage`, opens that file in this editor at the heading. Before, it opened at the top, or in the plain text editor. The same works when the file is already open in a background tab, and a link to the current file scrolls in place.
- Heading text keeps the underscores inside words (`pass_word_check`) and drops those used for emphasis (`_note_`). This also fixes `#anchor` links to such headings.
- The HTML and PDF export takes its title from a heading underlined with `===` or `---` too. Before, it was "Document".
- Closing the editor during an export no longer leaves it waiting for the diagrams.
- A button in the title bar of a Markdown file opens it in this editor.
- Tab in the last cell of a table adds a new row.

## 0.1.9 (2026-11-03)

- A table cell box has a third state, `☒` (crossed out, drawn in red). Each click goes `☐`, `☑`, `☒` and back to `☐`.
- The extension is listed under the categories Programming Languages, Visualization and Other (it was only Other), so it shows up where people look for Markdown tools.

## 0.1.8 (2026-11-03)

- A `☐` or `☑` anywhere in a table cell (the emoji form from the Windows emoji picker too) is drawn as a checkbox, and a click switches it, a one-character edit. While the cursor is in a cell (you are editing it, or the table shows its source), the toolbar's `☐` and `☑` buttons type them, and a `[ ]` or `[x]` you type becomes `☐` or `☑` when you leave the cell (not in `code`). They are ordinary characters, so every app shows them.
- Table columns no longer shrink until a word is split into single letters (`ID` showed as `I` and `D`). This made header cells tiny and hard to click.

## 0.1.7 (2026-11-02)

- Tables inside bulleted and numbered lists are drawn as tables, indented under the list text, and their cells can be edited in place. Before, they were shown as source.
- A horizontal rule (`---`) inside a list is drawn as a line. Before, it was shown as source.
- A file opens fully drawn. Before, its first line showed its Markdown symbols because the cursor started there. The symbols appear once you click, type or move the cursor.
- The interface is translated into Simplified and Traditional Chinese, following VS Code's display language. The README is also available in both.

## 0.1.6 (2026-11-01)

- Math (`$$` blocks and `math` fences) and Mermaid diagrams are drawn inside bulleted and numbered lists, at any depth, indented under the list text. Before, they were shown as source there.
- A Mermaid diagram inside a list keeps all its lines. Before, only the first line was read.

## 0.1.5 (2026-10-30)

- The extension is also on Open VSX, for VSCodium, Cursor and other editors that use it.
- The README says that VS Code's Outline view and breadcrumbs stay empty in this editor, and to use Go to Heading instead.

## 0.1.4 (2026-10-28)

- The README has animated examples of the clean diff, the symbols at the cursor and table editing.

## 0.1.3 (2026-10-28)

- After a heading, list or quote button, the cursor lands after the marker, so you can type straight away.

## 0.1.2 (2026-10-28)

- The README shows how editing works, and examples of math and diagrams.

## 0.1.1 (2026-10-28)

- The link shortcut is now `Ctrl/Cmd+Alt+K`. `Ctrl+K` used to insert `[](url)`, which broke VS Code's `Ctrl+K` chords such as `Ctrl+K Ctrl+T`.
- Inline code is readable in light themes.

## 0.1.0 (2026-10-28)

The first release.

- Live, Source and Reading modes, with the Markdown symbols shown only around the cursor.
- The file is edited as text, so an edit changes only what it has to, and `\r\n` files stay `\r\n`.
- Live preview of headings, emphasis, links, quotes, lists, code, task checkboxes, tables, images, horizontal rules, front matter, GitHub alerts, footnotes, math (KaTeX), Mermaid diagrams and, if you turn it on, sanitized raw HTML.
- Edit table cells in place.
- Formatting toolbar and shortcuts, Go to Heading, `#anchor` links, and pasting or dropping images into an `assets/` folder.
- Export to HTML and to PDF (PDF needs Chrome or Edge on the same machine).
- Settings for the default mode, the text font, raw HTML, your own CSS and the browser used for PDF.
- Works with VS Code's save, undo and redo, Git, remote windows and untrusted folders.
- Fast on large files: typing stays under about 35 ms at 5 MB.
