# Manual checks before a release

The automated tests (unit, corpus minimal-diff and integration) run on every push. These checks need a person, a real VS Code window or a real keyboard. Use the files in `test/corpus/` and press **F5** (or install the `.vsix` from `npx vsce package`).

Mark each one with the date and what you used.

## Themes

- [ ] Dark Modern: headings, links, code, tables, alerts, checkboxes and the toolbar are readable.
- [ ] Light Modern: the same, and the selection is visible over code blocks and the current line.
- [ ] High Contrast and High Contrast Light: every control has a visible border or outline, and focus is visible on toolbar buttons and widgets.

## Text

- [ ] Non-ASCII text (accents, Chinese) and emoji, including emoji at the start and end of a line and inside bold text. Typing and deleting next to them does not split a character.
- [ ] A very long line (over 20,000 characters) scrolls and edits without freezing.
- [ ] An empty file opens, and typing in it works.
- [ ] A read-only file (set the read-only attribute): it shows, and typing, the toolbar buttons and the checkboxes change nothing.
- [ ] A file with `\r\n` line endings: type, save, then look at the bytes (for example with `git diff` showing no whole-file change).

## IME

- [ ] Chinese (Windows). Checked 2026-10-28.
- [ ] Japanese and Korean (Windows).
- [ ] An IME on macOS.
  For each: compose in a heading, in bold text and inside a table cell. The candidate window stays in place, the text is not lost, and symbols reveal and hide correctly afterwards.

## VS Code behaviour

- [ ] Hide the editor tab behind another and bring it back: the cursor and scroll position are where they were.
- [ ] The same file open in two editors side by side: typing in one shows in the other.
- [ ] Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo in the document, and the unsaved marker clears when you undo to the saved text.
- [ ] A WSL or SSH window: open, type, paste an image, export to HTML.
- [ ] An untrusted folder (Restricted Mode): the editor opens and works.

## Export

- [ ] Export to HTML on `math-and-diagrams.md` from the Live Editor tab: math and both diagrams are in the page, and it opens offline.
- [ ] Export to PDF on the same file: the page breaks fall between blocks, not through a table or a diagram.
- [ ] Export to PDF with Chrome and Edge both missing (set `mdEditor.browserPath` to a missing file): the error message names the setting.

## Accessibility

- [ ] Source mode with a screen reader (NVDA on Windows, VoiceOver on macOS): the text is read line by line, and the toolbar buttons are announced with their names.
- [ ] Keyboard only: Tab reaches the toolbar, Enter or Space presses a button, and Escape or a click returns to the text.
