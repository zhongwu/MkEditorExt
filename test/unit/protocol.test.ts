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

describe('setMode message', () => {
  it('accepts the three modes and nothing else', () => {
    for (const mode of ['live', 'source', 'reading']) {
      expect(isWebviewMessage({ type: 'setMode', mode })).toBe(true);
    }
    expect(isWebviewMessage({ type: 'setMode', mode: 'edit' })).toBe(false);
    expect(isWebviewMessage({ type: 'setMode' })).toBe(false);
  });
});

describe('pasteImage message', () => {
  const image = { type: 'pasteImage', id: 1, name: 'a.png', mime: 'image/png', data: 'AAAA' };

  it('accepts an image of a known type', () => {
    expect(isWebviewMessage(image)).toBe(true);
  });

  it('refuses other types, long names and missing data', () => {
    expect(isWebviewMessage({ ...image, mime: 'text/html' })).toBe(false);
    expect(isWebviewMessage({ ...image, mime: '__proto__' })).toBe(false);
    expect(isWebviewMessage({ ...image, name: 'x'.repeat(256) })).toBe(false);
    expect(isWebviewMessage({ ...image, data: undefined })).toBe(false);
  });
});
