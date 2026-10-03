---
title: 'Hello, world: rebuilding my site with Astro'
description: 'Why I moved this site from hand-written HTML to Astro, and how it deploys to GitHub Pages.'
pubDate: 2026-10-03
tags: ['astro', 'github-pages']
---

This site started as a folder of hand-written HTML for coursework. It's now an [Astro](https://astro.build) site: pages are plain HTML at build time, and articles are just Markdown files.

## How publishing works

1. Write a new `.md` file in `src/content/articles/`.
2. Push to `master`.
3. A GitHub Actions workflow builds the site and deploys it to GitHub Pages.

## Front matter

Each article starts with a small block of metadata:

```yaml
---
title: 'My article'
description: 'One-line summary shown in lists.'
pubDate: 2026-10-03
tags: ['react']
---
```

Set `draft: true` to keep an article out of the build until it's ready.
