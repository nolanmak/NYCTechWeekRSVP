# Auth setup

You need three things in `auth.json` to authenticate with Partiful's API:

| Field | What it is |
|---|---|
| `idToken` | Your Firebase ID JWT (~1133 chars). Expires every ~1 hour. |
| `refreshToken` | Used to mint a fresh `idToken` automatically. Doesn't expire often. |
| `userId` | Your Firebase UID (visible in any `api.partiful.com` request body). |
| `amplitudeDeviceId` / `amplitudeSessionId` | Analytics IDs. Any captured value works. |

You also need `firebaseApiKey` and `firebaseProject`, but those are baked in (`AIzaSyCky6PJ7cHRdBKk5X7gjuWERWaKWBHr4_k` / `getpartiful`).

There are two ways to capture these.

---

## Option A — Claude Intercept (easiest)

[Claude Intercept](https://github.com/anthropics/claude-intercept) is a MITM proxy that captures HTTP/S traffic. If you're already using it (or Claude Code with the `intercept` skill), this is one command:

1. Start the proxy and route your browser through it (port 7777).
2. Open Partiful, log in, click any event and RSVP to it (or just navigate around — `getEventInfo` calls are enough to capture the bearer).
3. Export:
   ```bash
   node /path/to/claude_intercept/src/cli.js export --mode full --host api.partiful.com > partiful_capture.md
   ```
4. Find any `api.partiful.com` request in the export. The `authorization: Bearer <jwt>` header is your `idToken`. The body has `userId` and `amplitudeDeviceId` / `amplitudeSessionId`.
5. For the refresh token: trigger a token refresh (wait ~1hr or sign out / back in) so the proxy captures a `securetoken.googleapis.com/v1/token` request. The form-encoded body has `refresh_token=<value>`.

Or, if you're using Claude Code with the `intercept` skill: just say "*pull my Partiful auth from the intercept logs*" and Claude will populate `auth.json` for you.

---

## Option B — Chrome DevTools (manual)

No proxy needed, but more clicking.

### 1. Get the `idToken`

1. Open Chrome → log in to https://partiful.com.
2. Open DevTools → **Network** tab.
3. Filter by `partiful.com`.
4. Click any event you've RSVPed to (or any event page).
5. Find any request to `api.partiful.com/getEventInfo` (or `getGuests`).
6. **Headers tab** → copy the value of `authorization` (drop the `Bearer ` prefix). That long string is your `idToken`.

### 2. Get the `userId`

1. Same request as above → **Payload tab** → `data.userId`. Copy it.

### 3. Get the `amplitudeDeviceId` / `amplitudeSessionId`

Same `data` object — copy both values.

### 4. Get the `refreshToken`

1. DevTools → **Application** tab → **Storage** → **IndexedDB** → expand `firebaseLocalStorageDb` → `firebaseLocalStorage`.
2. Find the entry whose key starts with `firebase:authUser:AIzaSy...:[DEFAULT]`.
3. Drill into `value` → `stsTokenManager` → `refreshToken`. Copy it.

### 5. Fill in `auth.json`

```json
{
  "userId": "...",
  "amplitudeDeviceId": "...",
  "amplitudeSessionId": 1234567890,
  "firebaseApiKey": "AIzaSyCky6PJ7cHRdBKk5X7gjuWERWaKWBHr4_k",
  "firebaseProject": "getpartiful",
  "refreshToken": "...",
  "idToken": "...",
  "idTokenIssuedAt": 0,
  "idTokenExpiresAt": 0
}
```

`idTokenIssuedAt` and `idTokenExpiresAt` can be left at `0` — the runner decodes the JWT on first use and updates them. (Or, set `idTokenExpiresAt` to `0` to force an immediate refresh on first run, which is the safest if you're not sure when your token was issued.)

---

## Verifying

```bash
node -e "
const a = require('./auth.json');
const p = JSON.parse(Buffer.from(a.idToken.split('.')[1], 'base64url').toString());
console.log('user:', p.name || p.user_id);
console.log('expires:', new Date(p.exp*1000).toISOString());
"
```

Should print your name and the token expiry time. If it prints something sensible, you're good.

---

## "It says 403 PERMISSION_DENIED on token refresh"

The refresh endpoint enforces an `httpReferrer` restriction on the public Firebase API key. The runner sends `Referer: https://partiful.com/` and `Origin: https://partiful.com` to satisfy it. If you've modified `refreshIdToken()`, make sure those headers are still there.
