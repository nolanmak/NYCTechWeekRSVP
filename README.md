# NYCTechWeekRSVP

**Auto-RSVP to every NYC Tech Week event you can.** Harvests the public Tech Week calendar, opens each Partiful event, fills in the questionnaire from your saved profile, and submits.

The full NYC schedule is ~1,400 events across the week. This script gets you in for as many as it possibly can, in under 30 minutes.

## What it does

```
                       1,400 events
tech-week.com/calendar ──────────────► harvest.js ──► events.json
                                                           │
                                                           ▼
                profile.json ───┐
                auth.json ──────┼──► rsvp.js ──► api.partiful.com/addGuest
                                │                      │
                                └──► rsvp_log.json ◄───┘
```

1. **`harvest.js`** — calls the public Tech Week tRPC endpoint, paginates through every day in the range, dedupes events, classifies each by RSVP provider (Partiful / Luma / Eventbrite / etc.), extracts the Partiful slug.
2. **`rsvp.js`** — for each Partiful event: `getEventInfo` → check open/apply + questionnaire → `getGuests` (idempotency) → build response from your profile → `addGuest`. Auto-refreshes the Firebase ID token. Dry-run by default.

## Requirements

- **Node.js ≥ 18** (for built-in `fetch`)
- A logged-in Partiful account
- A captured Firebase ID token + refresh token from your Partiful session — see [SETUP.md](./SETUP.md)

## Quick start

```bash
git clone https://github.com/nolanmak/NYCTechWeekRSVP.git
cd NYCTechWeekRSVP

# 1. Make your config files
cp profile.example.json profile.json   # edit with your details
cp auth.example.json    auth.json      # follow SETUP.md to fill these in

# 2. Harvest the event list (defaults to NYC Tech Week 2026-06-01 → 06-07)
node harvest.js

# 3. Dry run — see what *would* be submitted, without sending anything
node rsvp.js

# 4. Go live
node rsvp.js --live

# 5. (Optional) Re-attempt previously-skipped events with aggressive guessing
node rsvp.js --live --retry-skipped --guess
```

## Configuration

Edit [`profile.json`](./profile.example.json). The runner reads each event's questionnaire and answers per-question:

1. **By question type** — `linkedin` / `email` / `phone` / `select` map directly to the corresponding profile fields.
2. **By keyword** — for `short_answer` questions, the question text is regex-matched against patterns in `KEYWORD_PATTERNS` (in `rsvp.js`). For example "What's your job title?" → `role` field; "Why are you excited?" → `interest` field.
3. **Skip** — if any required question doesn't match anything, the event is skipped and logged.

Add `--guess` to fall back to `profile.interest` for any unmatched short-answer question, and to pick best-effort options on multiple-choice (`yes` / `21+` / closest match to your role).

### Other cities

Tech Week runs in NYC, SF, LA, etc. To target a different city:

```bash
CITY=sf START_DAY=2026-10-13 END_DAY=2026-10-19 node harvest.js
```

## Usage modes

| Command | What it does |
|---------|--------------|
| `node rsvp.js` | Dry run on all eligible events. No submissions. Writes `rsvp_log.json`. |
| `node rsvp.js --live` | Submit RSVPs. ~25 min for 1,200 events. |
| `node rsvp.js --live --limit 5` | Only first 5 — good for a sanity check. |
| `node rsvp.js --live --event <slug>` | Single Partiful event slug only. |
| `node rsvp.js --live --guess` | Aggressive: pick options for select/multiple-choice and use your `interest` blurb as fallback for unmatched short-answers. Higher coverage, lower-quality answers. |
| `node rsvp.js --live --retry-skipped --guess` | Re-run only previously-skipped events with `--guess`. Merges results into `rsvp_log.json`. |
| `node rsvp.js --help` | This list. |

## Running with an AI assistant

You can hand the whole flow to Claude Code (or any Claude / Cursor / Codex setup):

```
> Run harvest.js, then dry-run rsvp.js. Read rsvp_log.json,
  show me the top 10 reasons events got skipped, and
  suggest profile.json edits that would unblock the most.
  Then re-run with --live --guess.
```

The skip log includes the literal question text for every required question that wasn't answered, so an AI can read it, propose targeted profile/keyword tweaks, and re-run — no extra glue needed.

## How the matcher works

`rsvp.js` builds the questionnaire response in this order:

```
for each question:
    1. type-based match     (linkedin / email / phone / select)
    2. keyword regex match  (short_answer text → profile field)
    3. --guess fallback     (interest blurb / option heuristic)
    4. otherwise → skip event if required, omit if optional
```

The full keyword pattern list is in `rsvp.js` near `KEYWORD_PATTERNS`. PRs welcome to extend it.

## Auth + token refresh

Partiful runs on Firebase Auth (project `getpartiful`). Each `api.partiful.com` request needs `Authorization: Bearer <Firebase ID JWT>`. Tokens expire every ~1hr; the runner detects near-expiry / 401 and POSTs to `securetoken.googleapis.com/v1/token` with your refresh token. Both tokens are persisted to `auth.json` after each refresh.

## Limitations

- **Doesn't fetch events** outside Partiful (Luma, Eventbrite, custom forms). Adapters are easy to add — open a PR.
- **Multi-choice answers in `--guess`** are heuristic ("yes", "21+", first option, fuzzy role match) and can pick wrong.
- **Custom required fields** (e.g. "What will you build?", "Who is your point of contact?") are answered with your `interest` blurb under `--guess`. Hosts may notice.
- Hosts see your **real name and email** when you RSVP. Don't be a jerk.

## Ethics

You're submitting on real human-run forms. The script is rate-limited (~2 requests/sec, randomized) to be polite. Don't:

- RSVP and then no-show every event you're accepted to (this hurts the host community)
- Use this against any service you're not invited to use
- Run it from multiple accounts to flood a single host

Do use it to surface events you'd actually attend, and decline (`status: WITHDRAWN`) ones you can't make.

## License

MIT — see [LICENSE](./LICENSE).
