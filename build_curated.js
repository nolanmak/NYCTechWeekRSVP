// Build a curated CURATED.md of the best NYC Tech Week 2026 events
// by category: top AI/tech, dev tools, hackathons, rooftops, investor/founder.
const fs = require('fs');

const { events } = JSON.parse(fs.readFileSync('events.json', 'utf8'));

const norm = (s) => (s || '').toLowerCase();
const haystack = (e) =>
  [e.name, e.host, ...(e.cohosts || []), e.location].map(norm).join(' || ');

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

const used = new Set();
const buckets = matchers.map((m) => ({ ...m, items: [] }));

for (const e of events) {
  if (e.isInviteOnly) continue;
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

const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? 'pm' : 'am';
  const hr = hh % 12 || 12;
  return `${hr}:${m}${ampm}`;
};

const lines = [];
lines.push('# NYC Tech Week 2026 — Curated Picks');
lines.push('');
lines.push(
  'A hand-categorized cut of the best public events from the ~1,400-event NYC Tech Week 2026 calendar (Jun 1–7). Generated from `events.json`.'
);
lines.push('');
lines.push('Sections:');
for (const b of buckets) {
  if (!b.items.length) continue;
  const anchor = b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  lines.push(`- [${b.title}](#${anchor}) (${b.items.length})`);
}
lines.push('');

for (const b of buckets) {
  if (!b.items.length) continue;
  lines.push(`## ${b.title}`);
  lines.push('');
  lines.push(`_${b.blurb}_`);
  lines.push('');
  b.items.sort((a, x) => (a.date + a.time).localeCompare(x.date + x.time));
  lines.push('| Date | Time | Event | Host | Location |');
  lines.push('|------|------|-------|------|----------|');
  for (const e of b.items) {
    const host = [e.host, ...(e.cohosts || [])].filter(Boolean).join(' + ');
    const name = (e.name || '').replace(/\|/g, '\\|');
    const link = `[${name}](${e.rsvpUrl})`;
    lines.push(
      `| ${e.date} | ${fmtTime(e.time)} | ${link} | ${host.replace(/\|/g, '\\|')} | ${(e.location || '').replace(/\|/g, '\\|')} |`
    );
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push(
  `Source: \`events.json\` (${events.length} total events harvested). Categorization is regex-based on event name + host fields — open a PR to extend the patterns in \`build_curated.js\`.`
);
lines.push('');

fs.writeFileSync('CURATED.md', lines.join('\n'));
console.log('Wrote CURATED.md');
for (const b of buckets) console.log(`  ${b.title}: ${b.items.length}`);
console.log(`  total categorized: ${used.size} of ${events.length}`);
