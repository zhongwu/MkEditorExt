// Finds the headings of a Markdown document, for "Go to Heading" and `#anchor` links.
// No dependency on the `vscode` module, so it can be unit-tested.

export interface Heading {
  /** 1 to 6. */
  level: number;
  /** The heading as shown, without Markdown symbols. */
  text: string;
  /** Zero-based line number. */
  line: number;
  /** The anchor GitHub gives this heading, e.g. `getting-started` or `usage-1` for a repeat. */
  slug: string;
}

const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ATX_EMPTY = /^ {0,3}#{1,6}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Removes the Markdown symbols a heading's text may contain. */
function plainText(markdown: string): string {
  return (
    markdown
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*~`]+/g, '')
      // Underscores are emphasis only at the edge of a word; `snake_case` keeps its own.
      .replace(/(^|s)_+|_+(?=s|$)/g, '$1')
      .trim()
  );
}

/** GitHub's anchor for a heading: lowercase, symbols removed, spaces turned into hyphens. */
export function slugify(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function findHeadings(text: string): Heading[] {
  const lines = text.split(/\r?\n/);
  const found: Omit<Heading, 'slug'>[] = [];
  let start = 0;
  // Front matter is not part of the document's headings.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) start = end + 1;
  }

  let fence: string | undefined;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const opening = FENCE.exec(line);
    if (fence) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (opening) {
      fence = opening[1];
      continue;
    }
    const atx = ATX.exec(line);
    if (atx && !ATX_EMPTY.test(line)) {
      found.push({ level: atx[1].length, text: plainText(atx[2]), line: i });
      continue;
    }
    // A line of text with "===" or "---" under it.
    const under = SETEXT.exec(lines[i + 1] ?? '');
    if (
      under &&
      line.trim() !== '' &&
      !/^\s*([>#]|[-*+] |\d+[.)] )/.test(line) &&
      !SETEXT.test(line)
    ) {
      found.push({ level: under[1][0] === '=' ? 1 : 2, text: plainText(line), line: i });
      i++;
    }
  }

  const seen = new Map<string, number>();
  return found.map((heading) => {
    const base = slugify(heading.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...heading, slug: count === 0 ? base : `${base}-${count}` };
  });
}

/** The heading a `#anchor` link points to; the match ignores case, as GitHub does. */
export function findAnchor(headings: readonly Heading[], fragment: string): Heading | undefined {
  const wanted = fragment.toLowerCase();
  return headings.find((heading) => heading.slug === wanted);
}
