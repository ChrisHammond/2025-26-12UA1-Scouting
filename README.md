# Scouting Portal (Astro + Tailwind) — **Starter**

An almost-maybe-ready-to-use Astro site for youth hockey scouting: teams, tournaments, games, plus **MyHockeyRankings (MHR)** rating/record/ranks and a rating-history chart.

I dev/build this repo on a local Linux machine that has Astro and Node installed. You *might* run it 100% from Netlify, but debugging issues is much easier locally.

**Live example:** https://hockey.chrishammond.com/

---

## Features

- **Opponent scouting portal** built with Astro 5 + Tailwind (dark, Falcons-themed).
- **Teams directory** from `src/content/teams/*.json` with detail pages, records, MHR links, and optional team **note** (e.g., tryout status).
- **League table** filtered by league/division with **MHR Rating** and a combined **Rank (ST/NAT)** column  
  _(auto-hides if no teams have ranks yet to keep mobile narrow)_.
- **Tournaments** index + detail pages with participating teams and their **current MHR record/rating/ranks**.  
  Supports *inline “tournament-only” opponents* (no file in `/teams` required).
- **Tournament page links**: shows Website, and can also render **“Tournament Information”** and **“Standings/Schedule”** links if you add them (optional) in the tournament JSON.
- **Schedule** combines **manual games** and **auto-imported ICS** (webcal) games with de-duplication and source labeling.
- **Win probability** badge on schedule and matchup pages using a logistic model based on rating difference.
- **Matchup pages** (`/matchups/<opponent>/`) with a two-team **rating trend chart**, quick compare chips, and head-to-head preview.
- **Rating history charts** (Chart.js) per team with time-series of MHR rating.
- **Multi-team rating comparison** chart (homepage widget) for top/selected teams.
- **“Last built”** timestamp in the footer (America/Chicago) for freshness.
- **Content-first architecture** using `astro:content` schemas (Teams, Tournaments, Games) with strong typing.
- **MyHockeyRankings fields** per team: rating, state rank, national rank, URLs, and **history tracking** JSONs.
- **Automation**: GitHub Actions cron (daily) runs update scripts, commits changes, and can **trigger Netlify** via a build hook.
- **ICS updater** normalizes webcal → https, parses `.ics`, and maps events into uniform game objects.
- **Static prerendering** via `getStaticPaths()` for teams, tournaments, and matchups.
- **Responsive UI** with semantic tables/cards, hover states, and accessible link styles.
- **Graceful fallbacks** when data is incomplete (e.g., missing ratings/history show em dashes).
- **Developer ergonomics**: small utilities for probability, schedule normalization, and history updates; clear folder structure.

> **MHR timing:** Ratings/ranks often don’t populate until a team has ~10 games and after weekly tabulations. Early in the season you may see records only. The UI hides the combined rank column if nobody has ranks yet.

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

# 5) Build the site
npm run build  # output in /dist
```

---

## Configure Your Portal (branding & defaults)

Edit **`src/config/settings.ts`**:

- `portalName` – Site title in the header/footer and default `<title>`.
- `teamName` – Your team’s display name.
- `teamSlug` – Slug for your team (used to hide/highlight in lists).
- `leagueName` – Default league shown on the homepage table.
- `divisionName` – Default division/level on the homepage table.

The homepage league table reads these settings by default.

---

## Add Your Data (content files)

All season data lives in **`/src/content`**. You’ll mainly add/edit JSON files.

### Teams

Create one file per team in **`src/content/teams/`**:

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
  "lastUpdated": "YYYY-MM-DD",
  "note": "Text-based note shown on the team page"
}
```

> Only `name` and `slug` are required. The updater fills `rating`, `record`, ranks, and `lastUpdated` if `mhrUrl` is present.

### Tournaments

Create files in **`src/content/tournaments/`**:

```json
{
  "name": "River City Classic",
  "slug": "river-city-classic",
  "location": "St. Louis, MO",
  "startDate": "2025-10-10",
  "endDate": "2025-10-12",
  "website": "https://tournament-site.example.com",

  "opponents": [
    "your-team-slug",

    // You can also add "inline" opponents that do NOT exist in /teams:
    {
      "name": "Pittsburgh Aviators (2013)",
      "mhrUrl": "https://myhockeyrankings.com/team_info.php?y=2025&t=28561",
      "website": "https://www.pghaviators.com/team/119493",
      "note": "Tournament-only opponent"
      // The updater will fill these:
      // "record": "5-3-1",
      // "rating": 0,
      // "mhrStateRank": 12,
      // "mhrNationalRank": 255,
      // "updatedFromMHRAt": "2025-09-16T05:17:32.877Z"
    }
  ]

  /* Optional: include direct links shown on the tournament page
  "infoUrl": "https://event-host.example.com/this-tournament/info",
  "standingsUrl": "https://event-host.example.com/this-tournament/standings"
  */
}
```

Supported inline opponent fields:  
`name`, `slug?`, `website?`, `mhrUrl?`, `rating?`, `mhrStateRank?`, `mhrNationalRank?`, `record?`, `note?`, `lastUpdated?`, `updatedFromMHRAt?`.

### Games

Create files in **`src/content/games/`**:

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

## CLI & Scripts

### Astro

- `npm run dev` — start Astro dev server  
- `npm run build` — build the static site  
- `npm run preview` — preview the production build locally  
- `npm run astro -- <args>` — pass-through to Astro CLI (e.g., `npm run astro -- sync`)

### Data Updaters

- `npm run update:schedules` — fetch calendars (ICS) and write auto games to `src/data/auto-schedule/<team>.json`  
  **Examples**
  - `npm run update:schedules`
  - `npm run update:schedules -- --team=chesterfield-a1`

- `npm run update:teams` — scrape MHR for teams in `src/content/teams/` (when `mhrUrl` is set); update `record`, `rating`, ranks, and append to `src/data/mhr-history/<slug>.json`  
  **Examples**
  - `npm run update:teams`
  - `npm run update:teams -- --slug=rockets-a1`
  - `npm run update:teams -- --dry-run`

- `npm run update:tournaments:inline` — update **inline** tournament opponents (objects inside each tournament’s `opponents` array) from MHR; fills `record`, `rating`, ranks, and `updatedFromMHRAt`  
  **Examples**
  - `npm run update:tournaments:inline`
  - `npm run update:tournaments:inline -- --tournament=river-city-classic`
  - `npm run update:tournaments:inline -- --force`
  - `npm run update:tournaments:inline -- --debug`
  - `npm run update:tournaments:inline -- --dump-html`

- `npm run update:all` — run all data refreshers in sequence:  
  `update:schedules` → `update:teams` → `update:tournaments:inline`  
  **Example**
  - `npm run update:all`

---

## Schedule & Time Zones

- Schedule times display in **America/Chicago**.
- ICS events with explicit time zones are **converted to Central Time** for display.
- If an event time looks off, check the source feed’s local time zone/DST rules.

---

## Automated Daily Refresh (GitHub Actions)

A workflow in `.github/workflows/daily-refresh.yml`:

1. Installs dependencies  
2. Runs `astro sync`  
3. Runs data updaters (`update:schedules`, `update:teams`, `update:tournaments:inline`)  
4. Commits & pushes changes (if any)  
5. Optionally triggers Netlify via a build hook

**Setup**

- Ensure GitHub Actions are enabled for the repo.
- (Optional) Add a secret **`NETLIFY_BUILD_HOOK`** (Settings → Secrets and variables → Actions).
- Cron is specified in UTC; adjust as needed.

---

## Troubleshooting

**I removed a manual game but it still shows up.**  
The schedule merges manual `src/content/games/*.json` with auto ICS (`src/data/auto-schedule/<team>.json`) and de-duplicates by `(date|time|opponent)`. If the ICS still has the event, it will remain. Remove/update the event at the source (or delete the matching entry in `src/data/auto-schedule/…` and re-run `update:schedules`).

**Why did the rank column disappear?**  
If no teams have `mhrStateRank` or `mhrNationalRank`, the UI hides the combined **Rank (ST/NAT)** column (common early season).

**A tournament opponent’s record/rating didn’t update.**  
Run `npm run update:tournaments:inline` (optionally with `--tournament=<slug>`). Ensure each inline opponent has a valid `mhrUrl`.

**Times look wrong on the Schedule page.**  
Everything is displayed in America/Chicago. ICS events with explicit time zones are converted; if an event is incorrectly defined in the feed, it will display shifted. Verify the ICS entry’s time zone.

**MHR numbers look stale.**  
Re-run `npm run update:teams` (for teams) and/or `npm run update:tournaments:inline` (for inline opponents). Remember MHR ratings/ranks typically update weekly and often after ~10 games.

---

## License

MIT — see `LICENSE`.

---

## Credits

Originally built for the 2025–26 Chesterfield Falcons 12U A1 scouting portal. 🏒🟥⬛️  
Powered by Astro + Tailwind.
