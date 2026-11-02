// Translations for the text the webview shows (PLAN.md, Phase 7). The host puts VS Code's
// translation bundle for this extension (`vscode.l10n.bundle`, from l10n/bundle.l10n.<lang>.json)
// in the page as `data-l10n` on <body>, before this script runs. The keys are the English text,
// as with `vscode.l10n.t`, so with no bundle (English, or the unit tests) the text is unchanged.

let bundle: Record<string, string> | undefined;

function readBundle(): Record<string, string> {
  if (!bundle) {
    bundle = {};
    try {
      const data = typeof document === 'undefined' ? undefined : document.body?.dataset.l10n;
      if (data) bundle = JSON.parse(data) as Record<string, string>;
    } catch {
      // A broken bundle leaves the English text.
    }
  }
  return bundle;
}

export const l10n = {
  /** The translation of `message`, with `{0}`, `{1}`… replaced by `args`. */
  t(message: string, ...args: (string | number)[]): string {
    const text = readBundle()[message] ?? message;
    return text.replace(/\{(\d+)\}/g, (match, index: string) =>
      Number(index) < args.length ? String(args[Number(index)]) : match,
    );
  },
};
