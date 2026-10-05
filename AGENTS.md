# Agent guide

Personal site and tech blog for Sung-Fu Han, built with Astro and deployed to GitHub Pages
(`https://wallinslax.github.io`). Design principle: **less is more**. Articles are the main content.

## Project

- `src/components/pages/`: home, articles list (with tag filter), and article page, each taking a `lang`
- `src/pages/`: thin routes for English (`/`) and translations (`src/pages/[lang]/` → `/ja/`, `/zh-tw/`), plus RSS
- `src/content/articles/YYYY-MM-DD-slug.md`: articles, named with their `pubDate` so they sort by date in the editor (the date is dropped from the URL, which stays `/articles/slug/`; translations use the same file name) (front matter: `title`, `description`, `pubDate`, `tags`, `visibility`: `draft` by default while it's still being written, `public` to publish it, or `offline` to take a finished article off the site without deleting it; only `public` articles appear on the deployed site; drafts also show in `npm run dev` and in a `SHOW_DRAFTS=1 npm run build`, for previewing). Lists are sorted newest first in `getArticles()` (`src/utils.ts`)
- `src/consts.ts`: site title, links, giscus and Google Analytics config
- `src/components/Analytics.astro` + `ConsentBar.astro`: GA4 with Consent Mode; loads only on the live host, and only European-time-zone visitors see the consent bar
- `src/styles/global.css`: color tokens for light and dark themes
- Search: `@astrojs/sitemap` (in `astro.config.mjs`) generates `sitemap-index.xml` on every build, so
  never edit a sitemap by hand. `public/robots.txt` points to it, `BaseLayout.astro` adds schema.org
  `Person` data on the home page, and `public/google*.html` is the Search Console verification file
  (don't delete it). If the site URL ever changes, update `site` in `astro.config.mjs` and the
  `Sitemap:` line in `robots.txt`
- `src/i18n/en.json`: all English UI text (nav, buttons, home intro). `src/i18n/index.ts`: language helpers
- `translations/<lang>/`: committed machine translations (`ja`, `zh-tw`); see "Translations" below
- `src/voices.ts`: the one read-aloud voice per language (en, ja, zh-TW) for the Listen button; no voice picker by design
- Deploy: push to `mainline` runs `.github/workflows/deploy.yml`; PRs run the `build-check`, `commit-format`, and `vale` jobs in `ci.yml`

## Commands

```sh
npm ci
npm run build    # the one check before any PR: article format + site build
npm run dev      # http://localhost:4321
```

## Translate when an article goes public

Drafts are for iterating on the English: don't translate an article while its `visibility` is
`draft` (or `offline`). Translation starts when an article becomes `public`, and from then on
every edit to a public article, or any change to `src/i18n/en.json`, ships with updated
Japanese and Traditional Chinese translations in the same PR, before the preview step:
run `node scripts/i18n-status.mjs`, translate everything it lists (one subagent per language),
and re-run it until it reports "Translations are up to date". Details in "Translations" below.

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
   - Publish `site-preview.html` with **every** file it prints as a private artifact, including
     `_astro/*.css` and images, not just the HTML pages; otherwise the preview renders unstyled. Reuse the same artifact
     URL for later previews in the session.
   - Known preview limits: giscus comments, RSS, and `?tags=` deep links don't work there; they
     work on the real site.
4. **Wait for approval**: send the preview link and screenshots, then wait for the user to approve
   before opening the PR. Don't open or merge a PR without that go-ahead.

Changes with no visible effect (CI config, docs) skip steps 2–3 but still need a passing build.

## Translations

English is the only source language. Japanese (`ja`) and Traditional Chinese for Taiwan (`zh-tw`)
are machine translations written by Claude Code (no API key, no translation step in CI) and
committed under `translations/`. English pages live at `/`, translations at `/ja/` and `/zh-tw/`.

- `node scripts/i18n-status.mjs` lists missing, stale, and orphaned translations with the
  `sourceHash` each article translation must record (`--json` for agents).
- It only checks `public` articles. Run it whenever a public article or `src/i18n/en.json` changes,
  or an article becomes public, and bring translations up to date in the same PR. Use one subagent per language when there is more than a little to do.
- Stale or missing translations never break the site: an article whose `sourceHash` doesn't match
  its English source is shown in English, and a UI string whose `source` doesn't match is shown in
  English.

File formats:

- `translations/<lang>/ui.json`: one entry per key of `src/i18n/en.json`:
  `{ "<key>": { "source": "<the exact current English text>", "text": "<translation>" } }`.
- `translations/<lang>/articles/<same file name as English>.md`:

  ```md
  ---
  title: "<translated title>"
  description: "<translated description>"
  sourceHash: "<hash from i18n-status>"
  ---
  <translated body>
  ```

  Only `title`, `description`, and `sourceHash` go in front matter; dates and tags come from the
  English article.

Translation rules:

- Write natural prose a native engineer would publish, not a word-for-word rendering.
  `ja`: polite です/ます style typical of Japanese tech blogs. `zh-tw`: Traditional Chinese with
  Taiwan terminology (程式, 資料庫, 伺服器, 介面, 預設; never Mainland terms like 程序, 数据库, 默认).
- Keep Markdown structure, headings, lists, and links. Translate link text, keep URLs.
- Never change code blocks or inline code. Keep product names, API names, HTTP verbs, and field
  names (`queryId`, `retryOf`) as is.
- For key technical terms, use the established local term and add the English in parentheses on
  first use, e.g. 冪等性（idempotency）.
- Keep HTML tags and `{placeholders}` in UI strings exactly as in the English.
- Don't add, drop, or summarize content.

## Podcasts

An article page shows a Podcast button only when `public/podcasts/<lang>/<article file name>.m4a`
exists for that page's language (`en`, `ja`, `zh-tw`), e.g.
`public/podcasts/ja/2026-10-02-agents-are-async-redrive-is-not-retry.m4a`; otherwise there is no
button. The owner makes episodes in NotebookLM (Audio Overview) and drops the files in
`public/podcasts/`. Move each into its language folder, rename it to match the article, and
re-encode it to mono AAC at 96 kbps to keep the repo small (`afconvert` to a mono WAV first, then
to `m4af`/`aac`).

## Article style

The one place for how articles are written. Every new or edited English article follows it.

- **Start from a real problem**: something you hit at work or saw others hit, stated in the
  first paragraph. Not a topic survey.
- **Why first**: a `## Why…` section early on explains why the problem exists and why it's worth
  researching, before any What or How. Why → What → How is the default shape. (The 2021 SRE → SWE
  essay is a "why" throughout and stays as it is.)
- **Back claims with sources**: cite facts, numbers, and other people's ideas inline, and list
  every source in a final `## References` section.
- **End for the reader**: close with the takeaways (a short list, such as a `## Checklist`), then
  `## Question for you` with one or two questions for readers, then `## References`.
- **Length**: a 5–6 minute read (about 1,100–1,300 words; the reading time excludes References).
  Tighten or split a bigger topic into a series rather than going long.
- **Wording**: follow the [Google developer documentation style guide](https://developers.google.com/style),
  except that first person ("I", "we") is fine for a personal blog. The `vale` job in `ci.yml`
  checks this on the articles a PR changes (config in `.vale.ini`); there's nothing to run locally.
- **Tags** are lowercase with hyphens (e.g. `github-pages`).

`npm run build` runs `scripts/check-articles.mjs` first. For every public article it fails the build
when the `## Why…` section isn't first or second, the article doesn't end with a takeaways list →
`## Question for you` → `## References`, References has no links, or an inline `[[n]](#ref-n)`
citation has no matching entry. Drafts get the same messages as warnings only, and any article
outside a 5–6 minute read gets a warning. It can't judge whether the problem is real or every claim is backed:
that's for review.

## Conventions

- Keep the home page minimal: avatar, one-line intro, icon links, short About, latest articles.
- Never put the owner's email, student ID, API keys, or other private data on the site.
- Use the color tokens in `global.css`; every color must work in both themes.
- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): summary`, lowercase type, imperative summary, no trailing period, e.g.
  `feat(article): add share button`, `fix(seo): add robots.txt`, `docs(agents): note sitemap`.
  Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
  The `commit-format` job in `ci.yml` rejects PRs that don't match.
