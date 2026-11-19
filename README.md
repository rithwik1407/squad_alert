# SquadSync

BGMI team management PWA. The captain schedules matches and picks **4 of 5** players at the last moment.
Exactly **N minutes before the match** (default 2), only those 4 get a notification with the room ID and password.
The benched player gets nothing. No Discord anywhere.

```
client/   React + Vite + TS, Tailwind, Framer Motion, React Router, Recharts, lucide-react  → Vercel
server/   Express + TS, MongoDB (Mongoose), JWT httpOnly cookie, Zod, BullMQ producer     → Render (web)
worker/   BullMQ worker: FCM web push → Telegram fallback, delivery logs                  → Render (worker)
docs/     REST API reference
```

## How alerts work

1. Creating or editing a match upserts a BullMQ **delayed job** with `jobId = matchId`, due at `startAt − notifyOffsetMin`.
   Reschedule = remove + re-add. Cancel = remove. Nothing runs in the browser.
2. When the job fires, the worker loads the match's **confirmed squad**:
   - no confirmed squad → only the **captain** is alerted ("Squad not confirmed!"), and the squad stays editable;
   - otherwise the **4 selected players** are alerted. The bench is never contacted.
3. Per player: try **FCM web push**; if there's no token or it fails, fall back to **Telegram**. Every attempt is written to `NotificationLog`.
4. **Idempotent**: players with a `sent` log for the match are skipped. A unique partial index plus a per-player delivery claim
   mean that even overlapping runs (scheduled job + "Send now") can't double-send.
5. Once sent, the match is `notified` and the squad is **locked**. Captains can still do an **emergency substitution**
   (only the incoming player is alerted) and **Resend to failed**.
6. Times are stored in UTC and shown in **Asia/Kolkata**.

Notification: **"Match in 2 minutes!"** / *"Scrim 1 · Erangel · 9:00 PM. Join the lobby now. Room: 4471823 / Pass: rare21"*. Tapping opens `/matches/:id`.

## Features

- **Scheduling**: single match, or **Add several** at once (each with its own time), with **repeat daily** for up to 7 days and quick time presets. Duplicate any match.
- **Map optional**: pick "Not decided" and set it later. Team default drops fill in when the map is chosen (Erangel → Quarry, Miramar → Monte, Sanhok → Ruins).
- **Player check-in**: players mark each upcoming match *I'm in / Maybe / Out*. The captain sees it on the squad picker.
- **4-of-5 squad picker** with bench, confirm, lock after the alert, and emergency substitution.
- **Alerts** N minutes before start, to the selected 4 only: push first, Telegram fallback, captain-only alert if no squad is confirmed, Send now, Resend to failed.
- **"I'm joining" replies** from the app, the push notification button, or the Telegram button. The captain sees who's on the way.
- **Delivery history**, player inbox, attendance, kills/damage/MVP stats with charts, tournament placements.

## Local setup

Requirements: Node 20+, a MongoDB (local or Atlas), a Redis (local `redis-server` or Upstash).

```bash
npm install
cp .env.example .env               # fill MONGODB_URI, REDIS_URL, JWT_SECRET (+ Firebase/Telegram when ready)
cp client/.env.example client/.env # Firebase web config for push (optional for local dev)
npm run seed                       # Team RARE: 1 captain + 5 players + sample matches
npm run dev                        # API :4000, worker, client :5173 (Vite proxies /api)
```

Seeded logins (password `squadsync123`, or `SEED_PASSWORD`):

| Role | Email | IGN | UID |
|---|---|---|---|
| Captain | captain@teamrare.gg | RARE丨CAPTAIN | |
| Player | akshay@teamrare.gg | RARE丨AKSHAY | 5577363210 |
| Player | dheeraj@teamrare.gg | RARE丨DHEERAJ33 | 5688639254 |
| Player | bittu@teamrare.gg | RARE丨BITTU | 5758878717 |
| Player | vasanth@teamrare.gg | RARE丨VASANTH | 5781100224 |
| Player | vignesh@teamrare.gg | RARE丨VIGNESH | 55522353757 |

Team join code: `RARE25`. Default drops: Erangel → Quarry, Miramar → Monte, Sanhok → Ruins.
Seeded matches: Scrim 1 (Erangel, 9:00 PM IST, squad confirmed, Vignesh benched), Scrim 2 (Miramar), Scrim 3 (Sanhok, tomorrow), Scrim 4 (map not decided), a tournament round, and six past scrims with stats for the charts.
These are demo accounts: change the emails/passwords or have players register with the join code.

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
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | later | Meta WhatsApp Cloud API (provider is a stub) |

## Deploy

**MongoDB Atlas**: create a free M0 cluster, a DB user, and allow `0.0.0.0/0` (Render has no fixed IPs on Starter).

**Upstash Redis**: create a database (region: ap-south-1 Mumbai). Use the `rediss://` URL.
BullMQ polls Redis; on Upstash pick pay-as-you-go or a fixed plan rather than the free 10k-commands/day tier.

**Render (API + worker)**: New → Blueprint → this repo (`render.yaml`). Fill the `sync: false` env vars on both services.
The worker must be always on for alerts to fire on time, so both use the Starter plan. On a tight budget you can run only
the web service with `RUN_WORKER_IN_API=true`, but it must also be a paid, never-sleeping instance: a free Render service
sleeps after 15 minutes idle and would miss alerts.

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
