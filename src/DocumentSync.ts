// Keeps one webview in step with one TextDocument (PLAN.md §3.4).
// It has no dependency on the `vscode` module so it can be unit-tested with fakes.

import type { SyncHostMessage, SyncMessage, TextChange } from './protocol';

/** The parts of `vscode.TextDocument` that DocumentSync needs. */
export interface SyncDocument {
  readonly version: number;
  getText(): string;
}

/** Everything DocumentSync does to the outside world. */
export interface SyncHost {
  /** Applies all changes as one edit. Resolves to false if VS Code refused it. */
  applyEdit(changes: readonly TextChange[]): PromiseLike<boolean>;
  post(message: SyncHostMessage): void;
  executeCommand(command: 'undo' | 'redo'): void;
}

interface PendingEdit {
  id: number;
  expectedVersion: number;
  answered: boolean;
}

export class DocumentSync {
  /** Set while our own edit is being applied. */
  private applying: PendingEdit | undefined;
  /** A version whose change event has already been answered with `ack`. */
  private ignoreVersion: number | undefined;
  /** Edits are applied strictly one after another. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly document: SyncDocument,
    private readonly host: SyncHost,
  ) {}

  /** Handles a message from the webview. Returns a promise that settles once it has been handled. */
  handleMessage(message: SyncMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.host.post({
          type: 'init',
          text: this.document.getText(),
          version: this.document.version,
        });
        return Promise.resolve();
      case 'edit': {
        const { id, baseVersion, changes } = message;
        const next = this.queue.then(() => this.applyEdit(id, baseVersion, changes));
        this.queue = next.catch(() => undefined);
        return next;
      }
      case 'undo':
      case 'redo':
        this.host.executeCommand(message.type);
        return Promise.resolve();
    }
  }

  /** Call for every content change of the document (not for dirty-state-only events). */
  onDocumentChanged(): void {
    const version = this.document.version;
    const applying = this.applying;
    if (applying && !applying.answered && version === applying.expectedVersion) {
      applying.answered = true;
      this.host.post({ type: 'ack', id: applying.id, version });
      return;
    }
    if (version === this.ignoreVersion) {
      this.ignoreVersion = undefined;
      return;
    }
    this.sendReplace();
  }

  private async applyEdit(
    id: number,
    baseVersion: number,
    changes: readonly TextChange[],
  ): Promise<void> {
    if (baseVersion !== this.document.version) {
      // The webview edited text that has changed since; resend the truth.
      this.sendReplace(id);
      return;
    }

    const pending: PendingEdit = { id, expectedVersion: baseVersion + 1, answered: false };
    this.applying = pending;
    let applied: boolean;
    try {
      applied = await this.host.applyEdit(changes);
    } catch {
      applied = false;
    } finally {
      this.applying = undefined;
    }

    if (pending.answered) {
      if (!applied) {
        // The change we acknowledged was someone else's; ours never landed.
        this.sendReplace();
      }
      return;
    }
    if (!applied) {
      // Refused (e.g. read-only file): put the webview back to the real text.
      this.sendReplace(id);
    } else if (this.document.version === baseVersion) {
      // The edit changed nothing, so no change event will come.
      this.host.post({ type: 'ack', id, version: baseVersion });
    } else if (this.document.version === pending.expectedVersion) {
      // Applied, but the change event hasn't arrived yet. Answer now and skip it later.
      this.ignoreVersion = pending.expectedVersion;
      this.host.post({ type: 'ack', id, version: pending.expectedVersion });
    } else {
      this.sendReplace(id);
    }
  }

  private sendReplace(id?: number): void {
    this.host.post({
      type: 'replace',
      text: this.document.getText(),
      version: this.document.version,
      ...(id === undefined ? {} : { id }),
    });
  }
}
