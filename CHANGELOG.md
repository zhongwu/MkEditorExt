# Changelog

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
