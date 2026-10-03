# Agent guide

Personal site and tech blog for Sung-Fu Han, built with Astro and deployed to GitHub Pages
(`https://wallinslax.github.io`). Design principle: **less is more**. Articles are the main content.

## Project

- `src/pages/`: home (`index.astro`), articles list with tag filter, article pages, RSS
- `src/content/articles/*.md`: articles (front matter: `title`, `description`, `pubDate`, `tags`, `draft`)
- `src/consts.ts`: site title, description, links, giscus config
- `src/styles/global.css`: color tokens for light and dark themes
- Deploy: push to `master` runs `.github/workflows/deploy.yml`; PRs run the `build-check` job in `ci.yml`

## Commands

```sh
npm ci
npm run build    # must pass before any PR
npm run dev      # http://localhost:4321
```

## Always preview before opening a PR

The owner reviews changes visually before they go up. For every change that affects what the site
looks like or does:

1. **Build**: `npm run build` must succeed.
2. **Screenshot**: serve `dist/` (for example `python3 -m http.server 4322 -d dist`) and take
   Playwright screenshots of every changed page at desktop (about 1100px) and phone (390px)
   width, in light and dark mode. Check for horizontal overflow and broken layout. Share the
   screenshots with the user.
3. **Live preview**: when running in Claude Code with the Artifact tool, publish a clickable
   preview:
   - `python3 scripts/make-preview.py <scratch_dir>` copies `dist/` with relative links and writes
     `<scratch_dir>/site-preview.html`, printing the files to publish.
   - Publish `site-preview.html` with those files as a private artifact. Reuse the same artifact
     URL for later previews in the session.
   - Known preview limits: giscus comments, RSS, and `?tags=` deep links don't work there; they
     work on the real site.
4. **Wait for approval**: send the preview link and screenshots, then wait for the user to approve
   before opening the PR. Don't open or merge a PR without that go-ahead.

Changes with no visible effect (CI config, docs) skip steps 2–3 but still need a passing build.

## Conventions

- Keep the home page minimal: avatar, one-line intro, icon links, short About, latest articles.
- Never put the owner's email, student ID, API keys, or other private data on the site.
- Use the color tokens in `global.css`; every color must work in both themes.
- Tags are lowercase with hyphens (e.g. `github-pages`).
