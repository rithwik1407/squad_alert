# SquadSync REST API

Base URL: `/api`. JSON in, JSON out. Auth is a JWT in the httpOnly cookie `ss_token`, set by register/login.
Errors look like `{ "error": "message", "details"?: [{ "path": "field", "message": "..." }] }`.

All timestamps are ISO 8601 **UTC**. The client renders them in `Asia/Kolkata`.

| Status | Meaning |
|---|---|
| 400 | Validation failed (Zod) or the action doesn't fit the match state |
| 401 | Not signed in / session expired |
| 403 | Captain-only route |
| 404 | Not found, or a player asking for a match they aren't selected for |
| 409 | Duplicate (e.g. email taken, already on a team) |
| 423 | Locked: the notification already went out |

## Public

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/health` | | `{ ok, db, time }` |
| GET | `/config` | | `{ telegramBot, pushServerReady, timeZone }` |
| GET | `/cron/daily-summary?key=CRON_SECRET` | | Sends last night's Telegram team summary if due and not sent yet (12:00 AM to noon IST). `&preview=1` returns the message without sending; `&day=YYYY-MM-DD` sends that day's report. Each player gets a report once. 503 when `CRON_SECRET` is unset |
| POST | `/telegram/webhook` | Telegram update | Checks `X-Telegram-Bot-Api-Secret-Token`. Handles `/start <token>` to link a chat |

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password(≥8), ign, bgmiId, phone, mode: "captain"\|"player" }` | `202 { pending: true }`. No cookie: the account is pending until the admin approves it. Sign-in returns 403 while pending |
| POST | `/auth/login` | `{ email, password }` | `{ user, team }` + cookie |
| POST | `/auth/logout` | | clears cookie |
| GET | `/auth/me` | | `{ user, team }` |

## Team

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/team` | any | | `{ team: { id, name, tag, logo, joinCode, drops, captain, members[] } }` |
| GET | `/team/requests` | admin | | `{ requests: [{ id, name, email, ign, bgmiId, phone, role, createdAt }] }` pending signups |
| POST | `/team/requests/:userId/approve` | admin | | Adds them to the admin's team (TEAM RARE) with the role they asked for |
| POST | `/team/requests/:userId/reject` | admin | | Deletes the pending account |
| PATCH | `/team` | captain | `{ name?, tag?, logo?, drops?: { Erangel: "Quarry", ... } }` | `drops` = default drop per map |
| PATCH | `/team/members/:userId` | captain | `{ name?, ign?, bgmiId?, email?, password? }` | Edit a player's profile and login. Captains also see members' `email` in team responses |
| DELETE | `/team/members/:userId` | captain | | |

## Matches

A match object:

```json
{
  "id": "…", "title": "Scrim 1", "type": "scrim", "map": "Erangel", "drop": "Quarry",
  "startAt": "2026-11-19T15:30:00.000Z", "notifyAt": "2026-11-19T15:28:00.000Z", "notifyOffsetMin": 2,
  "roomId": "4471823", "roomPassword": "rare21",
  "status": "scheduled|notified|live|done|cancelled", "notifiedAt": null, "captainAlertedAt": null,
  "locked": false, "tournamentName": "", "placement": null,
  "squad": { "selectedIds": ["…x4"], "benchedId": "…", "confirmed": true, "updatedAt": "…" },
  "notifications": { "sent": 4, "failed": 0, "pending": 0 }
}
```

`map` is `"TBD"` until decided (the alert then says "Map TBD"). Match objects also carry
`availability` (userId → status), `availabilityNotes`, `joining` (userIds), `myAvailability`, `myJoining`.

Players only see full match details (room ID, squad) for matches where they are in the **confirmed** squad.

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/matches?scope=upcoming\|past\|all` | any | | |
| POST | `/matches` | captain | `{ title, type, map?, startAt, notifyOffsetMin=2, drop?, roomId?, roomPassword?, tournamentName? }` | Upserts the BullMQ delayed job (`jobId = matchId`). `drop` defaults from team drops. Response includes `schedule` |
| POST | `/matches/bulk` | captain | `{ matches: [ ...create bodies ] }` (1–40) | Several matches at once, each with its own time and job. All share a `batchId`. Rejects past or duplicate times |
| GET | `/matches/checkin` | any | | Player check-in board: upcoming team matches (no room info) with `myAvailability`, `squadPicked`, `selected` |
| PUT | `/matches/:id/availability` | any | `{ status: "available"\|"maybe"\|"unavailable", note? }` | Before the match starts. Shown to the captain on the squad picker |
| POST | `/matches/:id/joining` | selected player | | "I'm joining" reply after the alert. Also sent from the push notification button (`?via=push`) and the Telegram button |
| GET | `/matches/:id` | any | | |
| PATCH | `/matches/:id` | captain | any subset of the create body | Re-schedules the job. Changing time after the alert went out → 423 |
| POST | `/matches/:id/cancel` | captain | | Removes the job |
| POST | `/matches/:id/status` | captain | `{ status: "live"\|"done", placement? }` | |
| GET | `/matches/:id/squad` | any | | `{ squad, locked }` |
| PUT | `/matches/:id/squad` | captain | `{ selectedIds: [4 ids], confirm: boolean }` | Exactly 4 distinct team members. Remaining member becomes `benchedId`. 423 once locked |
| POST | `/matches/:id/substitute` | captain | `{ outId, inId }` | Emergency sub. After the lock, only `inId` is alerted, immediately |
| POST | `/matches/:id/send-now` | captain | | Requires a confirmed squad. Cancels the delayed job and sends now. 202 |
| POST | `/matches/:id/resend-failed` | captain | | Retries everyone selected who has no `sent` log. 202 |
| GET | `/matches/:id/notifications` | captain | | Delivery log for this match |
| GET | `/matches/:id/report` | any | | `{ attendance[], stats[] }` |
| PUT | `/matches/:id/attendance` | captain | `{ entries: [{ userId, joined }] }` | |
| PUT | `/matches/:id/stats` | captain | `{ entries: [{ userId, kills, damage, mvp }] }` | One MVP max |

## Scrim organizers

Discord links and organizer contacts per scrim/tournament series. A match shows the card whose name matches its `tournamentName` (case, spaces and punctuation ignored).

| Method | Path | Who | Body | Notes |
|---|---|---|---|---|
| GET | `/scrims` | any | | `{ canEdit, series: [{ id, name, key, organizer, discordInvite, discordChannel, contact, notes, matchCount }], unsaved: [{ name, matchCount }] }` |
| POST | `/scrims` | captain/admin | `{ name, organizer?, discordInvite?, discordChannel?, contact?, notes? }` | 409 if the name is already saved |
| PATCH | `/scrims/:id` | captain/admin | same as POST | |
| DELETE | `/scrims/:id` | captain/admin | | |

## Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?limit=100` | Captain: every attempt for the team. Player: their delivered alerts (inbox) |

Log entry: `{ id, matchId, match, userId, user, kind: "squad"|"captain_alert", channel: "fcm"|"telegram"|"whatsapp"|"none", status: "sent"|"failed"|"skipped", trigger: "scheduled"|"manual"|"resend"|"substitute", title, body, sentAt, error }`

## Me

| Method | Path | Body |
|---|---|---|
| PATCH | `/me/account` | `{ currentPassword, email?, newPassword? }` (change own login) |
| PATCH | `/me` | `{ name?, ign?, bgmiId?, avatar?, whatsappNumber?, notifyPrefs?: { push?, telegram?, whatsapp? } }` |
| POST | `/me/fcm-token` | `{ token }` (keeps the newest 5 devices) |
| DELETE | `/me/fcm-token` | `{ token }` |
| POST | `/me/telegram/link` | → `{ url: "https://t.me/<bot>?start=<one-time token>" }` |
| DELETE | `/me/telegram` | unlink |
| GET | `/me/stats` | `{ rows: [{ matchId, title, map, startAt, selected, joined, kills, damage, mvp }], totals }` |
| GET | `/me/stats/team` | Whole-team scorecards for the charts: `{ players: [{ id, name, ign, avatar }], matches: [{ matchId, title, map, type, startAt, placement, stats: [{ userId, kills, damage, survivalMin, assists, mvp, mvpScore }] }] }` |

## Squad AI

All need a signed-in team member. Actions marked captain need the captain.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/ai/status` | `{ engine: 'gemini' \| 'groq' \| 'offline' }` |
| GET | `/api/ai/overview` | Dashboard blocks for the last 20 matches plus upcoming matches. No LLM call. |
| POST | `/api/ai/chat` | Body `{ messages: [{ role: 'user' \| 'assistant', text }] }` (last one is the question). Answers as Server-Sent Events: `meta`, `text` (delta), `tool` (start/done), `block` (a visual for the dashboard), `notice`, `done`. 8 per minute per user. |
| POST | `/api/ai/squad` | Captain. `{ matchId, selectedIds[4] }`: approve an AI squad recommendation (saves it confirmed and alerts the picked players). |
| GET | `/api/ai/proposals/:id` | Status of an AI-prepared action. |
| POST | `/api/ai/proposals/:id/approve` | Captain. Carries out the action (creates the scrim or confirms the squad). |
| POST | `/api/ai/proposals/:id/reject` | Captain. Dismisses it; nothing changes. |
