import { describe, expect, it } from 'vitest';
import { isWebviewMessage } from '../../src/protocol';

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

describe('isWebviewMessage', () => {
  it('accepts valid messages', () => {
    expect(isWebviewMessage({ type: 'ready' })).toBe(true);
    expect(isWebviewMessage({ type: 'undo' })).toBe(true);
    expect(isWebviewMessage({ type: 'redo' })).toBe(true);
    expect(
      isWebviewMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [{ range, text: 'x' }] }),
    ).toBe(true);
  });

  it('rejects malformed messages', () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage('ready')).toBe(false);
    expect(isWebviewMessage({ type: 'unknown' })).toBe(false);
    expect(isWebviewMessage({ type: 'edit', baseVersion: 1, changes: [] })).toBe(false);
    expect(isWebviewMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [{ range }] })).toBe(
      false,
    );
    expect(
      isWebviewMessage({
        type: 'edit',
        id: 1,
        baseVersion: 1,
        changes: [{ range: { start: { line: -1, character: 0 }, end: range.end }, text: '' }],
      }),
    ).toBe(false);
  });
});
