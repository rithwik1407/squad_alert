# SquadSync

BGMI team management PWA. The captain schedules matches and picks **4 of 5** players at the last moment.
Exactly **N minutes before the match** (default 2), only those 4 get a notification with the room ID and password.
The benched player gets nothing. No Discord anywhere.

```
client/   React + Vite + TS, Tailwind, Framer Motion, React Router, Recharts, lucide-react  → Vercel
server/   Express + TS, MongoDB (Mongoose), JWT httpOnly cookie, Zod, BullMQ producer     → Render (free web service, runs the worker too)
worker/   BullMQ worker: FCM web push → Telegram fallback, delivery logs                  → inside the API on free plans, or its own service
docs/     REST API reference
```

## How alerts work

1. Creating or editing a match upserts a BullMQ **delayed job** with `jobId = matchId`, due at `startAt − notifyOffsetMin`.
   Reschedule = remove + re-add. Cancel = remove. Nothing runs in the browser.
2. When the job fires, the worker loads the match's **confirmed squad**:
   - no confirmed squad → only the **captain** is alerted ("Squad not confirmed!"), and the squad stays editable;
   - otherwise the **4 selected players** are alerted. The bench is never contacted.
3. Per player: try **WhatsApp** (Meta Cloud API DM), then **FCM web push**, then **Telegram**, until one succeeds. Captain-only alerts try WhatsApp last. Every attempt is written to `NotificationLog`.
4. **Idempotent**: players with a `sent` log for the match are skipped. A unique partial index plus a per-player delivery claim
   mean that even overlapping runs (scheduled job + "Send now") can't double-send.
5. Once sent, the match is `notified` and the squad is **locked**. Captains can still do an **emergency substitution**
   (only the incoming player is alerted) and **Resend to failed**.
6. Times are stored in UTC and shown in **Asia/Kolkata**.

Notification: **"Match in 2 minutes!"** / *"Scrim 1 · Erangel · 9:00 PM. Join the lobby now. Room: 4471823 / Pass: rare21"*. Tapping opens `/matches/:id`.

## Features

- **Scheduling**: single match, or **Add several** at once (each with its own time), with **repeat daily** for up to 7 days and quick time presets. Duplicate any match.
- **Map optional**: pick "Not decided" and set it later. Team default drops fill in when the map is chosen (Erangel → Quarry, Miramar → Monte, Rondo → Jadena City).
- **Player check-in**: players mark each upcoming match *I'm in / Maybe / Out*. The captain sees it on the squad picker.
- **4-of-5 squad picker** with bench, confirm, lock after the alert, and emergency substitution.
- **Alerts** N minutes before start, to the selected 4 only: push first, Telegram fallback, captain-only alert if no squad is confirmed, Send now, Resend to failed.
- **"I'm joining" replies** from the app, the push notification button, or the Telegram button. The captain sees who's on the way.
- **Nightly team summary on Telegram** at 12:00 AM IST: the day's matches played, MVP of the day, top fragger, a player board and each match's result. Sent once to every player with Telegram linked; skipped on days with no matches.
- **Delivery history**, player inbox, attendance, kills/damage/MVP stats with charts, tournament placements.

## Local setup

Requirements: Node 20+, a MongoDB (local or Atlas), a Redis (local `redis-server` or Upstash).

```bash
npm install
cp .env.example .env               # fill MONGODB_URI, REDIS_URL, JWT_SECRET (+ Firebase/Telegram when ready)
cp client/.env.example client/.env # Firebase web config for push (optional for local dev)
npm run seed                       # Team RARE: 1 captain + 5 players (no matches)
npm run dev                        # API :4000, worker, client :5173 (Vite proxies /api)
```

Seeded logins (every account uses the password `rare@123`):

| Role | Email | IGN | UID |
|---|---|---|---|
| Captain | admin@rare.com | RARE丨CAPTAIN | |
| Player | akshay@rare.com | RARE丨AKSHAY | 5577363210 |
| Player | dheeraj@rare.com | RARE丨DHEERAJ33 | 5688639254 |
| Player | bittu@rare.com | RARE丨BITTU | 5758878717 |
| Player | vasanth@rare.com | RARE丨VASANTH | 5781100224 |
| Player | vignesh@rare.com | RARE丨VIGNESH | 55522353757 |

Team join code: `RARE25`. Default drops: Erangel → Quarry, Miramar → Monte, Rondo → Jadena City.
The seed creates no matches. Add your own from the app.
To wipe all matches later (teams and players stay): `npm run clear-matches`.
New players register on the sign-in page (name, email, password, IGN, BGMI ID, phone, player or captain). Their account stays pending until the admin (`admin@rare.com`, or `ADMIN_EMAIL`) approves it from the Team page; then they join TEAM RARE with that role. The old join code no longer works.

**`querySrv ECONNREFUSED _mongodb._tcp…`**: your DNS refused Atlas's SRV lookup. SquadSync resolves `mongodb+srv` URIs through
`MONGO_DNS_SERVERS` (default `8.8.8.8,1.1.1.1`), which fixes this. If your network blocks public DNS, set it to your own resolver, or `off`.

## Tests

```bash
npm test                                                  # scheduler unit tests (no services needed)
redis-server --daemonize yes && REDIS_URL=redis://127.0.0.1:6379 npm test   # + real BullMQ/Redis integration
```

Covers: create, reschedule (incl. after a completed job), cancel, past/locked matches, Send-now job ids,
exactly-4 targeting, bench exclusion, notification text in IST, duplicate prevention (sequential and concurrent),
FCM → Telegram fallback, unreachable players + Resend to failed, captain-only alert, stale jobs, emergency subs, dead-token pruning.

## Credentials you need to supply

| Variable | Where | Get it from |
|---|---|---|
| `MONGODB_URI` | API + worker | MongoDB Atlas → Connect → Drivers |
| `REDIS_URL` | API + worker | Upstash → Redis → **TCP** `rediss://` URL |
| `JWT_SECRET` | API | `openssl rand -hex 32` |
| `CLIENT_URL` | API + worker | Your Vercel URL |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | API + worker | Firebase → Project settings → Service accounts → Generate new private key |
| `VITE_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`, `…_MESSAGING_SENDER_ID`, `…_APP_ID` | Vercel | Firebase → Project settings → Your apps → Web app |
| `VITE_FIREBASE_VAPID_KEY` | Vercel | Firebase → Cloud Messaging → Web Push certificates → Generate key pair |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | API + worker | @BotFather → `/newbot` |
| `TELEGRAM_WEBHOOK_SECRET` | API | Any random string |
| `CRON_SECRET` | API, optional | Any random string. Turns on `/api/cron/daily-summary?key=...` for cron-job.org (backup trigger and preview for the nightly summary) |
| `DAILY_SUMMARY_ENABLED` | API + worker, optional | `false` turns the nightly Telegram summary off (on by default) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | later | Meta WhatsApp Cloud API (provider is a stub) |
| `GEMINI_API_KEY` | optional, free | Google Gemini key from aistudio.google.com/apikey. Reads uploaded BGMI results screenshots; used first when set |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | optional, free | More free screenshot readers (console.groq.com/keys, openrouter.ai/keys), tried in turn after Gemini when it's busy or out of free uses |
| `ANTHROPIC_API_KEY` | optional | Reads uploaded BGMI results screenshots (kills, damage, survival, assists) so the MVP is worked out automatically |

## Deploy

**MongoDB Atlas**: create a free M0 cluster, a DB user, and allow `0.0.0.0/0` (Render has no fixed IPs).

**Upstash Redis**: create a free database (region: ap-south-1 Mumbai). Use the `rediss://` TCP URL, not the REST URL.

**Render (API + alerts, free)**: New → Blueprint → this repo (`render.yaml`). It creates one free web service that runs
the API and the alert worker in the same process (`RUN_WORKER_IN_API=true`). Fill in the env vars Render asks for.

A free Render service sleeps after about 15 minutes without traffic, and the first visit after that waits 15-30 seconds
while it starts again. **Keeping it awake** (both free):

- `.github/workflows/keep-alive.yml` pings `/api/ping` every 10 minutes from GitHub Actions. It starts working once it is on
  the default branch. To use another address set the repository variable `KEEPALIVE_URL`. GitHub turns scheduled workflows
  off after 60 days with no commits; re-enable it under Actions > Keep server awake if that happens.
- GitHub can run schedules late, so also add a cron-job.org job (free account > Create cronjob) that opens
  `https://<service>.onrender.com/api/ping` every 10 minutes.

One always-on service uses about 730 of the 750 free instance hours Render gives each month, so keep only this one
free service on the account. If it still sleeps, the site shows a "Waking up the server" note and keeps retrying, and
the app pings the API as soon as the page starts loading so the wake-up begins early.

Alerts stay on time either way:

- The pinger above keeps the instance awake.
- If it sleeps anyway, on startup and every minute after, the server looks in MongoDB for matches whose alert time has passed
  but were never notified and sends them straight away (still sent up to `CATCHUP_GRACE_MIN`, default 10, minutes after the match starts).
  Sending is idempotent, so nobody gets the same alert twice.

**Nightly Telegram summary**: the server checks every minute and sends the previous day's report from 12:00 AM IST.
If the instance was asleep at midnight it sends it when it wakes (until noon). Each player gets it once, however often it's triggered.
As a backup, set `CRON_SECRET` on Render and add a cron-job.org job at 00:01 (Asia/Kolkata) that opens
`https://<service>.onrender.com/api/cron/daily-summary?key=<CRON_SECRET>`. Add `&preview=1` to see the message without sending it,
or `&day=2026-11-20` to send a missed day.

For a paid always-on setup you can still run `worker/` as a separate Render background worker instead.

**Vercel (client)**: import the repo, Root Directory `client`, framework Vite. Add the `VITE_FIREBASE_*` vars.
Edit `client/vercel.json` and replace `YOUR-RENDER-API.onrender.com` with your API host. The rewrite keeps the auth cookie
first-party (works on iOS Safari). Then set `CLIENT_URL` on Render to the Vercel URL.

**Telegram webhook** (once, after the API is live):

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://YOUR-RENDER-API.onrender.com/api/telegram/webhook&secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Players link Telegram from **Settings → Link Telegram**, which opens `t.me/<bot>?start=<one-time token>`.

**Push on phones**: Android Chrome works from the browser. On iPhone (iOS 16.4+), players must **Add to Home Screen** first,
then open SquadSync from the icon and enable push in Settings. Telegram covers anyone who can't.

## WhatsApp setup (Meta Cloud API)

1. Go to developers.facebook.com, log in, then **My Apps → Create app**. Choose type **Business** (or "Other → Business") and create it.
2. In the app, **Add product → WhatsApp → Set up**. Meta gives you a free **test number**.
3. In **WhatsApp → API Setup**: copy the **Temporary access token** → `WHATSAPP_TOKEN`, and the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
4. Same page, **To → Manage phone number list → Add**: add each player's WhatsApp number (+91…) and enter the code each one receives. The test number allows **5** recipients.
5. In SquadSync, save each player's number (Team → pencil, or the player's own Settings → WhatsApp).
6. Recommended: **WhatsApp Manager → Message templates → Create**, category **Utility**, name `match_alert`, language English, body for example
   `{{1}} on {{2}} starts at {{3}}. Join the lobby now. {{4}}` with samples `Scrim 1`, `Erangel`, `9:00 PM`, `Room: 4471823 / Pass: rare21`.
   Once approved, set `WHATSAPP_TEMPLATE_NAME=match_alert` and `WHATSAPP_TEMPLATE_LANG=en`. Until then the `hello_world` template is used.
7. Permanent token (the temporary one expires after 24h): **business.facebook.com → Settings → Users → System users → Add** (Admin),
   **Assign assets** → your app (full control) and your WhatsApp account, then **Generate new token** for the app with
   `whatsapp_business_messaging` and `whatsapp_business_management`, expiry **Never**. Put it in `WHATSAPP_TOKEN`.

## Adding a channel

Implement `NotificationProvider` (`server/src/notifications/types.ts`) and add it to the chain in
`server/src/notifications/providers.ts`. `WhatsAppProvider` is already stubbed with notes on the Cloud API call.

## Project layout

```
server/src/
  models/           User, Team, Match, Squad, NotificationLog, Attendance, Stats, DeliveryClaim
  scheduler/
    queue.ts        upsertMatchJob / removeMatchJob / enqueueImmediate (BullMQ)
    dispatch.ts     who gets notified, fallback chain, idempotency (pure, unit-tested)
    repo.ts         Mongo implementation of the dispatcher's storage
    worker.ts       BullMQ Worker
  notifications/    fcm.ts, telegram.ts, whatsapp.ts (stub), content.ts
  routes/           auth, team, matches, me, notifications, telegram webhook
  seed.ts
client/src/
  pages/            Landing, Join, Dashboard (captain/player), Matches, MatchForm, MatchDetail,
                    SquadSelect, Notifications, Settings, Team, Stats
  components/       FlipCountdown, MapArt, MatchCard, Layout (sidebar + bottom nav), Toast, ui
client/public/sw.js service worker: push display, notification tap → match page, offline shell
```
