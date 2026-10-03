# wallinslax.github.io

Personal site and tech blog, built with [Astro](https://astro.build) and deployed to GitHub Pages.

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # output in dist/
```

## Write an article

Add a Markdown file to `src/content/articles/` with front matter (`title`, `description`, `pubDate`, optional `tags`, `draft`). Push to `master` and the `Deploy to GitHub Pages` workflow publishes it.

## Comments

Article comments use [giscus](https://giscus.app). Enable Discussions on this repo, install the giscus app, then copy `repoId` and `categoryId` from giscus.app into `GISCUS` in `src/consts.ts`.

## Old pages

The previous hand-written pages live in `public/legacy/` and are served at `/legacy/`.
