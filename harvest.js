#!/usr/bin/env node
// Phase 1 — Tech Week event harvester. No auth.
// Loops cursor 1..N for each day in [START_DAY..END_DAY], dedupes by id,
// normalizes rsvpProvider from externalHref hostname, writes events.json.

const fs = require("fs");
const path = require("path");

const ENDPOINT =
  "https://www.tech-week.com/calendar/api/trpc/calendar.events?batch=1";
const CITY = process.env.CITY || "nyc";
const START_DAY = process.env.START_DAY || "2026-06-01";
const END_DAY = process.env.END_DAY || "2026-06-07";
const OUT = path.join(__dirname, "events.json");
const PER_PAGE = 48;
const REQ_DELAY_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function daysInRange(start, end) {
  const out = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function classifyProvider(href) {
  if (!href) return null;
  let host;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host.endsWith("partiful.com")) return "partiful";
  if (host === "lu.ma" || host.endsWith(".lu.ma")) return "luma";
  if (host.endsWith("eventbrite.com")) return "eventbrite";
  if (host.endsWith("splashthat.com")) return "splash";
  if (host.endsWith("hopin.com")) return "hopin";
  if (host.endsWith("meetup.com")) return "meetup";
  return "other";
}

function partifulSlug(href) {
  if (!href) return null;
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith("partiful.com")) return null;
    const m = u.pathname.match(/^\/(?:e|events)\/([^\/]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function fetchPage(day, cursor) {
  const body = {
    "0": {
      city: CITY,
      q: "",
      featured: false,
      day,
      track: [],
      sponsor: [],
      theme: [],
      format: [],
      location: [],
      time: [],
      host: [],
      sortBy: "time",
      sortOrder: "asc",
      cursor,
      direction: "forward",
    },
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.tech-week.com",
      referer: `https://www.tech-week.com/calendar/${CITY}?day=${day}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${day} cursor=${cursor}`);
  }
  const json = await res.json();
  return json[0].result.data;
}

function normalize(raw) {
  const href = raw.externalHref || null;
  const hosts = (raw.facets?.hosts || []).map((h) => h.label).filter(Boolean);
  const primaryHost = hosts[0] || raw.company || null;
  return {
    id: raw.id,
    name: raw.name,
    date: raw.date,
    time: raw.time,
    city: raw.city,
    location: raw.location,
    host: primaryHost,
    cohosts: hosts.slice(1),
    rsvpUrl: href,
    rsvpProvider: classifyProvider(href),
    partifulSlug: partifulSlug(href),
    isInviteOnly: !!raw.isInviteOnly,
  };
}

async function harvest() {
  const days = daysInRange(START_DAY, END_DAY);
  const dedup = new Map(); // id -> normalized
  const stats = {
    days: {},
    totalRaw: 0,
    totalUnique: 0,
    byProvider: {},
    inviteOnly: 0,
    rsvpable: 0,
  };

  for (const day of days) {
    let page = 1;
    let total = null;
    let dayCount = 0;
    while (true) {
      const data = await fetchPage(day, page);
      if (total === null) total = data.total;
      const results = data.results || [];
      for (const r of results) {
        stats.totalRaw++;
        if (!dedup.has(r.id)) dedup.set(r.id, normalize(r));
      }
      dayCount += results.length;
      const lastPage = Math.ceil(total / PER_PAGE);
      if (page >= lastPage || results.length === 0) break;
      page++;
      await sleep(REQ_DELAY_MS);
    }
    stats.days[day] = { total, fetched: dayCount };
    console.log(
      `  ${day}: total=${total} fetched=${dayCount} unique-so-far=${dedup.size}`
    );
    await sleep(REQ_DELAY_MS);
  }

  const events = Array.from(dedup.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.time || "").localeCompare(b.time || "");
  });

  for (const e of events) {
    const k = e.rsvpProvider || "none";
    stats.byProvider[k] = (stats.byProvider[k] || 0) + 1;
    if (e.isInviteOnly) stats.inviteOnly++;
    else if (e.rsvpUrl) stats.rsvpable++;
  }
  stats.totalUnique = events.length;

  fs.writeFileSync(OUT, JSON.stringify({ stats, events }, null, 2));
  console.log("\n=== summary ===");
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\nWrote ${events.length} events to ${OUT}`);
}

harvest().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
