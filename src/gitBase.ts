// Reads the committed text of a file from VS Code's built-in Git extension, for the change bars.
// Without that extension, or for a file outside a repository, there is no text and no bars.

import * as vscode from 'vscode';

/** The small part of the Git extension's API used here. */
interface GitRepository {
  state: { onDidChange: vscode.Event<void> };
  show(ref: string, path: string): Promise<string>;
}
interface GitApi {
  getRepository(uri: vscode.Uri): GitRepository | null;
  onDidOpenRepository: vscode.Event<GitRepository>;
}

async function gitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  if (!extension) return undefined;
  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1);
  } catch {
    return undefined;
  }
}

/** How long to wait after Git reports a change before reading the text again. */
const REFRESH_DELAY_MS = 800;

/**
 * Keeps `onText` up to date with the text of `uri` as Git has it staged (as in VS Code's own change
 * bars): the text, or null if the file is not in Git. Call `refresh` to send it now.
 */
export class GitBaseWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: string | null | undefined;
  private watching = false;
  private disposed = false;

  constructor(
    private readonly uri: vscode.Uri,
    private readonly onText: (text: string | null) => void,
  ) {}

  /** With `force`, the text is sent again even if it has not changed (a new page needs it). */
  async refresh(force = false): Promise<void> {
    if (this.uri.scheme !== 'file') return;
    const api = await gitApi();
    if (!api || this.disposed) return;
    const repository = api.getRepository(this.uri);
    if (!this.watching) {
      this.watching = true;
      // The repository may be found only after VS Code has scanned the folder.
      this.disposables.push(api.onDidOpenRepository(() => this.schedule(0)));
    }
    if (!repository) return;
    if (!this.repositories.has(repository)) {
      this.repositories.add(repository);
      this.disposables.push(repository.state.onDidChange(() => this.schedule(REFRESH_DELAY_MS)));
    }
    let text: string | null;
    try {
      // An empty ref is the staged version, which is the original in VS Code's change bars.
      text = await repository
        .show('', this.uri.fsPath)
        .catch(() => repository.show('HEAD', this.uri.fsPath));
    } catch {
      text = null; // Not tracked, or not committed yet.
    }
    if (this.disposed || (!force && text === this.last)) return;
    this.last = text;
    this.onText(text);
  }

  private readonly repositories = new Set<GitRepository>();

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
