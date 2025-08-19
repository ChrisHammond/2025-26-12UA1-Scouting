# Scouting Portal (Astro + Tailwind) — **Starter**

An almost-maybe-ready-to-use Astro site for youth hockey scouting: teams, tournaments, games, plus **MyHockeyRankings (MHR)** rating/record/ranks and a rating-history chart.

This repo is designed to run on a local linux machine that has Astro and Node available. You may be able to run it 100% from Netlify without having a local build, but debugging any issues may become difficult. 

You can view what this looks like on our [LIVE PRODUCTION](https://chesterfield12ua1.netlify.app/) site.

---

## Quick Start

**Prereqs:** Node 18+ (20/22 OK), Git.

```bash
# 1) Clone your copy
git clone https://github.com/ChrisHammond/2025-26-12UA1-Scouting my-scouting-portal
cd my-scouting-portal

# 2) Install dependencies
npm install

# 3) Generate content types (first time / after schema changes)
npx astro sync

# 4) Run the dev server
npm run dev    # http://localhost:4321

# 5) Build static site
npm run build  # output in /dist
```

---

## Configure Your Portal (branding & defaults)

Edit **src/config/settings.ts** and update these values:

- `portalName` – Site title in the header/footer and default `<title>`.
- `teamName` – Your team’s display name.
- `teamSlug` – Slug for your team (used to hide/highlight in lists).
- `leagueName` – Default league shown on the homepage table.
- `divisionName` – Default division/level on the homepage table.

> The homepage league table reads these settings by default. You can still override props directly where `<LeagueTable />` is used if you want.

---

## Add Your Data (content files)

All season data lives in **/src/content**. You’ll mainly add/edit JSON files.

### Teams
Create one file per team in **src/content/teams/**:
```json
{
  "name": "YOUR TEAM NAME",
  "slug": "your-team-slug",
  "division": "12U A1",
  "league": "MO Hockey",
  "website": "https://yourteam.example.com",
  "mhrUrl": "https://myhockeyrankings.com/team_info.php?y=2025&t=XXXXX",
  "record": "0-0-0",
  "rating": 0,
  "mhrStateRank": 0,
  "mhrNationalRank": 0,
  "lastUpdated": "YYYY-MM-DD"
}
```
> Only `name` and `slug` are required to start. The updater fills `rating`, `record`, ranks, and `lastUpdated` if `mhrUrl` is present.

### Tournaments
Create files in **src/content/tournaments/**:
```json
{
  "name": "River City Classic",
  "slug": "river-city-classic",
  "location": "St. Louis, MO",
  "startDate": "2025-10-10",
  "endDate": "2025-10-12",
  "website": "https://tournament-site.example.com",
  "opponents": ["your-team-slug", "opponent-slug-2"]
}
```

### Games
Create files in **src/content/games/**:
```json
{
  "date": "2025-09-20",
  "opponent": "opponent-slug",
  "homeAway": "Home",
  "leagueGame": true,
  "tournament": "river-city-classic",
  "venue": "Arena 1",
  "result": "W",
  "scoreFor": 5,
  "scoreAgainst": 2
}
```
> After adding a lot of new content files or changing the schema in `src/content/config.ts`, run `npx astro sync` once.

---

## Update MHR Data (ratings, record, ranks, history)

This repo includes a script that reads each team’s `mhrUrl`, updates the team JSON, and appends rating history used by the chart.

```bash
# Update all teams that have "mhrUrl"
node scripts/update-teams-from-mhr.mjs

# Update a single team
node scripts/update-teams-from-mhr.mjs --slug=your-team-slug

# Dry run (no writes)
node scripts/update-teams-from-mhr.mjs --dry-run
```

It updates:
- `rating` (number), `record` (e.g., `10-4-2`)
- `mhrStateRank`, `mhrNationalRank`
- `lastUpdated` (ISO date)
- Appends `{ "date": "YYYY-MM-DD", "rating": 86.42 }` to `src/data/mhr-history/<slug>.json`

---

## Deploy on Netlify

1. Push your repo to GitHub/GitLab/Bitbucket.  
2. In Netlify, **Add new site → Import from Git** and select your repo.  
3. **Build command:** `npm run build`  
4. **Publish directory:** `dist`

> Optional: set `site` in `astro.config.mjs` for canonical URLs/sitemap once you have a permanent domain.

---

## Notes

- The team page’s rating-history chart uses `src/data/mhr-history/<slug>.json`. You’ll see a line once there are at least two entries (run the updater on different days).
- The footer shows a “Last built” timestamp automatically.

---

## License

Add your preferred license (MIT recommended).

---

## Credits

Originally built for a Falcons 12U A1 scouting portal. 🏒🟥⬛️  
Powered by Astro + Tailwind.
