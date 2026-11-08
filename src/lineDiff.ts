// A line diff for the change bars at the left of the editor. No dependency on the `vscode` module,
// so it can be unit-tested and used by the webview too.

/** A change in the new text. Lines are zero-based; `[from, to)` are lines of the new text. */
export type LineChange =
  | { kind: 'added' | 'modified'; from: number; to: number }
  /** Lines were removed after the first `at` lines of the new text. */
  | { kind: 'deleted'; at: number };

/** Most cells of the comparison table; a bigger difference is reported as one change. */
const MAX_CELLS = 4_000_000;

/** The changes that turn `oldLines` into `newLines`, in order. */
export function diffLines(oldLines: readonly string[], newLines: readonly string[]): LineChange[] {
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const m = oldEnd - start;
  const n = newEnd - start;
  if (m === 0 && n === 0) return [];

  const changes: LineChange[] = [];
  const hunk = (removed: number, newFrom: number, added: number) => {
    if (added > 0) {
      changes.push({
        kind: removed > 0 ? 'modified' : 'added',
        from: newFrom,
        to: newFrom + added,
      });
    } else if (removed > 0) {
      changes.push({ kind: 'deleted', at: newFrom });
    }
  };

  if (m === 0 || n === 0 || m * n > MAX_CELLS) {
    hunk(m, start, n);
    return changes;
  }

  // lcs[i * (n + 1) + j]: the length of the longest common run of old[i..] and new[j..].
  const width = n + 1;
  const lcs = new Uint16Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i * width + j] =
        oldLines[start + i] === newLines[start + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  let removed = 0;
  let added = 0;
  let hunkStart = 0;
  const flush = () => {
    hunk(removed, start + hunkStart, added);
    removed = 0;
    added = 0;
  };
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[start + i] === newLines[start + j]) {
      flush();
      i++;
      j++;
      hunkStart = j;
    } else if (j >= n || (i < m && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      if (removed === 0 && added === 0) hunkStart = j;
      removed++;
      i++;
    } else {
      if (removed === 0 && added === 0) hunkStart = j;
      added++;
      j++;
    }
  }
  flush();
  return changes;
}
