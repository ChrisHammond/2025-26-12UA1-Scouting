#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  // prefer your existing fetch for consistency (headers, etc.)
  fetchHtml as libFetchHtml,
} from "./lib/mhr-parse.mjs";

const TOURN_DIR = path.resolve("src/content/tournaments");

/* ---------------- arg parsing ---------------- */

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
const INCLUDE_PAST = !!getArg("include-past");

// Default to 7 days unless overridden
const STALE_DAYS =
  Number.isFinite(+getArg("stale-days")) && +getArg("stale-days") > 0
    ? +getArg("stale-days")
    : 7;

/* ---------------- date helpers to skip past tournaments ---------------- */

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function makeDateUTC(y, m0, d) {
  // Construct at local midnight for simple < comparison w.r.t. today local midnight.
  const dt = new Date(Date.UTC(y, m0, d));
  // Normalize to local midnight by building a Date with local TZ components
  return new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}
function parseMonthToken(tok) {
  if (!tok) return undefined;
  const k = String(tok).trim().toLowerCase();
  return MONTHS[k];
}
function parseIsoDate(s) {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : undefined;
}

/** Try to parse a human date range string and return an end Date (local midnight). */
function parseEndDateFromString(str) {
  if (!str) return undefined;
  const s = String(str).trim();

  // ISO range like "2025-10-18 to 2025-10-20" or "2025-10-18 - 2025-10-20"
  {
    const m = s.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|[-–—])\s*(\d{4}-\d{2}-\d{2})/i);
    if (m) {
      const end = parseIsoDate(m[2]);
      if (end) return end;
    }
  }

  // "Oct 18–20, 2025"  (same month)
  {
    const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*[-–—]\s*(\d{1,2}),\s*(\d{4})/);
    if (m) {
      const mon = parseMonthToken(m[1]); const d2 = +m[3]; const y = +m[4];
      if (mon != null && d2 >= 1 && y >= 1900) return makeDateUTC(y, mon, d2);
    }
  }

  // "Oct 30–Nov 2, 2025" (month changes)
  {
    const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
    if (m) {
      const mon2 = parseMonthToken(m[3]); const d2 = +m[4]; const y = +m[5];
      if (mon2 != null && d2 >= 1 && y >= 1900) return makeDateUTC(y, mon2, d2);
    }
  }

  // "Oct 21, 2025" (single day)
  {
    const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
    if (m) {
      const mon = parseMonthToken(m[1]); const d = +m[2]; const y = +m[3];
      if (mon != null && d >= 1 && y >= 1900) return makeDateUTC(y, mon, d);
    }
  }

  // plain ISO single date "2025-10-21"
  {
    const m = s.match(/^\d{4}-\d{2}-\d{2}$/);
    if (m) {
      const d = parseIsoDate(s);
      if (d) return d;
    }
  }

  return undefined;
}

/** Derive a tournament end date from common fields inside the JSON structure. */
function getTournamentEndDate(t) {
  // Direct fields that might exist
  const cand = t?.endDate || t?.end || t?.dateEnd || t?.date_to || t?.to;
  if (cand) {
    const d = parseIsoDate(cand) || parseEndDateFromString(cand);
    if (d) return d;
  }

  // Combined dates string fields
  const dateStrings = [
    t?.dates, t?.tournamentDates, t?.tournament?.dates, t?.dateRange, t?.when
  ].filter(Boolean);

  for (const ds of dateStrings) {
    const d = parseIsoDate(ds) || parseEndDateFromString(ds);
    if (d) return d;
  }

  // If we only have start-like fields, use them as end (1-day event)
  const startCand = t?.startDate || t?.start || t?.dateStart || t?.date_from || t?.from;
  if (startCand) {
    const d = parseIsoDate(startCand) || parseEndDateFromString(startCand);
    if (d) return d;
  }

  return undefined;
}

function isPast(endDate) {
  if (!endDate) return false;
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return endDate < todayMid;
}

/* ---------------- shared parsers (mirrors team script + upgrades) ---------------- */

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

// Canadian provinces (so "ON", "QC", etc. parse)
const PROVINCES = {
  AB:"Alberta", BC:"British Columbia", MB:"Manitoba", NB:"New Brunswick",
  NL:"Newfoundland and Labrador", NS:"Nova Scotia", NT:"Northwest Territories",
  NU:"Nunavut", ON:"Ontario", PE:"Prince Edward Island", QC:"Quebec",
  SK:"Saskatchewan", YT:"Yukon"
};
const PROVINCE_NAMES = new Set(Object.values(PROVINCES).map(s => s.toLowerCase()));
const PROVINCE_ABBRS = new Set(Object.keys(PROVINCES));

// Accept any age level like 10U..18U
const LEVEL_RX = String.raw`(?:\d{1,2}U)`;

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function normalizeText(s) {
  return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseNationalRank(text) {
  const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+(?:USA|United\s+States)\s+${LEVEL_RX}\b(?:\s*[-–]\s*[\w ]+)?`, "i");
  const m = text.match(rx);
  return m ? Number(m[1]) : undefined;
}

function parseStateRank(text, hints = []) {
  // US full names
  for (const nm of STATE_NAMES) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${escapeRegExp(nm)}\s+${LEVEL_RX}\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // US abbreviations
  for (const abbr of STATE_ABBRS) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${abbr}\s+${LEVEL_RX}\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // CA full names
  for (const nm of PROVINCE_NAMES) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${escapeRegExp(nm)}\s+${LEVEL_RX}\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // CA abbreviations
  for (const abbr of PROVINCE_ABBRS) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${abbr}\s+${LEVEL_RX}\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // Hints (state, region, division, etc.)
  for (const hint of hints.filter(Boolean)) {
    const rx = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+${escapeRegExp(String(hint))}\s+${LEVEL_RX}\b(?:\s*[-–]\s*[\w ]+)?`, "i");
    const m = text.match(rx); if (m) return Number(m[1]);
  }
  // Loose fallback: first non-USA line matching level
  const rxLoose = new RegExp(String.raw`(\d+)(?:st|nd|rd|th)\s+([A-Za-z .'\-()]+?)\s+${LEVEL_RX}\b(?:\s*[-–]\s*[\w ]+)?`, "gi");
  let match; while ((match = rxLoose.exec(text))) {
    const label = match[2].trim();
    if (!/^USA\b/i.test(label) && !/United\s+States/i.test(label)) return Number(match[1]);
  }
  return undefined;
}

function parseRating(text) {
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
  const labeled =
    text.match(/\b(?:Overall(?:\s+Record)?|Season(?:\s+Record)?|Record|W[-\s]*L[-\s]*T)\s*[:\s]+(\d{1,3})\s*-\s*(\d{1,3})\s*-\s*(\d{1,3})/i);
  if (labeled) return `${labeled[1]}-${labeled[2]}-${labeled[3]}`;

  const triplets = [...text.matchAll(/\b(\d{1,3})-(\d{1,3})-(\d{1,3})\b/g)]
    .map(m => ({ w:+m[1], l:+m[2], t:+m[3], raw:m[0], idx:m.index ?? 0 }));

  const plausible = triplets.filter(({w,l,t,idx}) => {
    const prefix = text.slice(Math.max(0, idx - 5), idx);
    if (/\b20\d{2}$/.test(prefix)) return false; // avoid dates like 2025-10-01
    if (w>200 || l>200 || t>200) return false;
    return (w + l + t) > 0;
  });

  if (plausible.length) {
    plausible.sort((a,b) => (b.w+b.l+b.t) - (a.w+a.l+a.t));
    const p = plausible[0];
    return `${p.w}-${p.l}-${p.t}`;
  }
  return undefined;
}

const safeNumber = (n) =>
  (typeof n === "number" && Number.isFinite(n) && n > 0) ? n : undefined;

/* ---------------- fetching text (legacy first, then Playwright if ranks missing) ---------------- */

async function fetchHtml(url) {
  try {
    return await libFetchHtml(url);
  } catch {
    const res = await fetch(url, { headers: { "User-Agent": "RankUpdater/1.2" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
}

async function extractTextLegacy(url) {
  const html = await fetchHtml(url);
  const text = normalizeText(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
  );
  return { mode: "legacy", text, rawHtml: html };
}

async function extractTextPlaywright(url, slug = "opponent") {
  let chromium;
  try {
    ({ chromium } = await import("playwright-chromium"));
  } catch {
    return null; // playwright not installed
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
    });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!resp || !resp.ok()) throw new Error(`HTTP ${resp ? resp.status() : "?"}`);

    await page.waitForTimeout(1200);
    try {
      await page.waitForFunction(
        () => /Rating|Record|USA\s+\d{1,2}U|\b\d{1,2}U\b/i.test(document.body.innerText),
        { timeout: 2000 }
      );
    } catch { /* ignore */ }

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    const text = normalizeText(bodyText);
    if (DEBUG) {
      await fs.mkdir(".debug", { recursive: true });
      await fs.writeFile(`.debug/${slug}-mhr-text.txt`, text.slice(0, 4000), "utf8");
    }
    return { mode: "playwright", text };
  } finally {
    await browser.close();
  }
}

async function getMhrText(url, slugForDebug) {
  const legacy = await extractTextLegacy(url);
  // If legacy already exposes ranks, we're done.
  const legacyNat = parseNationalRank(legacy.text);
  const legacyState = parseStateRank(legacy.text);
  if (legacyNat != null || legacyState != null) {
    return legacy;
  }
  // Otherwise try Playwright even if rating/record are visible in legacy.
  const pw = await extractTextPlaywright(url, slugForDebug);
  return pw || legacy;
}

/* ---------------- file I/O ---------------- */

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

/* ---------------- main update logic ---------------- */

async function updateFile(file) {
  const data = await readJson(file);

  // Skip past tournaments unless explicitly included
  const endDate = getTournamentEndDate(data);
  if (!INCLUDE_PAST && isPast(endDate)) {
    if (DEBUG) {
      const dd = endDate ? endDate.toISOString().slice(0,10) : "(unknown)";
      console.log(`[${path.basename(file)}] skipped (past tournament, end ${dd})`);
    }
    return false;
  }

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
      const ageMs = Date.now() - new Date(opp.updatedFromMHRAt).getTime();
      const maxAgeMs = STALE_DAYS * 24 * 60 * 60 * 1000;
      const isFresh = ageMs < maxAgeMs;
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
    let textInfo;
    try {
      textInfo = await getMhrText(opp.mhrUrl, `${path.basename(file, ".json")}-op${i+1}`);
    } catch (e) {
      console.warn(`    ! fetch error: ${e.message}`);
      continue;
    }

    // Optional: dump legacy HTML (helps debug parser drift)
    if (DUMP && textInfo?.rawHtml) {
      const dumpDir = path.resolve("tmp/mhr-dumps");
      await fs.mkdir(dumpDir, { recursive: true });
      const fn = `${path.basename(file, ".json")}-op${i + 1}-${Date.now()}.html`;
      const out = path.join(dumpDir, fn);
      await fs.writeFile(out, textInfo.rawHtml, "utf8");
      if (DEBUG) console.log(`    · dumped HTML -> ${path.relative(process.cwd(), out)}`);
    }

    const txt = textInfo?.text ?? "";

    // Derive state/province hints from the name, e.g. "(TX)", "(NY)", "(ON)"
    const nameAbbrHints = [];
    const mParens = String(opp.name || "").match(/\(([A-Z]{2})\)/g);
    if (mParens) {
      for (const seg of mParens) {
        const abbr = seg.replace(/[()]/g, "");
        if (STATE_ABBRS.has(abbr) || PROVINCE_ABBRS.has(abbr)) nameAbbrHints.push(abbr);
      }
    }

    const hints = [
      ...nameAbbrHints,
      opp.state,
      opp.mhrState,
      opp.region,
      opp.division,
      opp.location
    ].filter(Boolean);

    const rating = parseRating(txt);
    const record = parseRecord(txt);
    const nat = parseNationalRank(txt);
    const st = parseStateRank(txt, hints);

    if (DEBUG) {
      console.log({
        mode: textInfo?.mode,
        ratingStr: rating != null ? String(rating.toFixed?.(2) ?? rating) : undefined,
        rating,
        record,
        mhrNationalRank: nat ?? undefined,
        mhrStateRank: st ?? undefined,
        hints
      });
    }

    const before = JSON.stringify(opp);
    if (rating != null) opp.rating = safeNumber(rating);
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
  if (DEBUG) console.log({ ARG_TOURN, FORCE, DEBUG, DUMP, STALE_DAYS, INCLUDE_PAST });

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
