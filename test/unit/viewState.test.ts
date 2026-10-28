import { describe, expect, it } from 'vitest';
import { readSavedView } from '../../webview/viewState';

describe('readSavedView', () => {
  it('returns a saved record that fits the text', () => {
    expect(readSavedView({ anchor: 5, head: 9, top: 2 }, 100)).toEqual({
      anchor: 5,
      head: 9,
      top: 2,
    });
  });

  it('keeps every position inside a text that has become shorter', () => {
    expect(readSavedView({ anchor: 50, head: 90, top: 70 }, 40)).toEqual({
      anchor: 40,
      head: 40,
      top: 40,
    });
  });

  it('ignores anything that is not a record of three offsets', () => {
    for (const value of [
      undefined,
      null,
      'text',
      42,
      {},
      { anchor: 1, head: 2 },
      { anchor: -1, head: 2, top: 0 },
      { anchor: 1.5, head: 2, top: 0 },
      { anchor: '1', head: 2, top: 0 },
    ]) {
      expect(readSavedView(value, 100)).toBeUndefined();
    }
  });
});
