// Counts words in a Markdown document for the status bar.
// No dependency on the `vscode` module, so it can be unit-tested.

const FRONT_MATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;

/** Counts words in `markdown`, skipping front matter and counting CJK characters individually. */
export function countWords(markdown: string): number {
  const body = markdown.replace(FRONT_MATTER, '');
  const cjk = body.match(CJK)?.length ?? 0;
  const words = body.replace(CJK, ' ').match(WORD)?.length ?? 0;
  return cjk + words;
}
