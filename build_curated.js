// Build a curated CURATED.md of the best NYC Tech Week 2026 events.
//
// Sections (in order):
//   1. Friends of the House — pinned allowlist of Partiful slugs.
//   2. Free Food — events that explicitly serve real food, classified from
//      Partiful descriptions (see classify_food.js → food_classifications.json).
//   3..N. Topical buckets — AI Labs, Dev Tools, Hackathons, Rooftops, Investor.
//   last. Coworking Spaces — static list of drop-in spaces (not dated events).
//
// Friends of the House and the topical buckets are mutually exclusive (an
// event lands in exactly one). Free Food is an overlay that may duplicate
// events that also appear in a topical bucket — the food angle is cross-cut.

const fs = require('fs');

const { events } = JSON.parse(fs.readFileSync('events.json', 'utf8'));
const foodClassifications = fs.existsSync('food_classifications.json')
  ? JSON.parse(fs.readFileSync('food_classifications.json', 'utf8'))
  : {};

const norm = (s) => (s || '').toLowerCase();
const haystack = (e) =>
  [e.name, e.host, ...(e.cohosts || []), e.location].map(norm).join(' || ');

// ---- pinned: Friends of the House -----------------------------------------
//
// Allowlist of Partiful slugs that get hoisted to the top of CURATED.md and
// suppressed from every other section. Add the slug here whenever you want
// to highlight a specific event.
const FRIENDS_SLUGS = new Set([
  'vMnZZEd9ek0rQ09zFpeE', // PHL vs NYC Founder Draft (localhost:nyc)
  'IjcQJFIYc2PPkDOy0h3r', // Frontier House NYC GP Roundtable (OneSixOne Ventures et al)
]);

// Per-slug host overrides for the Friends section. The harvest pulls hosts
// from tech-week.com, which sometimes drops co-organizers we care about
// (e.g. OneSixOne missing from the Frontier House listing). Override here
// rather than mutating events.json.
const FRIENDS_HOST_OVERRIDES = {
  IjcQJFIYc2PPkDOy0h3r: {
    host: 'Eleven Wall Ventures',
    cohosts: ['OneSixOne Ventures', 'Ohio Startup Network', 'Tech Week'],
  },
  vMnZZEd9ek0rQ09zFpeE: {
    host: 'Lasya Tarini',
    cohosts: ['localhost:nyc', 'TechBrig', 'Pace University'],
  },
};

const matchers = [
  {
    title: 'AI Labs & Big Tech',
    blurb:
      'Anthropic, OpenAI, Google, Meta, Microsoft, NVIDIA, AWS, Apple and other frontier-AI / big-tech-hosted events.',
    patterns: [
      /\banthropic\b/, /\bopenai\b/, /\bgoogle\b/, /\bdeepmind\b/, /\bgemini\b/,
      /\bmeta\b/, /\bmicrosoft\b/, /\bazure\b/, /\bgithub\b/, /\bnvidia\b/,
      /\baws\b/, /\bamazon\b/, /\bapple\b/, /\bxai\b/, /\bmistral\b/,
      /\bcohere\b/, /\bperplexity\b/, /\bhugging ?face\b/, /\bdatabricks\b/,
      /\bsnowflake\b/, /\bsalesforce\b/, /\bibm\b/, /\boracle\b/,
    ],
  },
  {
    title: 'Dev Tools & Infra',
    blurb:
      'Companies building for developers: editors, infra, devex, databases, APIs.',
    patterns: [
      /\bvercel\b/, /\bcursor\b/, /\bwindsurf\b/, /\bcodeium\b/, /\breplit\b/,
      /\blinear\b/, /\bnotion\b/, /\bfigma\b/, /\bsupabase\b/, /\bcloudflare\b/,
      /\bstripe\b/, /\bshopify\b/, /\bdatadog\b/, /\bmongodb\b/, /\bredis\b/,
      /\bpostgres\b/, /\bplanetscale\b/, /\bneon\b/, /\brender\b/, /\bnetlify\b/,
      /\bfly\.io\b/, /\bdocker\b/, /\bkubernetes\b/, /\bhashicorp\b/,
      /\blangchain\b/, /\bllamaindex\b/, /\bpinecone\b/, /\bweaviate\b/,
      /\bchroma\b/, /\bmodal\b/, /\branchain\b/, /\bsegment\b/, /\bpostman\b/,
      /\bgithub\b/, /\bgitlab\b/, /\bsentry\b/, /\blaunchdarkly\b/,
      /\bretool\b/, /\bairtable\b/, /\btwilio\b/, /\bsendgrid\b/, /\bauth0\b/,
      /\bclerk\b/, /\bworkos\b/, /\bturso\b/, /\bbrowserbase\b/, /\bbrowserstack\b/,
      /\bstainless\b/, /\bvellum\b/, /\bbraintrust\b/, /\bopenrouter\b/,
    ],
  },
  {
    title: 'Hackathons & Build Nights',
    blurb: 'Hackathons, build-nights, jam sessions, and demo competitions.',
    patterns: [/\bhackathon\b/, /\bhack night\b/, /\bbuild night\b/, /\bjam\b/, /\bhack ?day\b/, /\bbuildathon\b/],
  },
  {
    title: 'Rooftop Parties',
    blurb: 'Anything rooftop, terrace, or skyline.',
    patterns: [/\brooftop\b/, /\bterrace\b/, /\bskyline\b/, /\bpenthouse\b/],
  },
  {
    title: 'Investor & Founder',
    blurb:
      'Pitch nights, demo days, founder dinners, VC happy hours from notable funds and accelerators.',
    patterns: [
      /\bfounders?\b/, /\binvestors?\b/, /\bpitch night\b/, /\bdemo day\b/,
      /\b(vc|venture capital)\b/, /\bangel\b/, /\baccelerator\b/,
      /\b(y ?combinator|ycombinator|\byc\b)\b/, /\bsequoia\b/, /\ba16z\b/,
      /\bandreessen\b/, /\bbessemer\b/, /\baccel\b/, /\bindex ventures\b/,
      /\bgreylock\b/, /\bbenchmark\b/, /\blightspeed\b/, /\bfounders ?fund\b/,
      /\busv\b/, /\bunion square ventures\b/, /\bnea\b/, /\bgeneral catalyst\b/,
      /\bgoogle ventures\b/, /\b\bgv\b\b/, /\bkleiner\b/, /\binsight partners\b/,
      /\btiger global\b/, /\bcoatue\b/, /\bthrive capital\b/, /\bcraft ventures\b/,
      /\b8vc\b/, /\bredpoint\b/, /\bemergence\b/, /\bibex\b/, /\bcanaan\b/,
      /\bspark capital\b/, /\bmenlo ventures\b/, /\bmayfield\b/, /\bsignalfire\b/,
      /\bkhosla\b/, /\bfoundation capital\b/, /\bbain capital\b/, /\bbond\b/,
    ],
  },
];

// ---- Coworking Spaces -----------------------------------------------------
//
// Static list rendered at the bottom of CURATED.md. These aren't dated events;
// they're spaces to drop in between sessions during Tech Week.
const COWORKING_SPACES = [
  {
    name: 'Fractal Tech Hub',
    url: 'https://fractalbootcamp.com/fractal-tech-hub',
    neighborhood: 'Brooklyn',
    notes: 'Free coworking + community for engineers and founders. Drop-in friendly during Tech Week.',
  },
];

// ---- bucketing ------------------------------------------------------------

const friends = [];
const buckets = matchers.map((m) => ({ ...m, items: [] }));
const used = new Set();

for (const e of events) {
  if (e.isInviteOnly) continue;

  if (FRIENDS_SLUGS.has(e.partifulSlug) && !used.has(e.id)) {
    friends.push(e);
    used.add(e.id);
    continue;
  }

  const hay = haystack(e);
  for (const b of buckets) {
    if (b.patterns.some((p) => p.test(hay))) {
      if (!used.has(e.id)) {
        b.items.push(e);
        used.add(e.id);
      }
      break;
    }
  }
}

// Free Food overlay: independent of `used` — an event may appear here AND in
// its topical bucket. Excludes Friends-of-the-House to avoid trivial dupes.
const foodItems = events.filter(
  (e) =>
    !e.isInviteOnly &&
    !FRIENDS_SLUGS.has(e.partifulSlug) &&
    foodClassifications[e.id]?.servesFood === true
);

// ---- rendering ------------------------------------------------------------

const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? 'pm' : 'am';
  const hr = hh % 12 || 12;
  return `${hr}:${m}${ampm}`;
};

const escapePipes = (s) => (s || '').replace(/\|/g, '\\|');

const eventRow = (e, extraCol = null) => {
  const override = FRIENDS_HOST_OVERRIDES[e.partifulSlug];
  const hostName = override?.host ?? e.host;
  const hostList = override?.cohosts ?? e.cohosts ?? [];
  const host = [hostName, ...hostList].filter(Boolean).join(' + ');
  const name = escapePipes(e.name);
  const link = `[${name}](${e.rsvpUrl})`;
  const base = `| ${e.date} | ${fmtTime(e.time)} | ${link} | ${escapePipes(host)} | ${escapePipes(e.location)} |`;
  return extraCol == null ? base : `${base} ${escapePipes(extraCol)} |`;
};

const sortByDateTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);

const anchorOf = (title) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const lines = [];
lines.push('# NYC Tech Week 2026 — Curated Picks');
lines.push('');
lines.push(
  'A hand-categorized cut of the best public events from the ~1,600-event NYC Tech Week 2026 calendar (Jun 1–7). Generated from `events.json`.'
);
lines.push('');

// TOC
lines.push('Sections:');
if (friends.length) lines.push(`- [Friends of the House](#${anchorOf('Friends of the House')}) (${friends.length})`);
if (foodItems.length) lines.push(`- [Free Food](#${anchorOf('Free Food')}) (${foodItems.length})`);
for (const b of buckets) {
  if (!b.items.length) continue;
  lines.push(`- [${b.title}](#${anchorOf(b.title)}) (${b.items.length})`);
}
if (COWORKING_SPACES.length) lines.push(`- [Coworking Spaces](#${anchorOf('Coworking Spaces')}) (${COWORKING_SPACES.length})`);
lines.push('');

// Friends of the House
if (friends.length) {
  lines.push('## Friends of the House');
  lines.push('');
  lines.push('_Hand-picked events from people we know running them. Show up to these first._');
  lines.push('');
  lines.push('| Date | Time | Event | Host | Location |');
  lines.push('|------|------|-------|------|----------|');
  friends.sort(sortByDateTime);
  for (const e of friends) lines.push(eventRow(e));
  lines.push('');
}

// Free Food
if (foodItems.length) {
  lines.push('## Free Food');
  lines.push('');
  lines.push(
    "_Events that explicitly serve real food (breakfast, lunch, dinner, sit-down meals, or substantial catering — not just drinks). Classified from each event's Partiful description._"
  );
  lines.push('');
  lines.push('| Date | Time | Event | Host | Location | Food |');
  lines.push('|------|------|-------|------|----------|------|');
  foodItems.sort(sortByDateTime);
  for (const e of foodItems) {
    const food = foodClassifications[e.id]?.foodType || '';
    lines.push(eventRow(e, food));
  }
  lines.push('');
}

// Topical buckets
for (const b of buckets) {
  if (!b.items.length) continue;
  lines.push(`## ${b.title}`);
  lines.push('');
  lines.push(`_${b.blurb}_`);
  lines.push('');
  b.items.sort(sortByDateTime);
  lines.push('| Date | Time | Event | Host | Location |');
  lines.push('|------|------|-------|------|----------|');
  for (const e of b.items) lines.push(eventRow(e));
  lines.push('');
}

// Coworking
if (COWORKING_SPACES.length) {
  lines.push('## Coworking Spaces');
  lines.push('');
  lines.push("_Drop-in spaces to work between events. Not dated — just places to land when you're tired of cafes._");
  lines.push('');
  lines.push('| Space | Neighborhood | Notes |');
  lines.push('|-------|--------------|-------|');
  for (const c of COWORKING_SPACES) {
    lines.push(
      `| [${escapePipes(c.name)}](${c.url}) | ${escapePipes(c.neighborhood)} | ${escapePipes(c.notes)} |`
    );
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push(
  `Source: \`events.json\` (${events.length} total events harvested). Categorization is regex-based on event name + host fields; Friends of the House is a manual allowlist; Free Food is classified from each event's Partiful description. Open a PR to extend any of these — see \`build_curated.js\`, \`fetch_descriptions.js\`, and \`food_classifications.json\`.`
);
lines.push('');

fs.writeFileSync('CURATED.md', lines.join('\n'));
console.log('Wrote CURATED.md');
console.log(`  Friends of the House: ${friends.length}`);
console.log(`  Free Food: ${foodItems.length}`);
for (const b of buckets) console.log(`  ${b.title}: ${b.items.length}`);
console.log(`  Coworking Spaces: ${COWORKING_SPACES.length}`);
console.log(`  total categorized (excl. food overlay): ${used.size} of ${events.length}`);
