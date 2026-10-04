---
title: 'Syntax highlighting test'
description: 'A quick check that code blocks render nicely in light and dark mode.'
pubDate: 2026-10-02
tags: ['notes']
visibility: offline
---

Code blocks are highlighted at build time, so there's no JavaScript cost for readers.

```ts
type Article = {
  title: string;
  pubDate: Date;
  tags: string[];
};

export function latest(articles: Article[], n = 3) {
  return [...articles].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf()).slice(0, n);
}
```

Inline code like `npm run dev` works too.
