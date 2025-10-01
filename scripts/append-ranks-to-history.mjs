#!/usr/bin/env node
// Append today's state/national ranks into mhr-history alongside rating,
// and also emit a small snapshot file with ranks for page fallbacks.
// Works without scraping: relies on team content having rating/rank fields.
import fs from "node:fs/promises";
import path from "node:path";

const TEAMS_DIR = "src/content/teams";
const HIST_DIR = "src/data/mhr-history";
const SNAP_DIR = "src/data/mhr-snapshot";

function dateISO() {
  return new Date().toISOString().slice(0, 10);
}

async function readJson(p, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const text = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(p, text, "utf8");
}

function coerceRank(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = value.match(/\d+/); // first number in the string
    if (m) return Number(m[0]);
  }
  return undefined;
}

function stableMergeEntry(existing = {}, next = {}) {
  // Keep existing fields if next doesn't provide them; overwrite if next does.
  // Also keep key order somewhat stable for cleaner diffs.
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  const merged = {};
  for (const k of keys) merged[k] = next[k] !== undefined ? next[k] : existing[k];
  return merged;
}

async function main() {
  const files = await fs.readdir(TEAMS_DIR);
  const today = dateISO();

  for (const f of files) {
    if (!f.endsWith(".json")) continue; // this script expects JSON content entries
    const teamPath = path.join(TEAMS_DIR, f);
    const team = await readJson(teamPath);
    if (!team || !team.slug) {
      console.warn(`Skipping ${f}: no team or slug.`);
      continue;
    }

    const slug = String(team.slug);
    const histPath = path.join(HIST_DIR, `${slug}.json`);
    const hist = (await readJson(histPath, [])) || [];

    // Determine rating we should store today
    const last = hist[hist.length - 1] || {};
    const rating =
      typeof team.rating === "number"
        ? team.rating
        : typeof last.rating === "number"
        ? last.rating
        : undefined;

    // Coerce ranks from various possible fields (numbers or strings)
    const stateRank =
      coerceRank(team.mhrStateRank) ??
      coerceRank(team.stateRank) ??
      coerceRank(team.mhrStateRankText) ??
      coerceRank(team.mhr?.stateRank) ??
      coerceRank(team.mhr?.ranks?.state);

    const nationalRank =
      coerceRank(team.mhrNationalRank) ??
      coerceRank(team.nationalRank) ??
      coerceRank(team.mhrNationalRankText) ??
      coerceRank(team.mhr?.nationalRank) ??
      coerceRank(team.mhr?.ranks?.national);

    // Build the "today" entry (only include fields we actually have)
    const nextEntry = {
      date: today,
      ...(typeof rating === "number" ? { rating } : {}),
      ...(stateRank != null ? { stateRank } : {}),
      ...(nationalRank != null ? { nationalRank } : {}),
    };

    // If we already have an entry for today, merge it; otherwise append
    let changed = false;
    const idx = hist.findIndex((h) => h.date === today);
    if (idx >= 0) {
      const merged = stableMergeEntry(hist[idx], nextEntry);
      // Only update if something actually changed
      const before = JSON.stringify(hist[idx]);
      const after = JSON.stringify(merged);
      if (before !== after) {
        hist[idx] = merged;
        changed = true;
      }
    } else {
      hist.push(nextEntry);
      changed = true;
    }

    // Persist history if changed
    if (changed) {
      await writeJson(histPath, hist);
      console.log(`✓ history updated: ${slug}`);
    } else {
      console.log(`• history unchanged: ${slug}`);
    }

    // Write rank snapshot(s) for page fallback usage if we have ranks
    if (stateRank != null || nationalRank != null) {
      const snap = {
        ...(stateRank != null ? { stateRank } : {}),
        ...(nationalRank != null ? { nationalRank } : {}),
      };

      // by slug
      const snapSlugPath = path.join(SNAP_DIR, `${slug}.json`);
      const prevSnapSlug = await readJson(snapSlugPath, {});
      if (JSON.stringify(prevSnapSlug) !== JSON.stringify(snap)) {
        await writeJson(snapSlugPath, snap);
        console.log(`✓ snapshot updated: ${path.basename(snapSlugPath)}`);
      }

      // by numeric id, if present
      const idLike =
        (team.mhrTeamId && String(team.mhrTeamId)) ||
        (team.mhrId && String(team.mhrId)) ||
        null;
      if (idLike) {
        const snapIdPath = path.join(SNAP_DIR, `${idLike}.json`);
        const prevSnapId = await readJson(snapIdPath, {});
        if (JSON.stringify(prevSnapId) !== JSON.stringify(snap)) {
          await writeJson(snapIdPath, snap);
          console.log(`✓ snapshot updated: ${path.basename(snapIdPath)}`);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
