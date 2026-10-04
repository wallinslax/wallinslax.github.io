import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Article files are named YYYY-MM-DD-slug.md so they sort by date in the editor;
// the date prefix is dropped from the id, so URLs stay /articles/slug/.
const withoutDate = ({ entry }: { entry: string }) => entry.replace(/\.mdx?$/, '').replace(/(^|\/)\d{4}-\d{2}-\d{2}-/, '$1');

const articles = defineCollection({
  loader: glob({ base: './src/content/articles', pattern: '**/*.{md,mdx}', generateId: withoutDate }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // 'offline' takes an article off the site (no page, no listing) without deleting the file.
    visibility: z.enum(['public', 'offline']).default('public'),
  }),
});

// Machine translations of articles, committed under translations/<lang>/articles/ (see AGENTS.md).
// Entry ids look like "ja/articles/hello-world".
const translations = defineCollection({
  loader: glob({ base: './translations', pattern: '*/articles/*.md', generateId: withoutDate }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    sourceHash: z.string(),
  }),
});

export const collections = { articles, translations };
