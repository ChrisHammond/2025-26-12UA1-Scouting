import { defineCollection, z } from 'astro:content';

const teams = defineCollection({
  type: "data",
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    division: z.string().optional(),
    league: z.string().optional(),
    // NEW (optional)
    website: z.string().url().optional(),
    mhrUrl: z.string().url().optional(),
    rating: z.number().optional(),
    record: z.string().optional(),
    lastUpdated: z.string().optional(),
    mhrStateRank: z.number().int().optional(),     // NEW
    mhrNationalRank: z.number().int().optional(),  // NEW
  }),
});

const tournaments = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    location: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    website: z.string().url().optional(),
    opponents: z.array(z.string()).default([]),
  }),
});

const games = defineCollection({
  type: 'data',
  schema: z.object({
    date: z.string(),
    opponent: z.string(),
    homeAway: z.enum(['Home','Away','Neutral']).default('Neutral'),
    leagueGame: z.boolean().default(false),
    tournament: z.string().optional(),
    venue: z.string().optional(),
    result: z.enum(['W','L','T']).optional(),
    scoreFor: z.number().optional(),
    scoreAgainst: z.number().optional(),
  }),
});

export const collections = { teams, tournaments, games };
