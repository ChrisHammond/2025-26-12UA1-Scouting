#!/usr/bin/env node
// scripts/update-teams-from-mhr.mjs
// Update teams from MyHockeyRankings: fetch rating + record, append rating history.
//
// Usage:
//   node scripts/update-teams-from-mhr.mjs                # update all teams with mhrUrl
//   node scripts/update-teams-from-mhr.mjs --slug=chesterfield-a1
//   node scripts/update-teams-from-mhr.mjs --dry-run
//
// Notes:
// - Uses shared HTML parsers in ./lib/mhr-parse.mjs
// - Rating is only written when meaningful; early-season 0.00 (or < MIN_GAMES_FOR_RATING games) won’t overwrite.
// - History appends only when a meaningful rating is present.
//
// Env:
//   MIN_GAMES_FOR_RATING (default 10)

import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchHtml,
  findRating,
  findRecord,
  findNationalRank,
  findStateRank,
} from "./lib/mhr-parse.mjs";

const PROJECT_ROOT = process.cwd();
const TEAMS_DIR = path.join(PROJECT_ROOT, "src", "content", "teams");
const HISTORY_DIR = path.join(PROJECT_ROOT, "src", "data", "mhr-history");

const MIN_GAMES_FOR_RATING = Number(process.env.MIN_GAMES_FOR_RATING || 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getArg(name, defVal = undefined) {
  const pref = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(pref)) return a.substring(pref.length);
    if (a === `--${name}`) return true;
  }
  return defVal;
}

const DRY_RUN = !!getArg("dry-run");
const ONLY_SLUG = getArg("slug", null);

async function readJson(file) {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
}
async function writeJson(file, data) {
  const content = JSON.stringify(data, null, 2) + "\n";
  if (DRY_RUN) {
    console.log("[dry-run] would write", file);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

async function listTeamFiles() {
  let files = [];
  try {
    const entries = await fs.readdir(TEAMS_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".json")) {
        files.push(path.join(TEAMS_DIR, e.name));
      }
    }
  } catch (e) {
    console.error("Cannot read teams dir", TEAMS_DIR, e.message);
  }
  return files;
}

function totalGamesFromRecord(record) {
  if (!record) return null;
  const parts = record.split("-").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  // W-L-[T?]
  return parts.slice(0, 3).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

async function updateTeam(teamPath) {
  const team = await readJson(teamPath);
  const slug = team.slug || path.basename(teamPath, ".json");
  if (!team.mhrUrl) {
    console.log(`- ${slug}: no mhrUrl, skipping.`);
    return;
  }

  console.log(`- ${slug}: fetching ${team.mhrUrl}`);

  let html;
  try {
    html = await fetchHtml(team.mhrUrl);
  } catch (err) {
    console.warn(`  ! fetch error: ${err.message}`);
    return;
  }

  // Parse fields
  const parsedRecord = findRecord(html);
  const parsedRating = findRating(html); // may be 0.00 early season
  const natRank = findNationalRank(html);
  const stRank = findStateRank(html);

  // Business rule: ratings are not meaningful until ~10 games played
  const gamesPlayed = totalGamesFromRecord(parsedRecord);
  const hasEnoughGames = gamesPlayed != null ? gamesPlayed >= MIN_GAMES_FOR_RATING : false;

  // Accept rating only if (a) found and (b) either enough games OR rating looks truly positive
  let ratingToWrite = null;
  if (parsedRating != null) {
    if (hasEnoughGames && parsedRating > 0) {
      ratingToWrite = parsedRating;
    } else if (parsedRating > 0) {
      // Some teams might show a >0 number earlier; if so, allow it
      ratingToWrite = parsedRating;
    } else {
      // Suppress 0.00/undefined when games < threshold—don’t overwrite existing rating
      console.log(
        `  rating suppressed (${parsedRating} with ${gamesPlayed ?? "?"} GP; min ${MIN_GAMES_FOR_RATING})`
      );
    }
  }

  let changed = false;
  const today = new Date().toISOString().slice(0, 10);

  // Update record (safe to update even if rating is suppressed)
  if (parsedRecord && parsedRecord !== team.record) {
    console.log(`  record: ${team.record ?? "—"} -> ${parsedRecord}`);
    team.record = parsedRecord;
    changed = true;
  }

  // Update rating only when meaningful
  if (ratingToWrite != null && ratingToWrite !== team.rating) {
    console.log(`  rating: ${team.rating ?? "—"} -> ${ratingToWrite}`);
    team.rating = ratingToWrite;
    changed = true;
  }

  // Update ranks (optional; may be null early)
  if (natRank != null && natRank !== team.mhrNationalRank) {
    console.log(`  national rank: ${team.mhrNationalRank ?? "—"} -> ${natRank}`);
    team.mhrNationalRank = natRank;
    changed = true;
  }
  if (stRank != null && stRank !== team.mhrStateRank) {
    console.log(`  state rank: ${team.mhrStateRank ?? "—"} -> ${stRank}`);
    team.mhrStateRank = stRank;
    changed = true;
  }

  team.lastUpdated = today;

  // Append to rating history only when rating is meaningful (ratingToWrite != null)
  if (ratingToWrite != null) {
    const historyFile = path.join(HISTORY_DIR, `${slug}.json`);
    let history = [];
    try {
      history = JSON.parse(await fs.readFile(historyFile, "utf8"));
      if (!Array.isArray(history)) history = [];
    } catch {}
    const last = history[history.length - 1];
    if (!last || last.date !== today || last.rating !== ratingToWrite) {
      history.push({ date: today, rating: ratingToWrite });
      await writeJson(historyFile, history);
      console.log(`  history: appended rating ${ratingToWrite} for ${today}`);
    }
  } else {
    // No rating written; do not modify history
  }

  if (changed) {
    await writeJson(teamPath, team);
    console.log(`  saved ${teamPath}`);
  } else {
    console.log(`  no changes.`);
  }
}

async function main() {
  const files = await listTeamFiles();
  if (files.length === 0) {
    console.error("No team JSON files found in", TEAMS_DIR);
    process.exit(1);
  }

  const targetFiles = ONLY_SLUG
    ? files.filter((f) => path.basename(f, ".json") === ONLY_SLUG)
    : files;

  console.log(`Updating ${targetFiles.length} team(s)...`);
  await fs.mkdir(HISTORY_DIR, { recursive: true });

  for (const f of targetFiles) {
    await updateTeam(f);
    await sleep(1200); // politeness delay
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
