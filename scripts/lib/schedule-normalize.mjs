// Helpers to turn raw calendar events into normalized 'game' rows

/** Heuristic opponent extraction based on title text */
export function parseOpponent(title, selfName) {
  const t = (title || "").replace(/\s+/g, " ").trim();
  const vs = /\b(.+?)\s+vs\.?\s+(.+?)$/i.exec(t);
  const at = /\b(.+?)\s+@\s+(.+?)$/i.exec(t);

  if (vs) {
    const [, a, b] = vs;
    if (a.toLowerCase().includes(selfName.toLowerCase())) {
      return { opponent: b.trim(), homeAway: "Home" };
    } else if (b.toLowerCase().includes(selfName.toLowerCase())) {
      return { opponent: a.trim(), homeAway: "Away" };
    }
    return { opponent: b.trim(), homeAway: "Neutral" };
  }

  if (at) {
    const [, a, b] = at;
    if (a.toLowerCase().includes(selfName.toLowerCase())) {
      return { opponent: b.trim(), homeAway: "Away" }; // self @ opponent
    } else if (b.toLowerCase().includes(selfName.toLowerCase())) {
      return { opponent: a.trim(), homeAway: "Home" }; // opponent @ self
    }
    return { opponent: b.trim(), homeAway: "Neutral" };
  }

  const cleaned = t.replace(new RegExp(selfName, "i"), "").replace(/[:\-–|]/g, " ").trim();
  return { opponent: cleaned || "TBD", homeAway: "Neutral" };
}

/** Normalize a raw VEVENT into our Game shape */
export function normalizeEvent(ev, selfName, source = "ics") {
  const start = ev.start ? new Date(ev.start) : null;
  const date = start ? start.toISOString().slice(0, 10) : "1970-01-01";
  const time = start ? start.toISOString().slice(11, 16) : undefined;

  const title = ev.title ?? ev.summary ?? "Game";
  const { opponent, homeAway } = parseOpponent(title, selfName);

  return {
    date,
    time,
    opponent,
    homeAway,
    leagueGame: /league/i.test(title),
    tournament: /tourney|tournament|classic|cup|showcase/i.test(title)
      ? (title.match(/([A-Za-z ]+(Classic|Cup|Showcase))/)?.[0] ?? "tournament")
      : undefined,
    venue: ev.location,
    source,
    sourceId: ev.id,
    sourceUrl: ev.url,
  };
}

/** Key to de-duplicate when merging (date+time+opponent+source) */
export function gameDedupKey(g) {
  return [g.date, g.time || "", (g.opponent || "").toLowerCase(), g.source || ""].join("|");
}
