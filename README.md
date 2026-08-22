<div align="center">

<img src="./public/logo.png" width="140" alt="GitroHub logo" />

<h1>GitroHub</h1>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=20&pause=1000&color=3B82F6&center=true&vCenter=true&width=460&lines=GitHub+from+Telegram;Create+%C2%B7+Upload+%C2%B7+Download+%C2%B7+Manage;Owner-only+%C2%B7+No+one+else+gets+in;Built+with+Telegraf.js+%2B+Octokit" alt="Typing SVG" />

<p>
<img src="https://img.shields.io/badge/version-0.7.2-3B82F6?style=for-the-badge" />
<img src="https://img.shields.io/badge/node-%3E%3D18-3B82F6?style=for-the-badge&logo=node.js&logoColor=white" />
<img src="https://img.shields.io/badge/JavaScript-No%20TypeScript-F1E05A?style=for-the-badge&logo=javascript&logoColor=black" />
<img src="https://img.shields.io/badge/hosted%20on-Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" />
<img src="https://img.shields.io/badge/license-MIT-38BDF8?style=for-the-badge" />
</p>

</div>

---

## What is GitroHub?

GitroHub is a **private, owner-only Telegram bot** that connects to your GitHub account and lets you create, browse, edit, upload to, and delete repositories — all from a Telegram chat, on your phone, without opening a browser.

This isn't a public bot. It's built to talk to **exactly one person** (you) — the number in `OWNER_ID`. Everyone else who messages it is silently ignored, no reply, no logging, no processing, ever.

---

## ✨ Features

| | |
|---|---|
| 🔗 **OAuth Web Flow** | Tap once → browser opens → authorize → auto-redirected back with an animated confirmation page |
| 📁 **Repo Management** | List, filter, sort, search (fuzzy), create, rename, delete, toggle visibility |
| ⬆️ **Upload** | Single file or `.zip` (auto-strips the GitHub-style wrapper folder), with 🆕 New / ✏️ Modified / ➖ Unchanged detection before committing |
| 📂 **Browse Files** | Full tree navigation, view content, send as file, edit inline, delete |
| ⬇️ **Download** | Any of your repos, or any public external repo pasted as a link |
| 🍴 **Fork** | Fork any public GitHub repo straight into your account |
| ⚙️ **Settings** | Live Postgres/Redis health, GitHub rate-limit status, memory/uptime, bot version |
| 📜 **Activity Log** | Every action recorded, filterable to errors-only |
| 🔔 **Notifications** | Granular on/off per category |
| 🎨 **Animated OAuth Page** | Custom callback page with particle background, circuit-line animation, live status feed, and a countdown auto-redirect back into Telegram |
| 📌 **Pinned Repos** | Manual quick-access list with drag-style reorder (⬆️⬇️), independent of GitHub |
| 🏷️ **Tags** | Your own labels across repos — filter by tag, bulk-select by tag, shown as chips everywhere a repo appears |
| 🧹 **Bulk Repo Actions** | Multi-select repos (with smart shortcuts: stale, private, public, by tag) and delete/visibility/download them all in one pass, with live progress and honest per-item failure reporting |
| 📥 **Batch Upload** | Collect several loose files before committing — one combined commit, one combined New/Modified/Unchanged summary |
| 🔁 **Replace** | Swap a single file's content by sending a new file (not retyping), or fully sync a folder (add/update/delete) with an explicit before-you-commit delete preview |
| ⬆️ **Upload Here** | Upload directly into whatever folder you're currently browsing, path pre-filled |
| ⚙️ **My Defaults** | Saved visibility/commit-message/upload-path/sort/filter defaults, with a "learn from me" pattern nudge |
| 📦 **Storage & Data** | See what GitroHub remembers about you, clear it granularly (or fully, with a typed confirmation), export it, and auto-cleanup old activity |
| 🔑 **Access Log** | Security-focused connection history, separate from general Activity |

---

## 🏗️ Architecture

```
┌─────────────────┐        ┌──────────────────────┐
│   Telegram       │◄──────►│   bot.js (Telegraf)   │
│   (You, only)    │        │   Owner gate → Scenes │
└─────────────────┘        └──────────┬────────────┘
                                       │
                     ┌─────────────────┼─────────────────┐
                     ▼                 ▼                 ▼
              ┌────────────┐   ┌─────────────┐   ┌──────────────┐
              │  Postgres   │   │    Redis     │   │  GitHub API   │
              │ users, logs │   │ sessions,    │   │ (Octokit)     │
              │             │   │ wizard state │   │              │
              └────────────┘   └─────────────┘   └──────────────┘
                                       ▲
                                       │
                     ┌─────────────────┴─────────────────┐
                     │   app.js (Express) — /callback      │
                     │   Animated OAuth confirmation page   │
                     └──────────────────────────────────────┘
```

**One process, two jobs**: the same Node process runs both the Telegraf bot (webhook or polling) and a small Express server that only exists to handle GitHub's OAuth redirect (`/callback`) and serve the animated confirmation page. This keeps Railway hosting to a single service.

### Folder structure

> Upgrading from an older version? Just deploy — `migrate.js` re-runs `schema.sql` on every boot using `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` throughout, so new tables and columns (pins, tags, defaults, etc.) get added automatically without touching your existing data.

```
gitrohub/
├── public/
│   ├── logo.png              # Bot logo (transparent PNG)
│   └── callback.html         # Animated OAuth callback page
├── src/
│   ├── index.js               # Entrypoint — boots DB, Redis, bot, server
│   ├── bot.js                 # Telegraf wiring: middleware, scenes, routers
│   ├── config.js               # Env var loading + validation
│   ├── db/
│   │   ├── postgres.js         # Pool + ping()
│   │   ├── redis.js            # Client + ping()
│   │   ├── schema.sql          # users, activity_log tables
│   │   └── migrate.js          # Runs schema.sql on boot
│   ├── lib/
│   │   ├── github.js           # Octokit wrapper — every GitHub operation
│   │   ├── oauth.js            # Authorize URL + code exchange
│   │   ├── users.js            # Account data-access (connect/disconnect)
│   │   ├── crypto.js           # AES-256-GCM token encryption
│   │   ├── gitHash.js          # Git blob SHA (for upload change-detection)
│   │   ├── activity.js         # Activity log read/write
│   │   ├── actionLock.js       # Per-action double-tap protection
│   │   ├── confirmFlow.js      # Shared confirm/cancel-in-place helper
│   │   ├── format.js           # Locked formatting standard (see below)
│   │   └── requireConnected.js # Guard used by every GitHub-touching handler
│   ├── middleware/
│   │   ├── ownerGate.js        # Silently drops all non-owner traffic
│   │   └── redisSessionStore.js
│   ├── keyboards/
│   │   ├── bbtb.js             # Reply keyboards (Buttons Below Typing Bar)
│   │   └── inline.js           # Inline keyboards
│   ├── handlers/                # One file per screen/zone
│   └── scenes/                  # Multi-step wizards (Create/Upload/Rename/Edit)
├── package.json
├── .env.example
├── README.md
└── CHANGELOG.md
```

**v0.3.0 additions**, all following the same `lib/` = data access, `handlers/` = screen logic split:
`lib/pins.js`, `lib/tags.js`, `lib/defaults.js`, `lib/pathMemory.js`, `lib/accessLog.js`, `lib/dataStore.js`, `handlers/pinned.js`, `handlers/tags.js`, `handlers/bulkActions.js`, `handlers/myDefaults.js`, `handlers/storageData.js`, `handlers/accessLogScreen.js`. No new scenes were needed — every new feature reuses the existing wizard/session patterns.

---

## 🧠 Memory & stability (Railway free tier)

Railway's free/trial tier caps each service at **512MB RAM**. Node's V8 engine doesn't know that by default — it sizes its heap based on what it *thinks* the machine has, so without help it grows past the container's real limit and gets hard-killed by the kernel (`Killed` in the logs, no stack trace, since Node never gets a chance to log anything).

GitroHub now defends against this on three layers:

1. **`--max-old-space-size=384`** (set via the `NODE_OPTIONS` environment variable — see `.env.example`) forces V8 to respect a real ceiling and garbage-collect proactively, instead of growing unchecked. Leaves ~128MB headroom under the 512MB limit for buffers and native overhead that live outside V8's heap.
2. **A self-imposed RSS watchdog** (`MEMORY_WATCHDOG_MB`, default 400) checks actual memory every 30s and triggers a *clean* shutdown — closing Postgres and Redis properly — before the kernel ever needs to force-kill it. Railway restarts either way; this just avoids any risk of a write getting cut off mid-flight.
3. **File content no longer round-trips through Redis.** During Upload, raw file bytes used to live in the Telegraf wizard state, which gets serialized to Redis on every single step — for a near-1MB zip, that meant repeatedly re-serializing significant payloads. Content now lives in a short-lived in-process cache (`lib/fileBufferCache.js`); only a lightweight reference goes into session state.

Also tightened: the Postgres pool is capped at `PG_POOL_MAX` (default 3, was unbounded up to 10) — a single-owner bot doesn't need more — and GitHub API clients are cached per token instead of being constructed fresh on every single call.

**A related failure mode, fixed in v0.7.0:** if the bot crashed and restarted repeatedly, any Telegram messages sent during that downtime queued up and got delivered in a burst the moment the webhook came back — each one triggering its own database/GitHub work at once. That burst could itself spike memory enough to crash again, building an even bigger backlog for the next restart. The bot now discards any such backlog on every restart (`drop_pending_updates`) and processes updates one at a time, closing that loop.

If you're still seeing crashes or freezes after deploying v0.7.0+, check `GET /health` (see below) and Railway's Metrics tab — if RSS is climbing steadily even at rest, that points to something new rather than the causes above.

### `GET /health`
Returns `200` with `{ status: "ok", postgres, redis, memoryMB, uptimeSeconds }` when healthy, `503` with `status: "degraded"` if either DB is unreachable. Point Railway's health check at this path so it can restart a degraded instance proactively instead of only reacting after a crash.

---

## 📋 Changelog

Moved to its own file for readability: **[CHANGELOG.md](./CHANGELOG.md)**.

Highlights of the latest release (**v0.8.7**):
- Colors now follow the outcome (gain vs. loss), not the button's role — cancelling a Delete is safe (green), but cancelling a Create Repo you just set up throws away progress (red)
- Bulk Actions' confirm dialog now colors itself based on which action was picked, instead of one static color pair for delete/private/public/download alike
- Pagination is unconditionally blue now, closing an inconsistency where "Back" was blue but "Next page" wasn't

---

## 🚀 Setup

### 1. Create the Telegram bot
Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow the prompts → copy the token.

### 2. Get your Telegram user ID
Message [@userinfobot](https://t.me/userinfobot) → copy your numeric ID. This becomes `OWNER_ID` — the **only** ID the bot will ever respond to.

### 3. Create a GitHub OAuth App
Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**:
- **Homepage URL**: your Railway URL (e.g. `https://gitrohub-production.up.railway.app`)
- **Authorization callback URL**: `https://your-railway-url.up.railway.app/callback` *(must match exactly, no trailing slash)*

Copy the **Client ID** and generate a **Client Secret**.

### 4. Set up Railway
1. Create a new Railway project, deploy from this repo (or upload the zip)
2. Add a **Postgres** plugin — copies `DATABASE_URL` into your environment automatically
3. Add a **Redis** plugin — copies `REDIS_URL` into your environment automatically
4. Set the remaining environment variables (copy `.env.example` → fill in):

```
BOT_TOKEN=...
OWNER_ID=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
BASE_URL=https://your-railway-url.up.railway.app
SESSION_JWT_SECRET=$(openssl rand -hex 32)
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)
NODE_OPTIONS=--max-old-space-size=384
NODE_ENV=production
```

5. Deploy. On boot, GitroHub automatically:
   - Runs the Postgres migration (creates `users` + `activity_log` tables — safe to re-run)
   - Connects to Redis
   - Registers the Telegram webhook pointing at `${BASE_URL}/telegram-webhook`
   - Starts the Express server for `/callback`

### 5. Local development (optional)
```bash
npm install
cp .env.example .env   # fill in your values, leave NODE_ENV unset
npm run dev             # runs in long-polling mode, no webhook needed
```
In dev mode the bot polls Telegram directly, so `BASE_URL` only needs to be reachable for the `/callback` route — use a tool like `ngrok http 3000` and point your GitHub OAuth App + `.env`'s `BASE_URL` at the ngrok URL.

### 6. Talk to your bot
Open your bot on Telegram, hit `/start`, tap **Connect GitHub Account** — you'll get the animated callback page, then land back in the bot fully connected.

---

## 🎨 The animated OAuth callback page

`public/callback.html` is a single self-contained file (no build step, no framework) featuring:
- A canvas-based particle field + circuit-line background with a traveling signal pulse
- A slowly rotating conic gradient glow behind the card
- A terminal-style status feed that plays out step-by-step with SVG checkmarks/X's (no emoji — Lucide-style hand-drawn stroke icons)
- A live SVG countdown ring that auto-redirects back into Telegram (deep link) when it hits zero
- Distinct color themes for success (blue → green) and failure (blue → red) states

The bot's `app.js` injects `window.__GITROHUB__` with the real outcome (`success`/`error`, GitHub username, and — on failure — exactly which step failed) so the page always reflects what actually happened, never a generic animation.

---

## 🔒 Security notes

- **Owner gate is the first middleware registered**, before session lookup, before anything — non-owner messages are dropped with zero processing, zero reply, zero log noise.
- GitHub access tokens are encrypted at rest with **AES-256-GCM** (`TOKEN_ENCRYPTION_KEY`) before being stored in Postgres — never stored in plaintext.
- OAuth `state` parameter is a short-lived **signed JWT** carrying your Telegram ID, so the `/callback` route can't be spoofed into linking a token to the wrong chat.
- OAuth scope requested is `repo` only — full control of repositories, nothing broader (no `admin:org`, no `user` scope, etc.).

---

## 📐 Design principles baked into the code

These were locked in during design and apply everywhere in the codebase:

1. **BBTB vs Inline** — reusable/frequent actions live in the Reply Keyboard (bottom bar); content-specific and destructive/final actions live inline, attached to the message.
2. **Every error names the exact cause + next step** — see `format.errorMessage()`, used everywhere instead of generic "Something went wrong" messages.
3. **State-based emoji/labels are never stale** — visibility, language, filter/sort labels are recomputed fresh on every render.
4. **Edit in place within a flow, send fresh on final/destructive outcomes** — so multi-step wizards don't spam the chat, but a completed action always leaves a permanent record.
5. **⬅️ Back ≠ restart** — wizard state lives in Redis (`SESSION_TTL_SECONDS`, default 24h), so backing up a step preserves what you already typed, and a Railway restart mid-flow doesn't wipe your progress.

---

## ⚠️ Known limitations (as of v0.8.2)

Being upfront about what's simplified, consistent with the "specific errors, not vague ones" principle applied to the docs too:

- **"Browse Folders" during single-file upload path selection** still falls back to type-path (with the repo's current structure shown for context, a one-tap Root shortcut, and remembered-path suggestions) — the folder-tap navigator for *choosing* an upload destination wasn't wired up. Browsing an *existing* tree (Browse Files) is fully implemented, including pagination.
- **GitHub webhook-based notifications** (stars/issues/PRs) are schema-ready and the toggle exists in Settings, but the receiving webhook endpoint isn't implemented yet — still the only Notification category that doesn't do anything (the other 3 do).
- **🟢🟡🔴 Activity Status indicator** and **🍴 "Forked from X" tag** were explicitly deferred to a future version during design.
- **Text/slash-command fallback** for repo actions (e.g. `/repos`) isn't implemented — `/start`, `/settings`, `/cancel` exist as commands, but the button-driven UI remains the primary interface for everything else.

None of these block normal daily use.

---

## 💡 Recommendations for what's next

A few things worth considering that came up while building, beyond what was in the original design conversation:

1. **Rate-limit-aware backoff** — right now if GitHub's API rate limit is hit mid-operation, the user gets a clear error (per design), but the bot doesn't automatically queue/retry after the reset window. Worth adding for upload-heavy sessions.
2. **Large repo tree pagination** — `getTree()` fetches the *entire* recursive tree in one call, which is fine up to a few thousand files, but very large repos (10k+ files) could hit response-size or Telegram-message-size limits in Browse Files. Worth capping and paginating server-side, not just visually.
3. **Webhook signature verification** — when the GitHub-activity webhook endpoint gets built (deferred item), it must verify GitHub's `X-Hub-Signature-256` header against a shared secret, or anyone who finds the URL could inject fake "activity" into your Activity Log.
4. **Structured logging** — `console.log`/`console.error` is fine for a single-user bot on Railway's log viewer, but if this ever grows, swapping in a tiny structured logger (pino is lightweight and pairs well with Railway's log parsing) would make the Settings → Activity error surfacing more powerful.
5. **Health check endpoint** — Railway can auto-restart on failed health checks; a simple `GET /health` that checks Postgres + Redis + returns 200/503 would let Railway catch a degraded state before you notice it manually in Settings.

---

<div align="center">
<sub>Built for one person, on purpose. 🔒</sub>
</div>
