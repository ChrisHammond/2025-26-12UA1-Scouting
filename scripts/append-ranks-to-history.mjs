#!/usr/bin/env node
// Append today's state/national ranks into mhr-history alongside rating (no scraping).
// Useful if your existing MHR updater doesn't yet add ranks to history.
import fs from "node:fs/promises";
import path from "node:path";

const TEAMS_DIR = "src/content/teams";
const HIST_DIR = "src/data/mhr-history";

function dateISO() {
  return new Date().toISOString().slice(0,10);
}

async function readJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; }
}
async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  const files = await fs.readdir(TEAMS_DIR);
  const today = dateISO();
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const team = await readJson(path.join(TEAMS_DIR, f));
    const slug = team.slug;
    const histPath = path.join(HIST_DIR, `${slug}.json`);
    const hist = (await readJson(histPath, [])) || [];
    // keep latest rating we have (either last entry or team.rating)
    const last = hist[hist.length - 1] || {};
    const rating = typeof team.rating === "number" ? team.rating : (typeof last.rating === "number" ? last.rating : undefined);
    const entry = {
      date: today,
      ...(typeof rating === "number" ? { rating } : {}),
      ...(typeof team.mhrStateRank === "number" ? { stateRank: team.mhrStateRank } : {}),
      ...(typeof team.mhrNationalRank === "number" ? { nationalRank: team.mhrNationalRank } : {}),
    };
    // avoid duplicate day
    const filtered = hist.filter(h => h.date !== today);
    filtered.push(entry);
    await writeJson(histPath, filtered);
    console.log(`updated history: ${slug}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
