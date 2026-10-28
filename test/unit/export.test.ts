import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectDiagramSources, collectImageSources, renderHtml } from '../../src/export';

const page = (markdown: string, options = {}) => renderHtml(markdown, options);

describe('renderHtml', () => {
  it('makes a standalone page with a title from the first heading', () => {
    const html = page('# My *Doc*\n\ntext\n');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<title>My Doc</title>');
    expect(html).toContain('<h1 id="my-doc">');
    expect(html).toContain("default-src 'none'");
  });

  it('gives headings the same anchors as GitHub, numbering repeats', () => {
    const html = page('# Usage\n## Usage\n');
    expect(html).toContain('<h1 id="usage">');
    expect(html).toContain('<h2 id="usage-1">');
  });

  it('renders tables, strikethrough and task lists', () => {
    const html = page('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~old~~\n\n- [x] done\n- [ ] todo\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<s>old</s>');
    expect(html).toContain('<input type="checkbox" disabled checked> done');
    expect(html).toContain('<input type="checkbox" disabled> todo');
    expect(html).toContain('class="task-list-item"');
  });

  it('renders GitHub alerts and leaves ordinary quotes alone', () => {
    const html = page('> [!WARNING]\n> Careful.\n\n> plain quote\n');
    expect(html).toContain('class="alert alert-warning"');
    expect(html).toContain('<p class="alert-title">Warning</p>');
    expect(html).toContain('Careful.');
    expect(html).not.toContain('[!WARNING]');
    expect(html).toContain('<blockquote>\n<p>plain quote');
  });

  it('renders footnotes', () => {
    const html = page('Text[^1].\n\n[^1]: The note.\n');
    expect(html).toContain('footnote-ref');
    expect(html).toContain('The note.');
  });

  it('strips front matter', () => {
    const html = page('---\ntitle: Secret\n---\n\n# Body\n');
    expect(html).not.toContain('Secret');
    expect(html).toContain('<h1 id="body">');
  });

  describe('math', () => {
    it('renders inline, block and fenced math, and adds the KaTeX stylesheet', () => {
      const html = page('Inline $x^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\n```math\ny\n```\n', {
        katexCss: '.katex{color:red}',
      });
      expect(html.match(/class="katex"/g)?.length).toBe(3);
      expect(html).toContain('.katex{color:red}');
    });

    it('leaves prices and escaped dollars as text and skips the stylesheet', () => {
      const html = page('It costs $5 and $10, or \\$x\\$.\n', { katexCss: '.katex{color:red}' });
      expect(html).not.toContain('class="katex"');
      expect(html).not.toContain('.katex{color:red}');
      expect(html).toContain('$5 and $10');
    });

    it('does not break on invalid TeX', () => {
      expect(() => page('$\\badcommand{$\n')).not.toThrow();
    });
  });

  describe('safety', () => {
    it('escapes raw HTML, including scripts', () => {
      const html = page('<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>\n');
      expect(html).not.toContain('<script>alert');
      expect(html).not.toMatch(/<img src=x/);
      expect(html).toContain('&lt;script&gt;');
    });

    it('passes raw HTML blocks through, sanitized, when asked to', () => {
      const raw =
        '<div align="center">\n<b>Bold</b> <a href="https://example.com" onclick="x()">link</a>\n<img src="cat.svg" width="80" onerror="x()">\n<script>alert(1)</script>\n</div>\n';
      const images = new Map([
        ['cat.svg', { mime: 'image/svg+xml', data: new Uint8Array([1, 2, 3]) }],
      ]);
      const html = page(raw, { rawHtml: true, images });
      expect(html).toContain('<div align="center">');
      expect(html).toContain('<b>Bold</b>');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('src="data:image/svg+xml;base64,AQID"');
      expect(html).not.toMatch(/onclick|onerror|<script>alert/);
      expect(collectImageSources(raw, true)).toEqual(['cat.svg']);
      expect(collectImageSources(raw)).toEqual([]);
    });

    it('drops javascript: links in raw HTML', () => {
      const html = page('<div><a href="javascript:alert(1)">x</a></div>\n', { rawHtml: true });
      expect(html).not.toContain('javascript:');
    });

    it('does not link javascript: targets', () => {
      const html = page('[x](javascript:alert(1)) and [y](https://example.com)\n');
      expect(html).not.toContain('href="javascript:');
      expect(html).toContain('href="https://example.com"');
    });

    it('escapes the title', () => {
      expect(page('x', { title: '</title><script>' })).toContain(
        '<title>&lt;/title&gt;&lt;script&gt;</title>',
      );
    });
  });

  describe('diagrams', () => {
    const md = '```mermaid\ngraph TD; A-->B\n```\n\n```js\nlet x;\n```\n';

    it('lists Mermaid sources, once each', () => {
      expect(collectDiagramSources(`${md}\n${md}`)).toEqual(['graph TD; A-->B\n']);
    });

    it('draws the diagrams it is given and keeps others as code', () => {
      const svg = '<svg viewBox="0 0 1 1"></svg>';
      const html = page(md, { diagrams: new Map([['graph TD; A-->B\n', svg]]) });
      expect(html).toContain(
        `<div class="diagram" role="img" aria-label="Mermaid diagram">${svg}</div>`,
      );
      expect(html).toContain('<code class="language-js">');
      expect(page(md)).toContain('language-mermaid');
    });
  });

  describe('images', () => {
    const images = new Map([['pic.png', { mime: 'image/png', data: new Uint8Array([1, 2, 3]) }]]);

    it('embeds the images it is given and leaves others as they are', () => {
      const html = page('![a](pic.png) ![b](other.png)\n', { images });
      expect(html).toContain('src="data:image/png;base64,AQID"');
      expect(html).toContain('src="other.png"');
    });

    it('lists the images a document uses, once each', () => {
      expect(
        collectImageSources('![a](pic.png)\n\ntext ![b](assets/x.png) ![c](pic.png)\n'),
      ).toEqual(['pic.png', 'assets/x.png']);
    });
  });
});

describe('the sample corpus', () => {
  const dir = join(__dirname, '..', 'corpus');

  for (const name of readdirSync(dir).filter((file) => file.endsWith('.md'))) {
    it(`exports ${name} without script or errors`, () => {
      const html = renderHtml(readFileSync(join(dir, name), 'utf8'));
      expect(html).toContain('<article>');
      expect(html).not.toMatch(/<script/i);
    });
  }
});
