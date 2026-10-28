// Export to PDF (PLAN.md §5): the installed Chrome or Edge prints the exported HTML page.
// No dependency on the `vscode` module, so it can be unit-tested.

import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

/** How long the browser gets to print one page. */
const PRINT_TIMEOUT_MS = 60_000;

/** Where Chrome, Edge or Chromium usually are on this system, best first. */
export function browserCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']].filter(
      (root): root is string => !!root,
    );
    return roots.flatMap((root) => [
      win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  const names = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
  ];
  const dirs = ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome'];
  return dirs.flatMap((dir) => names.map((name) => posix.join(dir, name)));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The first browser that exists: the one the user configured, or else a usual place. */
export async function findBrowser(configured?: string): Promise<string | undefined> {
  const candidates = [
    ...(configured ? [configured] : []),
    ...browserCandidates(process.platform, process.env),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

/** Prints the page to a PDF file at `pdfPath`; rejects with a readable reason if that fails. */
export async function printToPdf(browser: string, html: string, pdfPath: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'md-editor-pdf-'));
  try {
    const page = join(dir, 'page.html');
    await writeFile(page, html, 'utf8');
    await new Promise<void>((resolve, reject) => {
      execFile(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-pdf-header-footer',
          // A throwaway profile, so a browser that is already open does not swallow the job.
          `--user-data-dir=${join(dir, 'profile')}`,
          `--print-to-pdf=${pdfPath}`,
          pathToFileURL(page).href,
        ],
        { timeout: PRINT_TIMEOUT_MS, windowsHide: true },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    if (!(await exists(pdfPath))) throw new Error('the browser did not write a file');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
