// Heading anchor completion when typing `](#` inside a Markdown link.

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { findHeadings } from '../../src/headings';

const HEADING_LINK = /\[[^\]]*\]\(#([^\s)#]*)$/;

export function headingCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = HEADING_LINK.exec(before);
  if (!match) return null;
  const from = context.pos - match[1].length;
  const headings = findHeadings(context.state.doc.toString());
  if (headings.length === 0) return null;
  return {
    from,
    validFor: /^[^\s)#]*$/,
    options: headings.map((h) => ({
      label: h.slug,
      detail: `${'#'.repeat(h.level)} ${h.text}`,
    })),
  };
}

export const headingCompletion = autocompletion({
  override: [headingCompletionSource],
  icons: false,
});
