# Alerts, footnotes, HTML and code

## GitHub alerts

> [!NOTE]
> Useful information that users should know.

> [!TIP]
> Helpful advice for doing things better.

> [!IMPORTANT]
> Key information users need to know.

> [!WARNING]
> Urgent info that needs immediate attention.

> [!CAUTION]
> Advises about risks or negative outcomes.

> An ordinary quote stays an ordinary quote.

## Footnotes

Here is a sentence with a footnote.[^1] Another one follows.[^note-two] Hover a number to see its text.

[^1]: The first footnote, defined below the paragraph.
[^note-two]: A longer footnote
    that continues on an indented line.

## Raw HTML

Shown as source unless `mdEditor.renderHtml` is on:

<div align="center">
  <b>Centered bold text</b> with a <a href="https://example.com">link</a> and an image:
  <img src="cat.svg" alt="cat" width="80">
  <script>alert("never runs")</script>
</div>

## Code in several languages

```js
const greet = (name) => `Hello, ${name}!`; // comment
```

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

```json
{ "name": "sample", "version": 1, "tags": ["a", "b"] }
```

```yaml
title: Sample
items:
  - one
  - two
```

```sh
npm install && npm test
```

The end.
