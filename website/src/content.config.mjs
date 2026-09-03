import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ base: './src/data/blog', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    category: z.enum(['Learning', 'Speaking', 'Product', 'Company']),
    readMinutes: z.number().int().positive(),
    heroImage: z.string(),
    heroAlt: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
