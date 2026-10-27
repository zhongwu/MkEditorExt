import { describe, expect, it } from 'vitest';
import { classifyLink } from '../../src/links';

describe('classifyLink', () => {
  it('opens web and mail links outside VS Code', () => {
    expect(classifyLink('https://x.y/a?b#c')).toEqual({
      kind: 'external',
      url: 'https://x.y/a?b#c',
    });
    expect(classifyLink('HTTP://x.y')).toEqual({ kind: 'external', url: 'HTTP://x.y' });
    expect(classifyLink('mailto:a@b.c')).toEqual({ kind: 'external', url: 'mailto:a@b.c' });
  });

  it('refuses other schemes', () => {
    for (const href of [
      'command:workbench.action.terminal.new',
      'file:///etc/passwd',
      'vscode://settings',
      'javascript:alert(1)',
      'data:text/html,x',
    ]) {
      expect(classifyLink(href)).toBeUndefined();
    }
  });

  it('treats relative paths as files, splitting off the fragment and query', () => {
    expect(classifyLink('docs/guide.md')).toEqual({ kind: 'file', path: 'docs/guide.md' });
    expect(classifyLink('../a.md#setup')).toEqual({
      kind: 'file',
      path: '../a.md',
      fragment: 'setup',
    });
    expect(classifyLink('a.md?raw=1')).toEqual({ kind: 'file', path: 'a.md' });
    expect(classifyLink('my%20file.md')).toEqual({ kind: 'file', path: 'my file.md' });
  });

  it('treats a Windows drive path as a file, not a scheme', () => {
    expect(classifyLink('C:\\notes\\a.md')).toEqual({ kind: 'file', path: 'C:\\notes\\a.md' });
  });

  it('recognizes anchors in the same document', () => {
    expect(classifyLink('#getting-started')).toEqual({
      kind: 'anchor',
      fragment: 'getting-started',
    });
  });

  it('ignores empty links', () => {
    expect(classifyLink('  ')).toBeUndefined();
    expect(classifyLink('?x=1')).toBeUndefined();
  });
});
