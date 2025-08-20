#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import fetch from "node-fetch";
import * as ical from "node-ical";

import { scheduleSources } from "./config/schedule-sources.mjs";
import { normalizeEvent, gameDedupKey } from "./lib/schedule-normalize.mjs";

const OUT_DIR = path.resolve("src/data/auto-schedule");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeIcsUrl(u) {
  return u.replace(/^webcal:/i, "https:");
}

async function fetchICS(url) {
  const normalized = normalizeIcsUrl(url);
  const res = await fetch(normalized, { headers: { "user-agent": "scouting-portal/1.0" } });
  if (!res.ok) throw new Error(`ICS fetch failed ${res.status} ${res.statusText}`);
  const text = await res.text();
  return ical.parseICS(text);
}

async function fromIcs(url, selfName) {
  const parsed = await fetchICS(url);
  const events = Object.values(parsed).filter((v) => v && v.type === "VEVENT");
  const normalized = events.map((e) =>
    normalizeEvent(
      {
        id: e.uid ?? e.summary,
        title: e.summary,
        start: e.start?.toISOString(),
        end: e.end?.toISOString(),
        location: e.location,
        url: e.url,
        source: "ics",
      },
      selfName,
      "ics"
    )
  );
  return normalized;
}

async function buildForTeam(teamSlug) {
  const sources = scheduleSources[teamSlug] ?? [];
  let games = [];
  let selfName = teamSlug.replace(/[-_]/g, " ");

  for (const src of sources) {
    if (src.selfName) selfName = src.selfName;
    try {
      if (src.type === "ics") {
        games = await fromIcs(src.url, selfName);
      }
      // Add fallbacks here if needed
      if (games.length) break; // first non-empty wins
    } catch (err) {
      console.warn(`[${teamSlug}] ${src.type} failed:`, err.message);
    }
  }

  // Dedup
  const map = new Map();
  for (const g of games) map.set(gameDedupKey(g), g);
  const unique = [...map.values()].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
  return unique;
}

async function main() {
  const argSlug = process.argv.find((a) => a.startsWith("--team="))?.split("=")[1];
  await ensureDir(OUT_DIR);

  const slugs = argSlug ? [argSlug] : Object.keys(scheduleSources);
  if (!slugs.length) {
    console.log("No teams configured in scripts/config/schedule-sources.mjs");
    process.exit(0);
  }

  for (const slug of slugs) {
    console.log(`Fetching schedule for ${slug}...`);
    const games = await buildForTeam(slug);
    const outFile = path.join(OUT_DIR, `${slug}.json`);
    await writeJson(outFile, games);
    console.log(`  wrote ${games.length} games -> ${path.relative(process.cwd(), outFile)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
