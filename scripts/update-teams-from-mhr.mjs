#!/usr/bin/env node
/**
 * Refresh mhrStateRank / mhrNationalRank for each team from MyHockeyRankings.
 * Now renders the page (Playwright Chromium) so we can see client-side content.
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

// --- tolerant text parsers (work on full page text) ---
function parseNationalRank(text) {
  const m = text.match(/(\d+)(?:st|nd|rd|th)\s+(?:USA|United\s+States)\s+12U\b(?:\s*[-–]\s*[\w ]+)?/i);
  return m ? Number(m[1]) : undefined;
}
function parseStateRank(text, team) {
  // Try full names
  for (const nm of STATE_NAMES) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${escapeRegExp(nm)}\s+12U\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // Try abbreviations
  for (const abbr of STATE_ABBRS) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${abbr}\s+12U\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // Hints
  const hints = [team?.state, team?.mhrState, team?.region, team?.division].filter(Boolean);
  for (const hint of hints) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${escapeRegExp(String(hint))}\s+12U\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // First non-USA fallback
  const rxLoose = /(\d+)(?:st|nd|rd|th)\s+([A-Za-z .'\-()]+?)\s+12U\b(?:\s*[-–]\s*[\w ]+)?/gi;
  let match; while ((match = rxLoose.exec(text))) {
    const label = match[2].trim();
    if (!/^USA\b/i.test(label) && !/United\s+States/i.test(label)) return Number(match[1]);
  }
  return undefined;
}

// Extract text optimistically from rendered DOM.
async function extractRanksWithBrowser(url, team) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
    });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!resp || !resp.ok()) throw new Error(`HTTP ${resp ? resp.status() : "?"}`);

    // Wait a little for client-side modules/XHR to populate rank widgets
    await page.waitForTimeout(1200);

    // Try to find obvious rank nodes first (cheap/precise). If they’re present, great.
    // Otherwise fall back to all visible text.
    const textCandidates = await page.$$eval("*", (els) => {
      const ok = (s) => s && s.trim().length > 0;
      const take = [];
      for (const el of els) {
        const style = el.ownerDocument.defaultView?.getComputedStyle?.(el);
        if (!style || style.display === "none" || style.visibility === "hidden") continue;
        const t = el.textContent || "";
        if (!ok(t)) continue;
        // keep small blocks that likely contain “USA 12U” or “12U - All” or state
        if (/\b12U\b/i.test(t) || /\bUSA\b/i.test(t) || /\bUnited States\b/i.test(t)) {
          take.push(t.replace(/\s+/g, " ").trim());
        }
      }
      return take.slice(0, 200);
    });

    const bigText = (textCandidates.join("\n") || await page.content().then(h => h.replace(/<[^>]+>/g, " ")))
      .replace(/\s+/g, " ")
      .trim();

    if (DEBUG) {
      console.log("— normalized text length:", bigText.length);
      await writeJson(`.debug/${(team.slug || "team")}-mhr-text.json`, { url, snippet: bigText.slice(0, 1200) });
    }

    const nationalRank = parseNationalRank(bigText);
    const stateRank = parseStateRank(bigText, team);

    return { nationalRank, stateRank, text: bigText };
  } finally {
    await browser.close();
  }
}

// Last-resort legacy: fetch raw HTML (usually won’t have ranks)
async function extractRanksLegacy(url, team) {
  const res = await fetch(url, { headers: { "User-Agent": "RankUpdater/1.1" } });
  if (!res.ok) return {};
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
                   .replace(/<style[\s\S]*?<\/style>/gi, " ")
                   .replace(/<[^>]*>/g, " ")
                   .replace(/\s+/g, " ")
                   .trim();
  const nationalRank = parseNationalRank(text);
  const stateRank = parseStateRank(text, team);
  if (DEBUG) {
    console.log("— normalized text length:", text.length);
    await writeJson(`.debug/${(team.slug || "team")}-mhr-text.html.json`, { url, snippet: text.slice(0, 1200) });
  }
  return { nationalRank, stateRank, text };
}

async function updateOneTeam(fp) {
  const team = await readJson(fp, null);
  if (!team) return { file: fp, skipped: true, reason: "invalid JSON" };

  const url = buildMhrUrl(team);
  if (!url) return { file: fp, skipped: true, reason: "no mhrUrl or id" };

  let ranks = await extractRanksWithBrowser(url, team).catch(() => ({}));
  if ((ranks.nationalRank == null && ranks.stateRank == null)) {
    // fallback to legacy just in case
    ranks = await extractRanksLegacy(url, team);
  }

  const { nationalRank, stateRank } = ranks;
  if (nationalRank == null && stateRank == null) {
    return { file: fp, skipped: true, reason: "ranks not found" };
  }

  const next = { ...team };
  let changed = false;
  if (stateRank != null && Number(next.mhrStateRank) !== Number(stateRank)) {
    next.mhrStateRank = stateRank; changed = true;
  }
  if (nationalRank != null && Number(next.mhrNationalRank) !== Number(nationalRank)) {
    next.mhrNationalRank = nationalRank; changed = true;
  }
  if (changed) next.lastUpdated = todayISO();

  if (changed) {
    await writeJson(fp, next);
    return { file: fp, changed: true, stateRank: next.mhrStateRank, nationalRank: next.mhrNationalRank };
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
        console.log(`✓ updated ${name}: state #${res.stateRank ?? "—"}, national #${res.nationalRank ?? "—"}`);
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
