#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchHtml,
  findRating,
  findRecord,
  findNationalRank,
  findStateRank,
} from "./lib/mhr-parse.mjs";

const TOURN_DIR = path.resolve("src/content/tournaments");

function getArg(name) {
  const p = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(p)) return a.slice(p.length);
    if (a === `--${name}`) return true;
  }
  return undefined;
}

const ARG_TOURN = getArg("tournament"); // substring match across filenames
const FORCE = !!getArg("force");
const DEBUG = !!getArg("debug");
const DUMP = !!getArg("dump-html");

// Default to 7 days unless overridden
const STALE_DAYS =
  Number.isFinite(+getArg("stale-days")) && +getArg("stale-days") > 0
    ? +getArg("stale-days")
    : 7;

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function listTournamentFiles() {
  const out = [];
  const entries = await fs.readdir(TOURN_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".json")) {
      const full = path.join(TOURN_DIR, e.name);
      if (!ARG_TOURN || e.name.toLowerCase().includes(ARG_TOURN.toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out;
}

async function updateFile(file) {
  const data = await readJson(file);
  let changed = false;

  if (!Array.isArray(data.opponents)) {
    if (DEBUG) console.log(`[${path.basename(file)}] no opponents array`);
    return false;
  }

  for (let i = 0; i < data.opponents.length; i++) {
    const opp = data.opponents[i];

    // Only update objects with an mhrUrl (strings are just slugs you manage in /teams)
    if (typeof opp === "string") continue;
    if (!opp || !opp.mhrUrl) continue;

    // Skip cached opponents unless forced or stale
    if (!FORCE && opp.updatedFromMHRAt && typeof opp.rating === "number" && opp.record) {
      let isFresh = true;
      const ageMs = Date.now() - new Date(opp.updatedFromMHRAt).getTime();
      const maxAgeMs = STALE_DAYS * 24 * 60 * 60 * 1000;
      isFresh = ageMs < maxAgeMs;
      if (DEBUG) {
        const ageDays = (ageMs / 86400000).toFixed(1);
        console.log(`  • cache age ${ageDays}d (limit ${STALE_DAYS}d) for "${opp.name}"`);
      }
      if (isFresh) {
        if (DEBUG) console.log(`  • skip (cached) "${opp.name}"`);
        continue;
      }
      if (DEBUG) console.log(`  • cache stale -> refreshing "${opp.name}"`);
    }

    if (DEBUG) console.log(`  • Fetching MHR for inline opponent "${opp.name}"`);
    let html;
    try {
      html = await fetchHtml(opp.mhrUrl);
    } catch (e) {
      console.warn(`    ! fetch error: ${e.message}`);
      continue;
    }

    if (DUMP) {
      const dumpDir = path.resolve("tmp/mhr-dumps");
      await fs.mkdir(dumpDir, { recursive: true });
      const fn = `${path.basename(file, ".json")}-op${i + 1}-${Date.now()}.html`;
      const out = path.join(dumpDir, fn);
      await fs.writeFile(out, html, "utf8");
      if (DEBUG) console.log(`    · dumped HTML -> ${path.relative(process.cwd(), out)}`);
    }

    const rating = findRating(html);
    const record = findRecord(html);
    const nat = findNationalRank(html);
    const st = findStateRank(html);

    if (DEBUG)
      console.log({
        ratingStr: rating != null ? String(rating.toFixed?.(2) ?? rating) : undefined,
        rating,
        record,
        mhrNationalRank: nat ?? undefined,
        mhrStateRank: st ?? undefined,
      });

    const before = JSON.stringify(opp);
    if (rating != null) opp.rating = rating;
    if (record) opp.record = record;
    if (nat != null) opp.mhrNationalRank = nat;
    if (st != null) opp.mhrStateRank = st;
    opp.updatedFromMHRAt = new Date().toISOString();

    if (JSON.stringify(opp) !== before) {
      changed = true;
    }
  }

  if (changed) {
    await writeJson(file, data);
    if (DEBUG) console.log(`  ✓ Updated ${path.basename(file)}`);
  }

  return changed;
}

async function main() {
  const files = await listTournamentFiles();
  if (!files.length) {
    console.log(
      ARG_TOURN
        ? `No tournament JSON matched "${ARG_TOURN}" in ${TOURN_DIR}`
        : `No tournament JSON found in ${TOURN_DIR}`
    );
    return;
  }

  let modified = 0;
  for (const f of files) {
    if (DEBUG) console.log(`\n[${path.basename(f)}]`);
    const did = await updateFile(f);
    if (did) modified++;
  }

  console.log(`\nDone. ${modified} file(s) updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
