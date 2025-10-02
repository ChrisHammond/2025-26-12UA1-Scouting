#!/usr/bin/env node
/**
 * Append today's rating / stateRank / nationalRank into mhr-history.
 *
 * Policy:
 * - On WEDNESDAY (America/Chicago): always write today's snapshot (dedup by date).
 * - Other days: only write if any value actually changed vs the last history point.
 *
 * This keeps history aligned with MHR's weekly refresh while still capturing
 * unexpected changes on other days.
 */
import fs from "node:fs/promises";
import path from "node:path";

const TEAMS_DIR = "src/content/teams";
const HIST_DIR  = "src/data/mhr-history";

// ---- time helpers (America/Chicago) ----
const TZ = "America/Chicago";
function nowInTZ() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  // Build a Date from parts to avoid DST edge issues; but we only need date+weekday.
  const d = new Date();
  const str = fmt.format(d); // yyyy-mm-dd, HH:MM:SS (locale "en-CA" -> date ISO-ish)
  // We can re-use the same Date object for weekday via toLocaleString
  return { dateISO: str.slice(0, 10), weekday: new Date().toLocaleString("en-US", { weekday: "short", timeZone: TZ }) };
}
function isWednesday(weekday) {
  // "Wed" from en-US short weekday names
  return /^Wed/i.test(weekday);
}

// ---- fs helpers ----
async function readJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; }
}
async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ---- compare helpers ----
function numOrUndef(v) {
  return (typeof v === "number" && Number.isFinite(v)) ? v : undefined;
}
function lastEntry(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined;
}
function shallowEqual(a, b) {
  const ka = Object.keys(a || {}).sort();
  const kb = Object.keys(b || {}).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (a[ka[i]] !== b[kb[i]]) return false;
  }
  return true;
}

async function main() {
  const { dateISO: today, weekday } = nowInTZ();
  const wed = isWednesday(weekday);

  const teamFiles = (await fs.readdir(TEAMS_DIR)).filter(f => f.endsWith(".json"));
  let wroteAny = false;

  for (const f of teamFiles) {
    const teamPath = path.join(TEAMS_DIR, f);
    const team = await readJson(teamPath, null);
    if (!team || !team.slug) {
      console.warn(`⏭  ${f}: invalid team JSON (missing slug)`);
      continue;
    }

    const histPath = path.join(HIST_DIR, `${team.slug}.json`);
    const hist = await readJson(histPath, []) || [];

    // Current values (prefer team fields; fallback to last history point if needed)
    const last = lastEntry(hist) || {};
    const rating       = numOrUndef(team.rating)         ?? numOrUndef(last.rating);
    const stateRank    = numOrUndef(team.mhrStateRank)   ?? numOrUndef(last.stateRank);
    const nationalRank = numOrUndef(team.mhrNationalRank)?? numOrUndef(last.nationalRank);

    // Proposed entry (omit undefineds)
    const entry = { date: today };
    if (rating       !== undefined) entry.rating = rating;
    if (stateRank    !== undefined) entry.stateRank = stateRank;
    if (nationalRank !== undefined) entry.nationalRank = nationalRank;

    // If history already has an entry for today, compare; otherwise compare to "last"
    const withoutToday = hist.filter(h => h.date !== today);
    const prev = hist.find(h => h.date === today) ?? last;

    const hasChange =
      (prev?.rating       !== entry.rating) ||
      (prev?.stateRank    !== entry.stateRank) ||
      (prev?.nationalRank !== entry.nationalRank);

    // Gate by day:
    // - Wed: always record (dedup by date)
    // - Other: only if changed
    if (!wed && !hasChange) {
      console.log(`• ${team.slug}: skip (no change, non-Wed)`);
      continue;
    }

    // Avoid rewriting if nothing changes after dedup
    const next = [...withoutToday, entry];
    if (JSON.stringify(next) === JSON.stringify(hist)) {
      console.log(`• ${team.slug}: history unchanged`);
      continue;
    }

    await writeJson(histPath, next);
    wroteAny = true;
    const badge =
      (entry.stateRank != null ? `state #${entry.stateRank}` : "state —") + ", " +
      (entry.nationalRank != null ? `national #${entry.nationalRank}` : "national —");
    console.log(`✓ ${team.slug}: wrote ${today} (${badge}${entry.rating != null ? `, rating ${entry.rating}` : ""})`);
  }

  if (!wroteAny) {
    console.log(wed ? "No histories changed (Wednesday run)." : "No histories changed (non-Wed; no diffs).");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
