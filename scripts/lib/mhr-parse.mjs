// scripts/lib/mhr-parse.mjs
// Helpers to extract Rating / Record (and optional ranks) from MHR HTML.

export function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Look for: <h3>Heading</h3> ... <div>VALUE</div>
function valueAfterHeading(html, heading) {
  const h = escRe(heading);
  const re = new RegExp(`>\\s*${h}\\s*<\\/h3>[\\s\\S]*?<div[^>]*>([^<]+)<\\/div>`, "i");
  return html.match(re)?.[1]?.trim();
}

export function findRating(html) {
  // Preferred: heading→value pattern (matches your dump)
  const hv = valueAfterHeading(html, "Rating");
  if (hv) {
    const n = Number(hv.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) return n;
  }

  // Fallbacks (text sweep, used by your team script)
  const text = toText(html);
  const patterns = [
    /(?:^|\b)rating\b[:\s-]*([0-9]{1,3}(?:\.[0-9]+)?)/i,
    /MHR\s*Rating[:\s-]*([0-9]{1,3}(?:\.[0-9]+)?)/i,
    /Team\s*Rating[:\s-]*([0-9]{1,3}(?:\.[0-9]+)?)/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m) return parseFloat(m[1]);
  }

  // Last-ditch: first float (no 50–120 clamp because some youth pages show 0.00 early season)
  const m2 = text.match(/([0-9]{1,3}\.[0-9]+)/);
  return m2 ? parseFloat(m2[1]) : null;
}

export function findRecord(html) {
  // Preferred: heading→value
  const hv = valueAfterHeading(html, "Record");
  if (hv) return hv;

  // Fallbacks
  const text = toText(html);
  const labeled = /(?:Record|Overall)\s*[:\-]?\s*([0-9]{1,3}-[0-9]{1,3}(?:-[0-9]{1,3})?)/i;
  const mm = text.match(labeled);
  if (mm) return mm[1];

  const raw = /\b([0-9]{1,3}-[0-9]{1,3}(?:-[0-9]{1,3})?)\b/;
  const m2 = text.match(raw);
  return m2 ? m2[1] : null;
}

export function findNationalRank(html) {
  const text = toText(html);
  const rx = /National\s*Rank\s*[:#]?\s*#?\s*([0-9,]+)/i;
  const m = text.match(rx);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

export function findStateRank(html) {
  const text = toText(html);
  const patterns = [
    /State\s*Rank\s*[:#]?\s*#?\s*([0-9,]+)/i,
    /Rank\s*\(State\)\s*[:#]?\s*#?\s*([0-9,]+)/i,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m) return parseInt(m[1].replace(/,/g, ""), 10);
  }
  return null;
}

export async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Scouting-Portal/1.0 (+https://github.com/ChrisHammond/2025-26-12UA1-Scouting)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  return await res.text();
}
