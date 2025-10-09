#!/usr/bin/env node
/**
 * Refresh rating, record, mhrStateRank, mhrNationalRank for each team from MyHockeyRankings.
 * Uses Playwright Chromium to render client-side content; falls back to legacy text parse.
 *
 * Requirements:
 *   npm i -D playwright-chromium
 * In CI:
 *   npx playwright install --with-deps chromium
 *
 * Run:
 *   node scripts/update-teams-from-mhr.mjs
 *   node scripts/update-teams-from-mhr.mjs --debug
 */
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-chromium";

const TEAMS_DIR = "src/content/teams";
const DEFAULT_YEAR = new Date().getUTCFullYear();
const DEBUG = process.argv.includes("--debug");

const STATES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado",
  CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho",
  IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana",
  ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan", MN:"Minnesota",
  MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada",
  NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York",
  NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon",
  PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota",
  TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia",
  WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming", DC:"District of Columbia"
};
const STATE_NAMES = new Set(Object.values(STATES).map(s => s.toLowerCase()));
const STATE_ABBRS = new Set(Object.keys(STATES));

function todayISO() { return new Date().toISOString().slice(0, 10); }
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
async function readJson(p, fallback = null) { try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; } }
async function writeJson(p, data) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8"); }

function buildMhrUrl(team) {
  if (team?.mhrUrl) return String(team.mhrUrl);
  const id = team?.mhrTeamId ?? team?.mhrId;
  if (!id) return null;
  const y = team?.mhrYear ?? DEFAULT_YEAR;
  return `https://myhockeyrankings.com/team_info.php?y=${encodeURIComponent(y)}&t=${encodeURIComponent(id)}`;
}

/* ---------------- parsers ---------------- */

function parseNationalRank(text) {
  const m = text.match(/(\d+)(?:st|nd|rd|th)\s+(?:USA|United\s+States)\s+12U\b(?:\s*[-–]\s*[\w ]+)?/i);
  return m ? Number(m[1]) : undefined;
}

function parseStateRank(text, team) {
  // Full names
  for (const nm of STATE_NAMES) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${escapeRegExp(nm)}\s+12U\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // Abbreviations
  for (const abbr of STATE_ABBRS) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${abbr}\s+12U\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // Hints from team fields
  const hints = [team?.state, team?.mhrState, team?.region, team?.division].filter(Boolean);
  for (const hint of hints) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${escapeRegExp(String(hint))}\s+12U\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // Loose fallback: first non-USA 12U rank we see
  const rxLoose = /(\d+)(?:st|nd|rd|th)\s+([A-Za-z .'\-()]+?)\s+12U\b(?:\s*[-–]\s*[\w ]+)?/gi;
  let match; while ((match = rxLoose.exec(text))) {
    const label = match[2].trim();
    if (!/^USA\b/i.test(label) && !/United\s+States/i.test(label)) return Number(match[1]);
  }
  return undefined;
}

function parseRating(text) {
  // "MHR Rating: 86.07", "Power Rating: 86.07", "Rating 86.07"
  const rxes = [
    /\bMHR\s*Rating[:\s]+([0-9]+(?:\.[0-9]+)?)/i,
    /\bPower\s*Rating[:\s]+([0-9]+(?:\.[0-9]+)?)/i,
    /\bRating[:\s]+([0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const rx of rxes) {
    const m = text.match(rx);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function parseRecord(text) {
  // Pass 1: look for explicit labels
  const labeled =
    text.match(/\b(?:Overall(?:\s+Record)?|Season(?:\s+Record)?|Record|W[-\s]*L[-\s]*T)\s*[:\s]+(\d{1,3})\s*-\s*(\d{1,3})\s*-\s*(\d{1,3})/i);
  if (labeled) {
    return `${labeled[1]}-${labeled[2]}-${labeled[3]}`;
  }

  // Pass 2: generic triplet like 10-4-1 that is NOT a date (YYYY-MM-DD)
  // and not part of something like "2025-26 Rankings"
  const triplets = [...text.matchAll(/\b(\d{1,3})-(\d{1,3})-(\d{1,3})\b/g)]
    .map(m => ({ w:+m[1], l:+m[2], t:+m[3], raw:m[0], idx:m.index ?? 0 }));

  const plausible = triplets.filter(({w,l,t,idx}) => {
    // Skip if looks like a year-date pattern nearby (e.g., "2025-10-01")
    const prefix = text.slice(Math.max(0, idx - 5), idx);
    if (/\b20\d{2}$/.test(prefix)) return false;
    // Some sanity: wins/losses/ties won't be crazy large; allow up to 200
    if (w>200 || l>200 || t>200) return false;
    // At least one game played
    return (w + l + t) > 0;
  });

  if (plausible.length) {
    // choose the one with the largest games played (usually the "overall" line)
    plausible.sort((a,b) => (b.w+b.l+b.t) - (a.w+a.l+a.t));
    const p = plausible[0];
    return `${p.w}-${p.l}-${p.t}`;
  }

  return undefined;
}

/* -------------- extraction (browser / legacy) -------------- */

function normalizeText(s) {
  return String(s)
    .replace(/\u00a0/g, " ")     // NBSP → space
    .replace(/\s+/g, " ")
    .trim();
}

async function extractWithBrowser(url, team) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
    });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!resp || !resp.ok()) throw new Error(`HTTP ${resp ? resp.status() : "?"}`);

    // small delay to let client-side populate
    await page.waitForTimeout(1200);
    // Try to wait for something rank/rating-ish; ignore if it times out
    try { await page.waitForFunction(() => /Rating|Record|USA\s+12U/i.test(document.body.innerText), { timeout: 2000 }); } catch {}

    // IMPORTANT: get the full visible text, not filtered snippets
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    const bigText = normalizeText(bodyText);

    if (DEBUG) {
      console.log("— normalized text length:", bigText.length);
      await writeJson(`.debug/${(team.slug || "team")}-mhr-text.json`, { url, snippet: bigText.slice(0, 1600) });
    }

    return {
      nationalRank: parseNationalRank(bigText),
      stateRank: parseStateRank(bigText, team),
      rating: parseRating(bigText),
      record: parseRecord(bigText),
      text: bigText,
    };
  } finally {
    await browser.close();
  }
}

// Last-resort legacy HTML fetch (no JS)
async function extractLegacy(url, team) {
  const res = await fetch(url, { headers: { "User-Agent": "RankUpdater/1.1" } });
  if (!res.ok) return {};
  const html = await res.text();
  const text = normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  );

  if (DEBUG) {
    console.log("— normalized text length:", text.length);
    await writeJson(`.debug/${(team.slug || "team")}-mhr-text.html.json`, { url, snippet: text.slice(0, 1600) });
  }

  return {
    nationalRank: parseNationalRank(text),
    stateRank: parseStateRank(text, team),
    rating: parseRating(text),
    record: parseRecord(text),
    text
  };
}

/* ---------------- update wiring ---------------- */

const safeNumber = (n) =>
  (typeof n === "number" && Number.isFinite(n) && n > 0) ? n : undefined;

async function updateOneTeam(fp) {
  const team = await readJson(fp, null);
  if (!team) return { file: fp, skipped: true, reason: "invalid JSON" };

  const url = buildMhrUrl(team);
  if (!url) return { file: fp, skipped: true, reason: "no mhrUrl or id" };

  let info = await extractWithBrowser(url, team).catch(() => ({}));
  if (info.nationalRank == null && info.stateRank == null && info.rating == null && info.record == null) {
    info = await extractLegacy(url, team);
  }

  const nationalRank = info.nationalRank;
  const stateRank    = info.stateRank;
  const rating       = safeNumber(info.rating); // guard against bogus 0
  const record       = info.record && /^\d+-\d+-\d+$/.test(info.record) ? info.record : undefined;

  if (nationalRank == null && stateRank == null && rating == null && record == null) {
    return { file: fp, skipped: true, reason: "ranks/rating/record not found" };
  }

  const next = { ...team };
  let changed = false;

  // Apply updates if they differ
  if (stateRank != null && Number(next.mhrStateRank) !== Number(stateRank)) {
    next.mhrStateRank = Number(stateRank); changed = true;
  }
  if (nationalRank != null && Number(next.mhrNationalRank) !== Number(nationalRank)) {
    next.mhrNationalRank = Number(nationalRank); changed = true;
  }
  if (rating != null && Number(next.rating) !== Number(rating)) {
    next.rating = Number(rating); changed = true;
  }
  if (record && String(next.record) !== String(record)) {
    next.record = String(record); changed = true;
  }

  if (changed) next.lastUpdated = todayISO();

  if (changed) {
    await writeJson(fp, next);
    return {
      file: fp,
      changed: true,
      stateRank: next.mhrStateRank,
      nationalRank: next.mhrNationalRank,
      rating: next.rating,
      record: next.record
    };
  }
  return { file: fp, changed: false, reason: "no change" };
}

async function main() {
  const files = (await fs.readdir(TEAMS_DIR))
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(TEAMS_DIR, f));

  let changed = 0;
  for (const fp of files) {
    try {
      const res = await updateOneTeam(fp);
      const name = path.basename(fp, ".json");
      if (res.changed) {
        changed++;
        console.log(
          `✓ updated ${name}: state #${res.stateRank ?? "—"}, national #${res.nationalRank ?? "—"}${res.rating != null ? `, rating ${res.rating}` : ""}${res.record ? `, record ${res.record}` : ""}`
        );
      } else if (res.skipped) {
        console.log(`⏭  ${name}: ${res.reason}`);
      } else {
        console.log(`• ${name}: ${res.reason}`);
      }
      await new Promise((r) => setTimeout(r, 300)); // gentle throttle
    } catch (e) {
      console.warn(`! ${path.basename(fp)}: ${e?.message ?? e}`);
    }
  }
  if (changed === 0) console.log("No team files changed.");
}
main().catch((e) => { console.error(e); process.exit(1); });
