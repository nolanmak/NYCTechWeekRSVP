// Fetch event descriptions from Partiful's server-rendered HTML for
// keyword-pre-filtered candidates that *might* serve free food.
//
// Output: descriptions.json — { [eventId]: { title, description, fetchedAt } }
// Re-running only fetches events not already cached.

const fs = require('fs');

const FOOD_HINT_RX =
  /\b(breakfast|brunch|lunch|dinner|bagel|taco|pizza|coffee|tea|snack|bite|supper|empanada|sushi|omakase|sandwich|cocktail|happy hour|reception|food|eat|drinks?|wine|beer|tasting|grill|bbq|sip|soir[eé]e|salon|gala|mixer|dim sum|donut|pastry|cheese|charcuterie|brewery|bar|cocktails|aperitivo)\b/i;

const OUT = 'descriptions.json';
const SLEEP_MS = 400; // be polite

const { events } = JSON.parse(fs.readFileSync('events.json', 'utf8'));

const candidates = events.filter(
  (e) =>
    !e.isInviteOnly &&
    e.rsvpProvider === 'partiful' &&
    FOOD_HINT_RX.test(`${e.name} ${e.host} ${(e.cohosts || []).join(' ')}`)
);

const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const todo = candidates.filter((e) => !cache[e.id]);

console.log(
  `keyword candidates: ${candidates.length} / ${events.length} | cached: ${Object.keys(cache).length} | to fetch: ${todo.length}`
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractDescription(html) {
  // Partiful renders multiple "description":"..." occurrences in inline JSON.
  // Pick the longest match (skipping the short OG meta description).
  const matches = [...html.matchAll(/"description":"((?:\\"|[^"])*)"/g)].map((m) => m[1]);
  if (matches.length === 0) return '';
  matches.sort((a, b) => b.length - a.length);
  // Unescape JSON string literals.
  return JSON.parse('"' + matches[0] + '"');
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].replace(/\s*\|\s*Partiful\s*$/, '').trim() : '';
}

async function main() {
  let i = 0;
  for (const e of todo) {
    i += 1;
    try {
      const r = await fetch(e.rsvpUrl, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; CuratedListBot/1.0)' },
      });
      if (!r.ok) {
        console.log(`  [${i}/${todo.length}] ${e.id} ${e.partifulSlug} → HTTP ${r.status}`);
        cache[e.id] = { error: `HTTP ${r.status}`, fetchedAt: new Date().toISOString() };
      } else {
        const html = await r.text();
        const description = extractDescription(html);
        const title = extractTitle(html);
        cache[e.id] = {
          title,
          description,
          fetchedAt: new Date().toISOString(),
        };
        if (i % 25 === 0 || i === todo.length) {
          fs.writeFileSync(OUT, JSON.stringify(cache, null, 2));
          console.log(`  [${i}/${todo.length}] saved checkpoint (${e.id}: ${description.length} chars)`);
        }
      }
    } catch (err) {
      console.log(`  [${i}/${todo.length}] ${e.id} → ${err.message}`);
      cache[e.id] = { error: err.message, fetchedAt: new Date().toISOString() };
    }
    await sleep(SLEEP_MS);
  }
  fs.writeFileSync(OUT, JSON.stringify(cache, null, 2));
  console.log(`done. wrote ${Object.keys(cache).length} entries to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
