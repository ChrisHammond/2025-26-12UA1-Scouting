import { defineCollection, z } from "astro:content";

const teams = defineCollection({
  type: "data",
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    league: z.string().optional(),
    division: z.string().optional(),
    record: z.string().optional(),
    rating: z.number().optional(),
    website: z.string().url().optional(),
    mhrUrl: z.string().url().optional(),
    mhrStateRank: z.number().int().optional(),
    mhrNationalRank: z.number().int().optional(),
    lastUpdated: z.string().optional(),
    /** Free-text note for status, tryouts, etc. */
    note: z.string().optional(),
  }),
});

const tournaments = defineCollection({
  type: "data",
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    location: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    website: z.string().url().optional(),
    /**
     * Opponents can be either:
     *  - a slug string (references a team in /src/content/teams)
     *  - or an inline object for ad-hoc / tournament-only teams
     */
    opponents: z
      .array(
        z.union([
          z.string(),
          z.object({
            // Inline opponent (no /teams entry required)
            name: z.string(),
            website: z.string().url().optional(),
            mhrUrl: z.string().url().optional(),
            rating: z.number().optional(),
            mhrStateRank: z.number().int().optional(),
            mhrNationalRank: z.number().int().optional(),
            note: z.string().optional(),
            /**
             * Optional: if you ALSO have a /teams entry and want to
             * merge/enrich it on the tournament page.
             */
            slug: z.string().optional(),
          }),
        ])
      )
      .default([]),
  }),
});

const games = defineCollection({
  type: "data",
  schema: z.object({
    date: z.string(),
    opponent: z.string(),
    homeAway: z.enum(["Home", "Away", "Neutral"]).default("Neutral"),
    leagueGame: z.boolean().default(false),
    tournament: z.string().optional(),
    venue: z.string().optional(),
    result: z.enum(["W", "L", "T"]).optional(),
    scoreFor: z.number().optional(),
    scoreAgainst: z.number().optional(),
  }),
});

export const collections = { teams, tournaments, games };
