#!/usr/bin/env node
// Phase 3 — Partiful auto-RSVP runner. Approach A.
//
// Reads events.json (from harvest.js), auth.json (from intercept), profile.json.
// For each non-invite-only Partiful event:
//   1. getEventInfo to discover questionnaire + open/apply
//   2. getGuests to check idempotency (skip if already RSVPed)
//   3. Build questionnaire response via type+keyword matching
//   4. If any REQUIRED question can't be matched → skip + log
//   5. addGuest with status="GOING" (open) or "PENDING_APPROVAL" (apply)
//
// Auth: refreshes Firebase ID token if it expires within 5 minutes, or on 401.
// Rate limit: ~1 req/sec with jitter, plus per-event delay between getInfo/getGuests/addGuest.
//
// Usage:
//   node rsvp.js                  — DRY RUN (default). Prints what it would do, doesn't submit.
//   node rsvp.js --live           — actually submit RSVPs.
//   node rsvp.js --live --limit 5 — submit RSVPs to first 5 eligible events.
//   node rsvp.js --event <slug>   — only target a specific event slug (great for first live test).

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const EVENTS_PATH = path.join(ROOT, "events.json");
const AUTH_PATH = path.join(ROOT, "auth.json");
const PROFILE_PATH = path.join(ROOT, "profile.json");
const LOG_PATH = path.join(ROOT, "rsvp_log.json");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
NYC Tech Week auto-RSVP runner.

Usage:
  node rsvp.js                       Dry run on all eligible events (no submission).
  node rsvp.js --live                Submit RSVPs.
  node rsvp.js --live --limit 5      Submit to first 5 eligible events.
  node rsvp.js --live --event <slug> Target a single event slug only.
  node rsvp.js --live --guess        Aggressive: pick options on multiple-choice and use
                                     profile.interest as fallback for short-answer questions
                                     we'd otherwise skip. Higher coverage, lower-quality answers.
  node rsvp.js --live --retry-skipped Re-run only events that previously skipped due to
                                     unmatched questions (reads rsvp_log.json). Pair with --guess.
  --help, -h                         This message.
`);
  process.exit(0);
}
const DRY_RUN = !args.includes("--live");
const GUESS = args.includes("--guess");
const RETRY_SKIPPED = args.includes("--retry-skipped");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();
const ONLY_EVENT = (() => {
  const i = args.indexOf("--event");
  return i >= 0 ? args[i + 1] : null;
})();

const PARTIFUL_API = "https://api.partiful.com";
const SECURETOKEN_ENDPOINT =
  "https://securetoken.googleapis.com/v1/token";
const TOKEN_REFRESH_BUFFER_SEC = 5 * 60;
const PER_EVENT_DELAY_MS = 400; // tightened from 900 — Partiful seems to tolerate ~2 req/sec fine

const sleep = (ms) =>
  new Promise((r) => setTimeout(r, ms + Math.random() * 200));

// ---- profile/auth/state ---------------------------------------------------

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveAuth(auth) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
}

function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const pad = "=".repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(
    Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString(
      "utf8"
    )
  );
}

async function refreshIdToken(auth) {
  const url = `${SECURETOKEN_ENDPOINT}?key=${auth.firebaseApiKey}`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
  }).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-client-version": "Chrome/JsCore/10.14.0/FirebaseCore-web",
      origin: "https://partiful.com",
      referer: "https://partiful.com/",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const j = await res.json();
  auth.idToken = j.id_token || j.access_token;
  auth.refreshToken = j.refresh_token;
  const payload = decodeJwtPayload(auth.idToken);
  auth.idTokenIssuedAt = payload.iat;
  auth.idTokenExpiresAt = payload.exp;
  saveAuth(auth);
  return auth;
}

async function ensureFreshToken(auth) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (auth.idTokenExpiresAt - nowSec < TOKEN_REFRESH_BUFFER_SEC) {
    console.log("  [auth] token near expiry, refreshing…");
    await refreshIdToken(auth);
  }
  return auth;
}

// ---- partiful API ---------------------------------------------------------

function commonBody(auth, params, extra = {}) {
  return {
    data: {
      params,
      ...extra,
      amplitudeDeviceId: auth.amplitudeDeviceId,
      amplitudeSessionId: auth.amplitudeSessionId,
      userId: auth.userId,
    },
  };
}

async function callPartiful(endpoint, auth, body, { retried = false } = {}) {
  await ensureFreshToken(auth);
  const res = await fetch(`${PARTIFUL_API}/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${auth.idToken}`,
      origin: "https://partiful.com",
      referer: "https://partiful.com/",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    console.log(`  [auth] 401 on ${endpoint}, refreshing and retrying once…`);
    await refreshIdToken(auth);
    return callPartiful(endpoint, auth, body, { retried: true });
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} on ${endpoint}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json.result?.data ?? json;
}

const getEventInfo = (auth, eventId) =>
  callPartiful("getEventInfo", auth, commonBody(auth, { eventId }));

const getGuests = (auth, eventId) =>
  callPartiful(
    "getGuests",
    auth,
    commonBody(
      auth,
      { eventId, includeInvitedGuests: true },
      { paging: { cursor: null, maxResults: 500 } }
    )
  );

const addGuest = (auth, eventId, rsvp) =>
  callPartiful("addGuest", auth, commonBody(auth, { eventId, rsvp }));

// ---- questionnaire matcher (Approach A) -----------------------------------

// Order matters — first matching pattern wins. More specific before more generic.
const KEYWORD_PATTERNS = [
  { rx: /linkedin|li\s*url/i,                                   field: "linkedin" },
  { rx: /(?:^|\b)email(?:\b|$)|e[\s-]?mail/i,                   field: "email" },
  { rx: /phone|mobile|cell|whats?app/i,                         field: "phone" },
  { rx: /twitter|x\.com|x\s+handle/i,                           field: "twitter" },
  { rx: /github|gh\s+profile|gh\s+url/i,                        field: "github" },
  { rx: /(website|portfolio|personal\s+url)/i,                  field: "website" },
  { rx: /company.*role|role.*company|company.*&\s*role|company\s+name\s*&|name\s+&\s*role/i, field: "companyAndRole" },
  { rx: /(your\s+role|job\s+title|position|what\s+do\s+you\s+do)/i, field: "role" },
  { rx: /(company|organization|startup|where\s+do\s+you\s+work)/i, field: "company" },
  { rx: /(why|interest|driving|excited|hope.*to|looking.*for|what.*brings.*you|what.*hope.*get|goals?\s+during|what.*can.*you.*provide|focused\s+on\s+right\s+now)/i, field: "interest" },
  { rx: /(referr|invited|how.*did.*you.*hear|point.*of.*contact|who.*sent)/i, field: "referral" },
  { rx: /(location|city|where.*based)/i,                        field: "location" },
  { rx: /(first\s*&?\s*last\s*name|full\s+name|your\s+name)/i,  field: "name" },
  { rx: /(first\s+name)/i,                                      field: "firstName" },
  { rx: /(last\s+name|surname)/i,                               field: "lastName" },
  { rx: /(team\s+members?|teammates?|who.*on.*your.*team)/i,    field: "teamMembers" },
  { rx: /(what.*will.*you.*build|what.*are.*you.*build|project.*idea|build.*idea)/i, field: "buildIdea" },
];

// Picks an option for a `select` question. Single-option always picked (always-on).
// Multi-option only used when --guess. Heuristics: age→21+, role→fuzzy match profile.role,
// 2-option yes/no→yes, else first option.
function guessSelect(q, profile, { guess = false } = {}) {
  const opts = (q.options || []).map((o) =>
    typeof o === "string" ? o : (o.label || o.value || String(o))
  );
  if (opts.length === 0) return null;
  if (opts.length === 1) return opts[0]; // single-option = confirmation, always pick
  if (!guess) return null;

  const text = (q.text || "").toLowerCase();
  const role = (profile.role || "").toLowerCase();
  const find = (rx) => opts.find((o) => rx.test(o.toLowerCase()));

  if (/age|21\+|over\s*21|under\s*21|years?\s+old/.test(text)) {
    const a = find(/21\+|21\s+or|over\s+21|^yes/);
    if (a) return a;
  }
  if (/job\s+title|role|position|describes\s+you|what.*are\s+you/.test(text)) {
    const kws = ["founder", "engineer", "founding", "ceo", "cto", "technical", "builder"];
    for (const kw of kws) {
      if (role.includes(kw)) {
        const opt = find(new RegExp(kw, "i"));
        if (opt) return opt;
      }
    }
  }
  if (opts.length === 2) {
    const yes = find(/^yes\b/);
    if (yes) return yes;
  }
  return opts[0];
}

function answerForQuestion(q, profile, { guess = false } = {}) {
  // 1. Type-based deterministic match
  switch (q.type) {
    case "linkedin": return profile.linkedin || null;
    case "email":    return profile.email || null;
    case "phone":    return profile.phone || null;
    case "select":
    case "multiple_choice":
    case "single_choice":
    case "dropdown":
      return guessSelect(q, profile, { guess });
  }
  // 2. short_answer (and unknown text-ish types) — keyword match first
  if (q.type === "short_answer" || q.type === "long_answer" || !q.type) {
    for (const { rx, field } of KEYWORD_PATTERNS) {
      if (rx.test(q.text || "")) {
        const v = profile[field];
        if (v && String(v).trim()) return String(v);
      }
    }
    // Guess fallback for unmatched required short_answer
    if (guess) return profile.interest || "Excited to attend!";
    return null;
  }
  return null;
}

function buildQuestionnaireResponse(questionnaire, profile, { guess = false } = {}) {
  if (!questionnaire || !Array.isArray(questionnaire.questions)) return null;
  const answers = {};
  const unmatchedRequired = [];
  const unmatchedOptional = [];
  for (const q of questionnaire.questions) {
    const a = answerForQuestion(q, profile, { guess });
    if (a !== null) {
      answers[q.id] = a;
    } else if (q.required) {
      unmatchedRequired.push({ id: q.id, type: q.type, text: q.text });
    } else {
      unmatchedOptional.push({ id: q.id, type: q.type, text: q.text });
    }
  }
  return {
    response: { questionnaireVersion: questionnaire.questionnaireVersion ?? 1, answers },
    unmatchedRequired,
    unmatchedOptional,
  };
}

// ---- per-event processing -------------------------------------------------

function alreadyRsvpd(guests, userId) {
  if (!Array.isArray(guests)) return false;
  return guests.some(
    (g) =>
      g.userId === userId &&
      !["WITHDRAWN", "DECLINED", "REJECTED"].includes(g.status)
  );
}

async function processEvent(event, auth, profile, results) {
  const slug = event.partifulSlug;
  console.log(
    `\n[${event.date} ${event.time}] ${event.name}  →  partiful/${slug}`
  );

  let info;
  try {
    info = await getEventInfo(auth, slug);
  } catch (e) {
    console.log(`  ✗ getEventInfo failed: ${e.message}`);
    results.push({ id: event.id, slug, outcome: "error_getEventInfo", error: e.message });
    return;
  }
  await sleep(150);

  const ev = info.event || info;
  if (!ev.rsvpsEnabled) {
    console.log("  → skip: RSVPs disabled by host");
    results.push({ id: event.id, slug, outcome: "skip_rsvps_disabled" });
    return;
  }
  if (ev.atCapacity) {
    console.log("  → skip: event at capacity");
    results.push({ id: event.id, slug, outcome: "skip_at_capacity" });
    return;
  }

  // Idempotency check
  let guests;
  try {
    const g = await getGuests(auth, slug);
    guests = g?.data || g; // unwrap
    if (Array.isArray(guests?.[0]) === false && guests?.data) guests = guests.data;
  } catch (e) {
    console.log(`  ! getGuests failed (continuing): ${e.message}`);
  }
  if (alreadyRsvpd(guests, auth.userId)) {
    console.log("  → skip: already RSVPed");
    results.push({ id: event.id, slug, outcome: "skip_already_rsvpd" });
    return;
  }
  await sleep(150);

  // Build questionnaire response
  let questionnaireResponse = null;
  if (ev.questionnaireEnabled && ev.questionnaire) {
    const built = buildQuestionnaireResponse(ev.questionnaire, profile, { guess: GUESS });
    if (built.unmatchedRequired.length > 0) {
      console.log(
        `  → skip: ${built.unmatchedRequired.length} required questions unmatched:`
      );
      for (const q of built.unmatchedRequired) {
        console.log(`      [${q.type}] "${q.text}"`);
      }
      results.push({
        id: event.id,
        slug,
        outcome: "skip_unmatched_required",
        unmatchedRequired: built.unmatchedRequired,
      });
      return;
    }
    questionnaireResponse = built.response;
    if (built.unmatchedOptional.length > 0) {
      console.log(
        `  · ${built.unmatchedOptional.length} optional question(s) left blank`
      );
    }
  }

  const status =
    ev.guestAction === "APPLY" ? "PENDING_APPROVAL" : profile.defaultRsvpStatus || "GOING";

  const rsvp = {
    name: profile.name,
    count: 1,
    plusOnes: [],
    message: null,
    emailInvitationId: null,
    status,
    questionnaireResponse,
    guestId: null,
    timezone: ev.timezone || profile.timezone || "America/New_York",
    password: null,
  };

  console.log(
    `  → ready: status=${status}` +
      (questionnaireResponse
        ? ` answers=${Object.keys(questionnaireResponse.answers).length}`
        : "")
  );

  if (DRY_RUN) {
    results.push({
      id: event.id,
      slug,
      outcome: "dry_run_would_submit",
      status,
      questionnaireAnswerCount: questionnaireResponse
        ? Object.keys(questionnaireResponse.answers).length
        : 0,
    });
    return;
  }

  try {
    const submitted = await addGuest(auth, slug, rsvp);
    console.log(
      `  ✓ submitted (status=${submitted.status} guestId=${submitted.id})`
    );
    results.push({
      id: event.id,
      slug,
      outcome: "submitted",
      status: submitted.status,
      guestId: submitted.id,
    });
  } catch (e) {
    console.log(`  ✗ addGuest failed: ${e.message}`);
    results.push({ id: event.id, slug, outcome: "error_addGuest", error: e.message });
  }
}

// ---- main -----------------------------------------------------------------

async function main() {
  const events = loadJSON(EVENTS_PATH).events;
  const auth = loadJSON(AUTH_PATH);
  const profile = loadJSON(PROFILE_PATH);

  let candidates = events.filter(
    (e) =>
      !e.isInviteOnly &&
      e.rsvpProvider === "partiful" &&
      e.partifulSlug &&
      (!ONLY_EVENT || e.partifulSlug === ONLY_EVENT)
  );

  // --retry-skipped: filter to only events that previously skipped due to unmatched questions
  if (RETRY_SKIPPED) {
    if (!fs.existsSync(LOG_PATH)) {
      console.error("--retry-skipped requires a prior rsvp_log.json. Run normally first.");
      process.exit(1);
    }
    const prior = JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
    const skippedSlugs = new Set(
      prior.results
        .filter((r) => r.outcome === "skip_unmatched_required")
        .map((r) => r.slug)
    );
    candidates = candidates.filter((e) => skippedSlugs.has(e.partifulSlug));
  }

  console.log(
    `mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}${GUESS ? " +GUESS" : ""}${RETRY_SKIPPED ? " +RETRY_SKIPPED" : ""} | candidates: ${candidates.length}` +
      (LIMIT < Infinity ? ` (limit=${LIMIT})` : "") +
      (ONLY_EVENT ? ` (event=${ONLY_EVENT})` : "")
  );

  const results = [];
  let processed = 0;
  for (const e of candidates) {
    if (processed >= LIMIT) break;
    await processEvent(e, auth, profile, results);
    processed++;
    await sleep(PER_EVENT_DELAY_MS);
  }

  // For --retry-skipped LIVE runs, merge into the canonical log (replace prior outcomes for re-attempted slugs).
  // Dry runs of --retry-skipped go to a side file so they don't pollute the live log.
  let toWrite = { ranAt: new Date().toISOString(), dryRun: DRY_RUN, results };
  let outPath = LOG_PATH;
  if (RETRY_SKIPPED && fs.existsSync(LOG_PATH)) {
    if (DRY_RUN) {
      outPath = path.join(ROOT, "rsvp_log_retry_dryrun.json");
    } else {
      const prior = JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
      const updatedSlugs = new Set(results.map((r) => r.slug));
      const merged = prior.results.filter((r) => !updatedSlugs.has(r.slug)).concat(results);
      toWrite = { ranAt: new Date().toISOString(), dryRun: false, retriedFrom: prior.ranAt, results: merged };
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(toWrite, null, 2));

  // Summary
  const counts = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
  console.log("\n=== summary ===");
  console.log(`processed: ${results.length}`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`\nWrote log → ${LOG_PATH}`);
  if (DRY_RUN) {
    console.log("\n(dry run — re-run with --live to actually submit)");
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
