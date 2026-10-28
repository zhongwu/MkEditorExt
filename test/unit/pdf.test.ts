import { describe, expect, it } from 'vitest';
import { browserCandidates } from '../../src/pdf';

describe('browserCandidates', () => {
  it('looks for Chrome and Edge in the Windows program folders', () => {
    const found = browserCandidates('win32', {
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    });
    expect(found.some((path) => path.endsWith('chrome.exe'))).toBe(true);
    expect(found.some((path) => path.endsWith('msedge.exe'))).toBe(true);
    expect(found.every((path) => !path.startsWith('undefined'))).toBe(true);
  });

  it('knows the macOS and Linux names', () => {
    expect(browserCandidates('darwin', {})[0]).toContain('Google Chrome');
    expect(browserCandidates('linux', {})).toContain('/usr/bin/google-chrome');
  });
});
