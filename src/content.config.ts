import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const articles = defineCollection({
  loader: glob({ base: './src/content/articles', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

// Machine translations of articles, committed under translations/<lang>/articles/ (see AGENTS.md).
// Entry ids look like "ja/articles/hello-world".
const translations = defineCollection({
  loader: glob({ base: './translations', pattern: '*/articles/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    sourceHash: z.string(),
  }),
});

export const collections = { articles, translations };
