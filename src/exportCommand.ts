import * as vscode from 'vscode';
import { collectDiagramSources, collectImageSources, renderHtml } from './export';
import { imageMimeForName } from './images';
import { findBrowser, printToPdf } from './pdf';

/** Larger images are linked, not embedded, so the page stays a reasonable size. */
const MAX_EMBEDDED_BYTES = 5 * 1024 * 1024;

/** Where an image link in the document points on disk, or undefined for web and data links. */
function localImageUri(documentUri: vscode.Uri, src: string): vscode.Uri | undefined {
  // A scheme of more than one letter is a web or data link; one letter is a Windows drive.
  if (/^([a-z][a-z0-9+.-]+:|\/\/)/i.test(src)) return undefined;
  let path = src.split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not valid escapes: use the text as written.
  }
  if (/^[a-zA-Z]:[\\/]/.test(path)) return vscode.Uri.file(path);
  if (path.startsWith('/')) {
    const root = vscode.workspace.getWorkspaceFolder(documentUri)?.uri;
    return root ? vscode.Uri.joinPath(root, path) : undefined;
  }
  return vscode.Uri.joinPath(documentUri, '..', path);
}

async function readLocalImages(document: vscode.TextDocument, rawHtml: boolean) {
  const images = new Map<string, { mime: string; data: Uint8Array }>();
  for (const src of collectImageSources(document.getText(), rawHtml)) {
    const uri = localImageUri(document.uri, src);
    const mime = uri && imageMimeForName(uri.path);
    if (!uri || !mime) continue;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      if (data.length <= MAX_EMBEDDED_BYTES) images.set(src, { mime, data });
    } catch {
      // A missing image stays a link, as it was in the document.
    }
  }
  return images;
}

/** KaTeX's stylesheet (written next to the extension by the build) with its fonts inlined. */
async function readKatexCss(extensionUri: vscode.Uri): Promise<string> {
  const dist = vscode.Uri.joinPath(extensionUri, 'dist');
  let css: string;
  try {
    css = Buffer.from(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dist, 'katex.css')),
    ).toString('utf8');
  } catch {
    return '';
  }
  // The build leaves empty urls where it dropped the woff and ttf fonts.
  css = css.replace(/,\s*url\(\)\s*format\("[^"]*"\)/g, '');
  const fonts = new Map<string, string>();
  for (const [, file] of css.matchAll(/url\(\s*["']?(?:\.\/)?(fonts\/[^"')]+\.woff2)["']?\s*\)/g)) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dist, file));
      fonts.set(file, `data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}`);
    } catch {
      // The font is left out; KaTeX falls back to a system font.
    }
  }
  return css.replace(
    /url\(\s*["']?(?:\.\/)?(fonts\/[^"')]+\.woff2)["']?\s*\)/g,
    (match, file: string) => (fonts.has(file) ? `url(${fonts.get(file)})` : match),
  );
}

type DrawDiagrams = (sources: string[]) => Promise<(string | null)[] | undefined>;

/** The document as one standalone HTML page, with its images, math and diagrams embedded. */
async function buildPage(
  extensionUri: vscode.Uri,
  document: vscode.TextDocument,
  drawDiagrams: DrawDiagrams,
): Promise<string> {
  const text = document.getText();
  const sources = collectDiagramSources(text);
  const drawn = sources.length > 0 ? await drawDiagrams(sources) : undefined;
  const diagrams = new Map<string, string>();
  drawn?.forEach((svg, index) => svg && diagrams.set(sources[index], svg));
  if (sources.length > 0 && diagrams.size < sources.length) {
    void vscode.window.showWarningMessage(
      drawn
        ? 'Some Mermaid diagrams could not be drawn; they are exported as code.'
        : 'Mermaid diagrams are exported as code. Export from the Markdown Live Editor to draw them.',
    );
  }
  const hasMath = text.includes('$') || /^\s*(`{3,}|~{3,})\s*math\b/im.test(text);
  const rawHtml = vscode.workspace.getConfiguration('mdEditor').get<boolean>('renderHtml', false);
  return renderHtml(text, {
    rawHtml,
    diagrams,
    images: await readLocalImages(document, rawHtml),
    katexCss: hasMath ? await readKatexCss(extensionUri) : '',
  });
}

/** Where to offer to save the export: next to the document, with this extension. */
function defaultTarget(document: vscode.TextDocument, extension: string): vscode.Uri {
  const base =
    document.uri.path
      .split('/')
      .pop()
      ?.replace(/\.[^.]*$/, '') || 'document';
  return vscode.Uri.joinPath(document.uri, '..', `${base}.${extension}`);
}

/** Asks where to save, then prints the document to a PDF with the installed Chrome or Edge. */
export async function exportPdf(
  extensionUri: vscode.Uri,
  document: vscode.TextDocument,
  drawDiagrams: DrawDiagrams,
): Promise<void> {
  const configured = vscode.workspace.getConfiguration('mdEditor').get<string>('browserPath', '');
  const browser = await findBrowser(configured.trim() || undefined);
  if (!browser) {
    void vscode.window.showErrorMessage(
      'Export to PDF needs Google Chrome or Microsoft Edge, and neither was found. Install one, or set mdEditor.browserPath to its program file.',
    );
    return;
  }
  const html = await buildPage(extensionUri, document, drawDiagrams);
  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultTarget(document, 'pdf'),
    filters: { PDF: ['pdf'] },
    saveLabel: 'Export',
    title: 'Export to PDF',
  });
  if (!target) return;
  if (target.scheme !== 'file') {
    void vscode.window.showErrorMessage('Export to PDF can only save to a local folder.');
    return;
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Exporting to PDF…' },
      () => printToPdf(browser, html, target.fsPath),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`The PDF could not be made: ${reason}`);
    return;
  }
  const open = await vscode.window.showInformationMessage(
    `Exported to ${target.fsPath}`,
    'Open PDF',
  );
  if (open) await vscode.env.openExternal(target);
}

/** Asks where to save, then writes the document as a standalone HTML page. */
export async function exportHtml(
  extensionUri: vscode.Uri,
  document: vscode.TextDocument,
  drawDiagrams: DrawDiagrams,
): Promise<void> {
  const html = await buildPage(extensionUri, document, drawDiagrams);
  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultTarget(document, 'html'),
    filters: { HTML: ['html'] },
    saveLabel: 'Export',
    title: 'Export to HTML',
  });
  if (!target) return;
  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`The page could not be saved: ${reason}`);
    return;
  }
  const open = await vscode.window.showInformationMessage(
    `Exported to ${target.fsPath}`,
    'Open in Browser',
  );
  if (open) await vscode.env.openExternal(target);
}
