import { describe, expect, it } from 'vitest';
import { findAnchor, findHeadings, slugify } from '../../src/headings';
import {
  imageAlt,
  imageFileName,
  imageMarkdown,
  imageMimeForName,
  imageStem,
} from '../../src/images';

describe('findHeadings', () => {
  it('finds # headings with their level, line and anchor', () => {
    const headings = findHeadings('# Title\n\ntext\n\n## Getting started ##\n');
    expect(headings).toEqual([
      { level: 1, text: 'Title', line: 0, slug: 'title' },
      { level: 2, text: 'Getting started', line: 4, slug: 'getting-started' },
    ]);
  });

  it('finds underlined headings', () => {
    const headings = findHeadings('Title\n=====\n\nSub\n---\n');
    expect(headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, 'Title', 0],
      [2, 'Sub', 3],
    ]);
  });

  it('skips front matter, code blocks and a horizontal rule', () => {
    const text =
      '---\ntitle: # not a heading\n---\n\n```\n# comment\n```\n\n~~~sh\n# also code\n~~~\n\n---\n\n# Real\n';
    expect(findHeadings(text).map((h) => h.text)).toEqual(['Real']);
  });

  it('does not take a list item or quote followed by --- for a heading', () => {
    expect(findHeadings('- item\n---\n\n> quote\n---\n')).toEqual([]);
  });

  it('removes Markdown symbols from the text', () => {
    const [heading] = findHeadings('# The **bold** [link](http://x.y) and `code`\n');
    expect(heading.text).toBe('The bold link and code');
  });

  it('numbers repeated anchors the way GitHub does', () => {
    const slugs = findHeadings('# Usage\n## Usage\n## Usage\n').map((h) => h.slug);
    expect(slugs).toEqual(['usage', 'usage-1', 'usage-2']);
  });

  it('works with Windows line endings', () => {
    expect(findHeadings('# One\r\n\r\n## Two\r\n').map((h) => h.line)).toEqual([0, 2]);
  });
});

describe('slugify', () => {
  it('lowercases, drops punctuation and turns spaces into hyphens', () => {
    expect(slugify("What's new in v2.0?")).toBe('whats-new-in-v20');
    expect(slugify('Über uns')).toBe('über-uns');
    expect(slugify('A_b - c')).toBe('a_b---c');
  });
});

describe('findAnchor', () => {
  it('matches without regard to case', () => {
    const headings = findHeadings('# Getting Started\n');
    expect(findAnchor(headings, 'Getting-Started')?.line).toBe(0);
    expect(findAnchor(headings, 'missing')).toBeUndefined();
  });
});

describe('imageFileName', () => {
  const now = new Date(2026, 0, 31, 14, 5, 9);
  const none = () => false;

  it('uses a timestamp for the generic names browsers give clipboard images', () => {
    expect(imageFileName('image.png', 'image/png', none, now)).toBe('pasted-20260131-140509.png');
    expect(imageFileName('', 'image/jpeg', none, now)).toBe('pasted-20260131-140509.jpg');
  });

  it('keeps a meaningful name and cleans it', () => {
    expect(imageFileName('My Photo (1).JPG', 'image/jpeg', none, now)).toBe('My-Photo-1.jpg');
    expect(imageFileName('C:\\pics\\cat.png', 'image/png', none, now)).toBe('cat.png');
  });

  it('adds a number when the name is taken', () => {
    const taken = new Set(['cat.png', 'cat-1.png']);
    expect(imageFileName('cat.png', 'image/png', (n) => taken.has(n), now)).toBe('cat-2.png');
  });

  it('takes the extension from the type, not the name', () => {
    expect(imageFileName('cat.exe', 'image/webp', none, now)).toBe('cat.webp');
  });
});

describe('image Markdown', () => {
  it('builds the link and strips brackets from the alt text', () => {
    expect(imageMarkdown('a [b]', 'assets/x.png')).toBe('![a b](assets/x.png)');
  });

  it('makes alt text from a file name, but not from a generic one', () => {
    expect(imageAlt('team-photo_2026.png')).toBe('team photo 2026');
    expect(imageAlt('image.png')).toBe('');
    expect(imageStem('../../etc/passwd')).toBe('passwd');
  });
});

describe('imageMimeForName', () => {
  it('finds the type from the extension, whatever its case', () => {
    expect(imageMimeForName('a/b/Cat.PNG')).toBe('image/png');
    expect(imageMimeForName('x.jpeg')).toBe('image/jpeg');
    expect(imageMimeForName('x.jpg')).toBe('image/jpeg');
    expect(imageMimeForName('notes.txt')).toBeUndefined();
    expect(imageMimeForName('png')).toBeUndefined();
  });
});
