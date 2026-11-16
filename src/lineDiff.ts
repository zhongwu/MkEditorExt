// A line diff for the change bars at the left of the editor. No dependency on the `vscode` module,
// so it can be unit-tested and used by the webview too.

/** A change in the new text. Lines are zero-based; `[from, to)` are lines of the new text. */
export type LineChange =
  | { kind: 'added' | 'modified'; from: number; to: number }
  /** Lines were removed after the first `at` lines of the new text. */
  | { kind: 'deleted'; at: number };

/** Maximum edit distance explored before falling back to one combined hunk. */
const MAX_EDITS = 4000;

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

  if (m === 0 || n === 0) {
    hunk(m, start, n);
    return changes;
  }

  // Myers O((M + N)D) shortest-edit-script diff.
  const maxD = Math.min(m + n, MAX_EDITS);
  const offset = maxD;
  const v = new Int32Array(2 * maxD + 1);
  const trace: Int32Array[] = [];
  let reached = false;
  for (let d = 0; d <= maxD; d++) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < m && y < n && oldLines[start + x] === newLines[start + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= m && y >= n) {
        reached = true;
        break;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
    if (reached) break;
  }

  if (!reached) {
    hunk(m, start, n);
    return changes;
  }

  const steps: ('equal' | 'insert' | 'delete')[] = [];
  let x = m;
  let y = n;
  for (let d = trace.length - 1; d >= 1; d--) {
    const prev = trace[d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && prev[k - 1 + (d - 1)] < prev[k + 1 + (d - 1)]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[prevK + (d - 1)];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push('equal');
      x--;
      y--;
    }
    if (down) {
      steps.push('insert');
      y--;
    } else {
      steps.push('delete');
      x--;
    }
  }
  while (x > 0 && y > 0) {
    steps.push('equal');
    x--;
    y--;
  }

  let removed = 0;
  let added = 0;
  let j = 0;
  let hunkStart = 0;
  const flush = () => {
    hunk(removed, start + hunkStart, added);
    removed = 0;
    added = 0;
  };
  for (let s = steps.length - 1; s >= 0; s--) {
    const step = steps[s];
    if (step === 'equal') {
      flush();
      j++;
      hunkStart = j;
    } else if (step === 'delete') {
      if (removed === 0 && added === 0) hunkStart = j;
      removed++;
    } else {
      if (removed === 0 && added === 0) hunkStart = j;
      added++;
      j++;
    }
  }
  flush();
  return changes;
}
