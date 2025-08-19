// scripts/update-teams-from-mhr.mjs
// Update teams from MyHockeyRankings: fetch rating + record, append rating history.
// Usage:
//   node scripts/update-teams-from-mhr.mjs                # update all teams with mhrUrl
//   node scripts/update-teams-from-mhr.mjs --slug=chesterfield-a1
//   node scripts/update-teams-from-mhr.mjs --dry-run
//
// Requirements: Node 18+ (global fetch), Astro project layout, Tailwind not required for this script.
//
// Notes:
// - Be respectful of MyHockeyRankings terms of use. This script uses plain HTML parsing and a tiny delay between requests.
// - If MHR changes their HTML, tweak the parsers (findRating/findRecord).
// - History is stored at src/data/mhr-history/<slug>.json (created on demand).

import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const TEAMS_DIR = path.join(PROJECT_ROOT, "src", "content", "teams");
const HISTORY_DIR = path.join(PROJECT_ROOT, "src", "data", "mhr-history");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// --- DOM-less text scrapers ---
function toText(html) {
  // Strip tags & condense whitespace
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
             .replace(/<style[\s\S]*?<\/style>/gi, " ")
             .replace(/<[^>]+>/g, " ")
             .replace(/\s+/g, " ")
             .trim();
}

function findRating(html) {
  const text = toText(html);

  // Common patterns around "Rating"
  const patterns = [
    /(?:^|\b)rating\b[:\s-]*([0-9]{1,3}(?:\.[0-9]+)?)/i,
    /MHR\s*Rating[:\s-]*([0-9]{1,3}(?:\.[0-9]+)?)/i,
    /Team\s*Rating[:\s-]*([0-9]{1,3}(?:\.[0-9]+)?)/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m) return parseFloat(m[1]);
  }

  // Fallback: first float between ~50–120 (typical range), but avoid crazy numbers
  const floatRe = /([0-9]{2,3}\.[0-9]+)/g;
  let best = null;
  for (const m of text.matchAll(floatRe)) {
    const v = parseFloat(m[1]);
    if (v >= 50 && v <= 120) { best = v; break; }
  }
  return best ?? null;
}

function findRecord(html) {
  const text = toText(html);

  // Look for "Record: W-L(-T?)" or "Overall: W-L(-T?)"
  const labeled = /(?:Record|Overall)\s*[:\-]?\s*([0-9]{1,3}-[0-9]{1,3}(?:-[0-9]{1,3})?)/i;
  const mm = text.match(labeled);
  if (mm) return mm[1];

  // Fallback: find first W-L(-T?) triple
  const raw = /\b([0-9]{1,3}-[0-9]{1,3}(?:-[0-9]{1,3})?)\b/;
  const m2 = text.match(raw);
  return m2 ? m2[1] : null;
}

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
      if (e.isFile() && e.name.endsWith(".json")) files.push(path.join(TEAMS_DIR, e.name));
    }
  } catch (e) {
    console.error("Cannot read teams dir", TEAMS_DIR, e.message);
  }
  return files;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Chesterfield-12U-A1-Scout/1.0 (+https://example.com)",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  return await res.text();
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

  const rating = findRating(html);
  const record = findRecord(html);

  let changed = false;
  const today = new Date().toISOString().slice(0,10);

  if (rating != null && rating !== team.rating) {
    console.log(`  rating: ${team.rating ?? "—"} -> ${rating}`);
    team.rating = rating;
    changed = true;
  }
  if (record && record !== team.record) {
    console.log(`  record: ${team.record ?? "—"} -> ${record}`);
    team.record = record;
    changed = true;
  }

  team.lastUpdated = today;

  // Append to history
  const historyFile = path.join(HISTORY_DIR, `${slug}.json`);
  let history = [];
  try {
    history = JSON.parse(await fs.readFile(historyFile, "utf8"));
    if (!Array.isArray(history)) history = [];
  } catch {}
  // Only append if new date or rating changed
  const last = history[history.length - 1];
  if (!last || last.date !== today || (rating != null && last.rating !== rating)) {
    if (rating != null) {
      history.push({ date: today, rating });
      await writeJson(historyFile, history);
      console.log(`  history: appended rating ${rating} for ${today}`);
    }
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
    await sleep(1200); // small politeness delay
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
