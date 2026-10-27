import type { LinePosition, TextChange } from '../../src/protocol';

/** Offset of a line/character position in `text`, counting any line ending style. */
export function offsetAt(text: string, pos: LinePosition): number {
  let lineStart = 0;
  const lineBreak = /\r\n|\r|\n/g;
  for (let line = 0; line < pos.line; line++) {
    const match = lineBreak.exec(text);
    if (!match) {
      throw new Error(`Line ${pos.line} is past the end of the text`);
    }
    lineStart = match.index + match[0].length;
  }
  const nextBreak = lineBreak.exec(text);
  const lineEnd = nextBreak ? nextBreak.index : text.length;
  if (lineStart + pos.character > lineEnd) {
    throw new Error(`Character ${pos.character} is past the end of line ${pos.line}`);
  }
  return lineStart + pos.character;
}

/**
 * Applies changes to `text` the way VS Code applies a WorkspaceEdit: every range refers to the
 * original text, and `\n` in inserted text becomes the document's own line ending. Like a VS Code
 * document, pass `eol` to keep the line ending even when the text has no line breaks left.
 */
export function applyTextChanges(
  text: string,
  changes: readonly TextChange[],
  eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n',
): string {
  const resolved = changes
    .map((c) => ({
      from: offsetAt(text, c.range.start),
      to: offsetAt(text, c.range.end),
      insert: c.text.replace(/\r\n|\r|\n/g, eol),
    }))
    .sort((a, b) => b.from - a.from);
  let result = text;
  for (const { from, to, insert } of resolved) {
    result = result.slice(0, from) + insert + result.slice(to);
  }
  return result;
}

/** A small seeded random number generator, so failures can be reproduced. */
export function createRandom(seed: number): {
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
} {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}
