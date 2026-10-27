// Finds the YAML front matter at the start of a file. No DOM, so it can be unit-tested.

import type { Text } from '@codemirror/state';

/** The `---` block at the very start of the file, and its `key: value` lines. */
export function findFrontMatter(
  doc: Text,
): { from: number; to: number; entries: [string, string][] } | undefined {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return undefined;
  for (let n = 2; n <= doc.lines; n++) {
    const text = doc.line(n).text.trimEnd();
    if (text === '---' || text === '...') {
      const entries: [string, string][] = [];
      for (let i = 2; i < n; i++) {
        const match = /^([\w.-]+):\s*(.*)$/.exec(doc.line(i).text);
        if (match) entries.push([match[1], match[2].replace(/^(["'])(.*)\1$/, '$2')]);
      }
      return { from: 0, to: doc.line(n).to, entries };
    }
  }
  return undefined;
}
