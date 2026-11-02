import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Every translation must cover exactly the text the code shows: the `l10n.t('…')` calls in
// src/ (vscode.l10n) and webview/ (webview/l10n.ts), and the `%key%` entries in package.json.

const root = join(__dirname, '..', '..');
const LANGUAGES = ['zh-cn', 'zh-tw'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** The first argument of each `l10n.t(…)` call, which must be a plain string literal. */
function messages(): Set<string> {
  const found = new Set<string>();
  const call = /l10n\.t\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  for (const file of [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'webview'))]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(call)) {
      found.add(match[2].replace(/\\(.)/g, '$1'));
    }
  }
  return found;
}

const readJson = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>;

const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();

describe('translations', () => {
  const english = messages();
  const nls = readJson('package.nls.json');

  it('finds the text the code shows', () => {
    expect(english.size).toBeGreaterThan(40);
    expect(english).toContain('Rendering diagram…');
    expect(english).toContain("This link type can't be opened: {0}");
  });

  it('has every package.json %key% in package.nls.json', () => {
    const manifest = readFileSync(join(root, 'package.json'), 'utf8');
    const keys = [...manifest.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    expect(keys.filter((key) => !(key in nls))).toEqual([]);
    expect(Object.keys(nls).filter((key) => !keys.includes(key))).toEqual([]);
  });

  for (const language of LANGUAGES) {
    describe(language, () => {
      const bundle = readJson(`l10n/bundle.l10n.${language}.json`);
      const packageNls = readJson(`package.nls.${language}.json`);

      it('translates every message, and nothing else', () => {
        expect([...english].filter((message) => !(message in bundle))).toEqual([]);
        expect(Object.keys(bundle).filter((message) => !english.has(message))).toEqual([]);
      });

      it('keeps the placeholders of each message', () => {
        const wrong = Object.entries(bundle).filter(
          ([message, text]) =>
            JSON.stringify(placeholders(message)) !== JSON.stringify(placeholders(text)),
        );
        expect(wrong).toEqual([]);
      });

      it('only has package.json keys that exist in English', () => {
        expect(Object.keys(packageNls).filter((key) => !(key in nls))).toEqual([]);
      });

      it('keeps setting links and code in the package.json text', () => {
        for (const [key, text] of Object.entries(packageNls)) {
          const marks = (s: string) => [...s.matchAll(/`[^`]*`|#[\w.]+#/g)].map((m) => m[0]);
          expect(marks(text), key).toEqual(marks(nls[key]));
        }
      });
    });
  }
});
