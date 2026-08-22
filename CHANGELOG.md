# GitroHub Changelog

All notable changes to GitroHub, newest first. See [README.md](./README.md) for the current feature set and setup instructions.

**Jump to:** [v0.8.7](#v087--colors-redesigned-around-outcome-not-button-role) · [v0.8.6](#v086--button-color-remapping-after-seeing-it-live) · [v0.8.5](#v085--button-color-styling-bot-api-94) · [v0.8.4](#v084--memory-and-watchdog-hardening) · [v0.8.3](#v083--rename-crash-fix-callback-page-redesign-docs-cleanup) · [v0.8.2](#v082--deep-bug-sweep-on-the-v081-checkpoint) · [v0.8.1](#v081--stability-checkpoint-root-cause-pass-not-patches) · [v0.8.0](#v080--card-redesign-search-split-and-new-screens) · [v0.1.0–v0.7.2](#v010--v072--getting-the-bot-stable-click-to-expand)

---

---

### v0.8.7 — Colors redesigned around outcome, not button role

v0.8.6 colored buttons by their ROLE (Confirm vs. Cancel) and by whether they moved you somewhere. Both broke under scrutiny: "Cancel" isn't inherently safe — cancelling a Delete is safe, but cancelling a Create Repo you just spent time setting up throws away real progress. Colors now follow the OUTCOME for that specific flow, not the button's label.

- **Redesigned:** for any destructive action (Delete Repo/File, Disconnect, Storage Clear, Bulk Delete), confirm = 🔴 (you lose something), cancel = 🟢 (you keep it) — unchanged from v0.8.6, this pairing was already right.
- **Flipped:** for any constructive action (Create Repo, Rename, Edit File, License, Fork, Upload/Commit, Replace Folder), confirm = 🟢 (you gain something) and cancel = 🔴 (you walk away from progress you already started) — the opposite of v0.8.6, where these were blue/green.
- **New, branching by context:** Bulk Actions' shared confirm dialog now colors itself differently depending on which action was picked — Bulk Delete gets the destructive red/green pairing; Bulk Public/Private/Download (no real gain or loss either way) gets blue on both sides, matching how the single-repo Visibility toggle already works.
- **Clarified:** navigation is unconditionally blue now, including pagination (Prev/Next) — closing an inconsistency where "Back" was blue but "Next page" wasn't, even though both are the same kind of action (moving through content, not deciding anything).
- **Clarified:** a plain "Cancel" that isn't paired with any gain/loss (e.g. backing out of viewing an external repo) stays blue — it's pure navigation, not part of the red/green system at all.
- **Note:** BBTB's own Cancel buttons (used for lightweight things like a Search prompt) stay green rather than picking up red — that tier is reserved for abandoning a real, multi-step flow (a wizard), not backing out of a single text prompt.
- Final distribution: 14 red / 16 green / 67 blue / 79 colorless, out of 176 total — verified by count, not assumed.

### v0.8.6 — Button color remapping after seeing it live

v0.8.5's 3-tier mapping looked correct on paper but broke the moment it actually rendered: Delete Repo's "Yes, Delete" and "Cancel" both showed red, making it impossible to tell which one was actually dangerous at a glance. Replaced with a 4-tier system built around one rule — a color only works as a signal if it means exactly one thing, always, never context-dependent.

- 🔴 **Red** — narrowed to ONLY the single button that actually executes something irreversible: Yes-Delete-Repo, Yes-Delete-File, Yes-Disconnect, Yes-Clear (Storage), Bulk's destructive execute. Exactly 5 buttons in the whole bot. Keeping this the rarest tier is what makes it alarming when it appears.
- 🟢 **Green** — every real Cancel button, everywhere, no exceptions (was red in v0.8.5). Now means exactly one thing: "the safe way out."
- 🔵 **Blue** — general navigation AND the confirm side of already-safe actions (Rename, License, Fork, Create Repo, Upload/Commit, Replace Folder's continue) — both are the same underlying signal ("proceed, this is fine"), so unified under one color.
- **New: colorless tier.** Pagination, Skip, individual picks inside a longer flow (which license during Create Repo's wizard vs. changing an existing repo's license — these are different tiers despite both being "license"), toggles, minor declines. v0.8.5 defaulted every uncategorized button to blue; this version has no default at all — every one of the 176 buttons in the bot got individually re-examined and assigned a tier on purpose, verified by counting the final distribution (5 red / 18 green / 63 blue / 90 colorless) to confirm red actually stayed rare instead of just assuming it.

### v0.8.5 — Button color styling (Bot API 9.4)

Telegram's Bot API 9.4 (Feb 2026) added a `style` field to buttons — three preset colors: danger (red), success (green), primary (blue). Applied across every keyboard in the bot, inline and BBTB.

- **New:** every button now carries a deliberate color instead of relying on emoji alone to signal intent.
  - 🔴 **Red** — every Cancel button, plus the action-executing "Yes" side of destructive confirms (Delete Repo, Delete File, Disconnect, Storage Clear, Bulk Actions)
  - 🟢 **Green** — the action-executing "Confirm/Yes" side of safe operations (Rename, License change, Fork, Create Repo, Upload/Commit, Replace Folder's sync warning)
  - 🔵 **Blue** — everything else: navigation, entry points into a flow (even ones that lead somewhere destructive), Filter/Sort, picks, pagination
- **Built defensively:** rather than depend on whether the installed Telegraf version's own types have caught up to this Bot API version, `style` is attached directly onto whatever button object Telegraf's `Markup.button.*` already produces — Telegram just reads the JSON it's sent, so this works regardless of Telegraf's own support timeline.
- **Note on entry points:** a button that only opens a confirmation screen (e.g. Settings' "Disconnect," which just leads to a Yes/No prompt) is colored by its own flavor, not strictly by "did this button just navigate vs. actually execute" — a judgment call, easy to adjust if any specific one reads wrong in practice.

### v0.8.4 — Memory and watchdog hardening

A dedicated deep pass specifically on memory behavior, the shutdown/watchdog path, and anything else likely to break under real usage — analyzed fully before any fix, consistent with the checkpoint discipline.

- **Fixed (undermined the watchdog's whole purpose):** the shutdown sequence had no overall deadline. `httpServer.close()` waits for every connection — including idle keep-alive ones — to close on its own rather than forcing them; Redis's `client.quit()` has known hangs under certain reconnect states. Either one hanging meant `process.exit()` never ran, so instead of a clean preemptive restart, the process would just sit there — still consuming memory — until Railway's kernel eventually force-killed it anyway. Every shutdown step now has its own timeout, and the whole sequence is capped by a hard 8-second deadline that force-exits regardless of what's hanging.
- **Fixed (real resource leak):** every GitHub API timeout was a `Promise.race()` — it only stopped *us* from waiting, it never actually cancelled the underlying request. A slow GitHub response kept running in the background indefinitely, still holding a socket and buffers, and the retry logic made it worse by firing a completely independent second request on top of a still-running first one. Every call in `github.js` now uses a real `AbortController`, threaded through via `request: { signal }`, so a timeout genuinely tears down the in-flight request.
- **Fixed:** Pinned Repos has no pagination, and its tree-stats fetch used an uncapped `Promise.all()` — pin 15-20 repos and opening the screen fired that many concurrent GitHub requests at once. Added a small reusable bounded-concurrency helper (`lib/concurrency.js`) and capped it to 3 at a time, matching the effective concurrency My Repos' pagination already had for free.
- **Fixed:** Rename and single-repo Delete both skipped `invalidateTreeStats()` on success, unlike every other write path — a small but permanent in-memory cache leak on every rename/delete. Swept the whole codebase for the same gap; these were the only two.
- **Improved:** the memory watchdog's check interval is now adaptive — it stays fast (5s) whenever RSS is within 20% of the restart ceiling, not just during a fixed 2-minute post-boot window, closing a real blind spot where a spike well after startup could blow past the ceiling within the old flat 30s gap.
- **Improved:** added a debounced early-warning log at 80% of the memory ceiling. Whether the ceiling's exact margin under `--max-old-space-size` is truly correct isn't something static analysis alone can answer — this doesn't change the threshold, it makes the trend visible in the logs before a restart happens, so a wrong margin would show up as real data instead of staying an open question.
- **Noted, not fixed:** `redisSessionStore.js` has the same "timeout doesn't cancel" shape as the GitHub fix above. Left alone deliberately — Redis's real hang risk here is lower (same private network, tiny payloads, already has a connect timeout), and this file runs on every single interaction, so an unverifiable syntax mistake here would have far more blast radius than in a single GitHub feature. Worth revisiting if this is ever actually tested live.

### v0.8.3 — Rename crash fix, callback page redesign, docs cleanup

- **Fixed (crash):** renaming a repo threw `Cannot access 'repoCache' before initialization`. Root cause: a leftover redundant `require('../lib/repoCache')` inside the rename handler shadowed the already-imported top-level one — since `const` is hoisted within its enclosing scope, a reference to `repoCache` earlier in that same block hit the shadow before it was initialized. Removed the redundant require; scanned the whole codebase for the same shadowing pattern elsewhere — this was the only instance.
- **Fixed:** the OAuth callback page's logo wasn't loading — `express.static()` was pointed at the logo *file* directly, but it can only serve *directories*. Fixed to serve the whole `public/` folder, the standard pattern.
- **Redesigned:** `callback.html` — added a connection-beam animation (a pulse traveling between the GitroHub logo and a generic link badge, visualizing the two accounts connecting), a hero result icon with a stroke-drawing entrance animation, a subtle film-grain texture, and a physical shake on the failure state so it doesn't just feel like the success animation in a different color.
- **Restructured:** the Changelog moved out of README.md into its own `CHANGELOG.md`, with working jump-links to each version and a short "highlights" pointer left in the README instead of the full history.
- **Fixed (docs):** README's "Known limitations" section still said "v0.4.0" and claimed there was no double-tap idempotency protection — both false as of this version (actionLock has covered this since v0.6.0, hardened further in v0.8.1/v0.8.2). Also removed a reference to `lib/session.js` in the architecture tree — that file was deleted back in v0.7.1 and the docs never caught up.

### v0.8.2 — Deep bug sweep on the v0.8.1 checkpoint
A dedicated hunt for anything the checkpoint pass introduced or missed, before trusting v0.8.1 as the stable base — checked every core infra file (Postgres, Redis, session store, action locking) plus every handler touched during the checkpoint itself.

- **Fixed:** `actionLock` was a single global lock per user shared across all 9 destructive actions — Delete Repo in flight would wrongly block an unrelated Fork on a different repo. Rescoped to lock per action type, not per user.
- **Fixed:** none of the 4 wizard scenes (Create Repo, Rename, Edit File, Upload) had double-tap protection on their final commit step, unlike every other mutating action in the bot. Now consistently locked.
- **Fixed:** the 30-minute session TTL was misleadingly named `WIZARD_SESSION_TTL_SECONDS` but actually governed *all* session state bot-wide, not just active wizards — meaning `ctx.session.currentRepo` (which Repo View's Visibility/License/Browse Files buttons depend on) silently expired after 30 minutes of any inactivity. Split into two correctly-scoped values: a short one for genuinely wizard-scoped file buffers, and a new 24-hour one for general session state.
- **Fixed:** Postgres/Redis health pings had no caching despite the README already claiming 5s caching since v0.6.0 — combined with v0.8.1 making Settings' Refresh Status trivially spammable (inline, chained, one tap = another refresh button), this was real uncached DB+Redis load with zero debounce. Actually caches now.
- **Fixed:** `requireConnected()` — called at the top of nearly every gated handler in the bot — did two separate database queries where one suffices.
- **Fixed:** Bulk Actions' "you haven't selected anything" fallback reset to page 1 instead of preserving your page position — the same bug already fixed for the Back button, in a sibling code path that was missed the first time.
- **Fixed:** Bulk Actions' live progress message froze mid-batch (stuck showing "⏳ pending") when a bad token triggered an early stop — the final progress-line update was being skipped right before the break.
- **Fixed:** License updates showed a "success" message implying the repo card's license line was already current — GitHub's license detection is an async background scan, not synchronous with the commit, so it could still show the old license for a moment after. Now confirms the commit without claiming the shown data is settled, and the same honest caveat was added to Repo View's language section for the same underlying reason (Create Repo, Replace Folder, and first Upload all trigger the same async-detection lag).

### v0.8.1 — Stability checkpoint: root-cause pass, not patches
A deliberate hardening release before further features — every fix here traces one bug class to its root and applies it everywhere that class occurred, not just where it was first noticed.

**Root-cause fixes (one mechanism, applied everywhere it was needed):**
- **Fixed (the big one):** every Confirm/Cancel dialog — Delete Repo, Delete File, Bulk Actions, Toggle Visibility, Disconnect, Fork, Storage Clear — sent a brand-new "Cancelled." message instead of touching the original. Since Telegram buttons stay live until a message is edited, tapping Cancel and then the *original* Confirm button still fired the action, with zero warning. Fixed once, structurally: a shared `resolveConfirmation()` helper now edits the original message in place (strips the buttons, shows the outcome) the instant either button is tapped, across all 7 flows. A future confirm/cancel screen inherits the fix automatically instead of needing its own patch.
- **Fixed:** `actionLock` double-tap protection extended to Fork and Storage Clear — the two destructive/duplicate-risk actions that didn't have it yet.
- **Fixed:** Pin/Unpin and the entire Tags system (add/remove/create) had zero connection-state check anywhere — a stale button could write to the database while fully disconnected with no indication anything was wrong. Now gated behind the same connection check GitHub-touching actions already use, checked *before* the write, not after.
- **Fixed:** Bulk Select's "back from tag picker" always reset to page 1 instead of the page you were on.

**Data accuracy:**
- **Fixed:** My Repos and Pinned lists still showed GitHub's lagging cached repo size — extended the real tree-based size calculation (already used in Repo View) to both, scoped per-page so it stays cheap.
- **Removed:** Repo View's "Last Updated" line — for a single-owner bot, GitHub only ever bumps that field on the same events that bump "Last Commit," so the two were always identical and one was pure noise.

**New features:**
- **New:** ⚖️ License control — Repo View gains a License button next to Visibility. GitHub has no "set license" API field (it's detected by scanning a LICENSE file), so this fetches the real license text from GitHub's own endpoint and writes it via the same mechanism GitHub's own "Add license" button uses.
- **New:** ✏️ Description editing, directly from Repo View — no more needing the website for a quick description change.
- **New:** 🔑 Access Log relocated into 📜 Activity (same content and toggle, just reachable from one screen instead of two).
- **New:** 🔄 Refresh Status (Settings) and 🔄 Refresh (Activity, Pinned) moved from BBTB rows to inline buttons that produce a fresh chained message each tap.

**Interface — reduced clutter across the board:**
- **Fixed:** several multi-toggle screens (Bulk Select's checkboxes and filter buttons, Storage's Auto-Cleanup menu, Pinned's reorder arrows) resent the entire screen as a new message on every single tap. Now edit the same message in place, matching how Notifications already worked.
- **Redesigned:** every BBTB keyboard in the bot — My Repos, Repo View, Browse Files, Settings, Bulk Select's three keyboards, and several 2-row/2-button screens collapsed to 1 row — cut to fewer rows via 3-column layouts, with any label at real risk of truncation shortened to a synonym instead.
- **Found during the BBTB pass:** 🔄 Refresh was a single label shared by My Repos, Activity, and Pinned's keyboards — since Telegram matches button taps by exact text bot-wide, tapping Refresh from Activity or Pinned was silently triggering My Repos' refresh instead of their own. Fixed as a side effect of relocating those to inline buttons with distinct callback data.
- **Redesigned:** the /start welcome-back message now shows repo/star/pin counts, a public/private split, and last-activity time, formatted to match the ◆/▸ card style used everywhere else.
- **Polished:** the OAuth callback page — a one-time confetti burst on success, a typewriter reveal on the "Linked as @username" line, and a small overshoot-bounce on the result box instead of a flat fade-in.

### v0.8.0 — Card redesign, Search split, and new screens
A large, deliberately-scoped feature pass, done after 3 stability rounds (v0.5.0–v0.7.2) specifically so it could build on a base that wasn't actively crash-looping.

- **Fixed:** Auto-Cleanup's settings message crashed on send — an unescaped hyphen in `*Auto-Cleanup*` broke MarkdownV2 parsing.
- **Fixed:** Repo View's size stat read GitHub's lazily-recomputed `repo.size` field — now computed from the actual file tree, always current.
- **Fixed:** Token Health notifications only ever wrote a silent Access Log entry, never an actual push, despite the toggle implying otherwise.
- **Fixed:** Long Operations' threshold (5+ repos) was unreachable at realistic account sizes — lowered to 3+, and extended to cover Batch Upload, not just Bulk Actions.
- **Fixed:** My Repos' language-breakdown lookup silently referenced an out-of-scope variable on every call (masked by a surrounding try/catch), so it always fell back to the raw single-language field instead of the real breakdown.
- **Fixed:** the Replace Folder confirmation screen looped forever regardless of which button was tapped — the wizard step never advanced its cursor after showing the prompt, so every subsequent tap re-ran the same step from scratch.
- **Redesigned:** one shared repo-card format (◆ header, ▸ bullets, solid dividers) now used everywhere a repo is listed — My Repos, Repo View, Pinned, Search results, and Bulk Select.
- **New:** 📁 My Repos vs 🌐 Public Repo — Search split into two explicit entry points instead of one box guessing intent from a pasted link vs. a typed name.
- **New:** 📊 Stats screen — repo count, visibility split, total stars, top language, most active repo, oldest repo.
- **New:** README and License steps added to the Create Repo wizard, matching GitHub's own creation flow.
- **Redesigned:** Settings BBTB — Notifications folded into My Defaults as its own section.

<details>
<summary><strong>v0.1.0 – v0.7.2 — Getting the bot stable (click to expand)</strong></summary>

### v0.7.2 — Found the actual bug (not a timeout issue)
v0.7.0 and v0.7.1 added timeouts everywhere on the theory that some piece of I/O was stalling. Real logs showed no timeout ever firing, which ruled that whole theory out — the real cause was structural, not a stall:

- **Fixed (root cause):** entering a scene via `ctx.scene.enter(...)` makes Telegraf re-process the *same incoming message* through the newly-entered scene's own handlers. Our global escape-hatch system registered every BBTB label — including the exact labels used to *enter* a scene in the first place ("➕ New Repo", "⬆️ Upload") — as a "leave and re-enter" trigger on that same scene. So tapping New Repo would enter the scene, get re-processed, immediately match its own escape hatch, leave, and re-enter — bouncing several times (each doing real session I/O) before finally settling. That bounce was the entire "15+ seconds, then it works" pattern. Explains precisely why Pin (no scene involved) was instant, and why Rename/Edit File (entered via inline buttons, not BBTB text) were never affected — the collision only happens when the entry trigger and the escape-hatch trigger are the same text message.
- **Fixed:** each scene now excludes its own entry-trigger label(s) from its escape-hatch registrations, so re-entry falls through cleanly to the scene's actual first step instead of colliding with itself.
- **New:** every `/start` reply now shows the running bot version (`🔧 v0.7.2`) — confirm a deploy actually landed without checking Railway.
- **Note:** the v0.7.0/v0.7.1 timeout work (Postgres, GitHub calls, Redis session I/O) wasn't wasted — it's real protection against genuine stalls, just wasn't what caused *this specific* symptom. Both fixes now stand together.

### v0.7.1 — Closed the last unprotected I/O path
v0.7.0 added hard timeouts to Postgres and every GitHub call, on the theory that a single unprotected piece of I/O could block the entire update queue behind it. Real usage found the one piece that got missed:

- **Fixed:** Redis session reads/writes had no timeout — the one piece of I/O that runs on literally *every* single interaction, tap or message. Since updates now process one at a time (v0.7.0), a stall here blocked everything behind it in line, including `/start`, which is exactly what "click Upload, everything freezes, only unfreezes once I tap Start" looked like — `/start` wasn't special-casing its way through, it was just as stuck as everything else, and its eventual completion is what released the queue.
- **Fixed:** same gap in `redis.ping()` (used by Settings and `/health`) — now also timeout-bound.
- **New:** an immediate "typing…" indicator fires the instant any update starts being processed, before the real reply arrives — so a tap never sits there with zero visible feedback, even during the normal split-second of real work.
- **Removed:** `lib/session.js` — dead code from the very first design, before Telegraf's Scenes system replaced it. Never required anywhere; found while auditing every remaining piece of Redis I/O for missing timeouts.

### v0.7.0 — Fixed the freeze (root cause, not a workaround)
Real-world Railway logs showed the bot appearing to freeze on Upload, and even `/start` — which should always work — going unresponsive too. Root-caused to the same underlying issue as the v0.5.0 memory crashes, closing the loop properly this time:

- **Fixed (the actual freeze):** Postgres had no connection or query timeout set at all. If the pool couldn't hand out a free connection — which happens after repeated crash-restarts leave orphaned connections behind — any request touching the database, including `/start`'s own "are you connected" check, just waited forever instead of failing with an error. Now fails fast (5s to acquire a connection, 10s per query) with a clear message instead of hanging silently.
- **Fixed (the crash-loop trigger):** the webhook now discards any backlog of missed updates on every restart (`drop_pending_updates: true`) instead of letting Telegram deliver it all in a burst the instant the bot comes back online. That burst — several updates each triggering their own DB/GitHub work near-simultaneously — was very likely what caused memory to spike hard within the first minute of every restart, which caused another crash, which built up another backlog. Self-reinforcing loop, now broken at the source.
- **New:** the actual backlog size gets logged (via `getWebhookInfo`) right before it's discarded, so this is now visible evidence in the logs, not a theory.
- **New:** incoming Telegram updates are now processed one at a time instead of concurrently — for a single-owner bot this has zero downside, and it caps how many simultaneous DB/GitHub requests can ever pile up at once to exactly one, protecting against this same failure mode even if a backlog ever built up again for some other reason.
- **New:** every GitHub API call (reads and writes) now has a hard timeout (15s single calls, 45s for multi-file commits) — this is what makes the sequential processing above actually safe, since without it a single hung GitHub request would now block every subsequent interaction behind it in the queue.
- **Fixed:** `Error stopping bot {"message":"Bot is not running!"}` was firing on every single shutdown — `bot.stop()` only means something in polling mode, but was being called unconditionally in webhook mode too. Now skipped correctly, so real issues aren't buried in that noise.
- **Improved:** the memory watchdog checks every 5s for the first 2 minutes after boot (relaxing to 30s after), since that's the window a backlog-burst spike would show up fastest in.
- **Improved:** `/start`'s optional repo-count lookup now races against its own 4s timeout, so it can never block the welcome message even if GitHub itself is slow.
- **Improved:** shortened all 3 bot command descriptions — Telegram's command list is a compact popup, long descriptions were getting crowded.

### v0.6.0 — Optimization, hardening, and a real security fix
A large pass covering performance, resilience, and a genuine security gap — all discussed and locked in before building.

**Security (do this one):**
- **Fixed:** the Telegram webhook accepted any POST request without verifying it actually came from Telegram. Since `ownerGate` trusts whatever `from.id` is in the request body, a forged request claiming to be the owner would have gone straight through — full bot control, no Telegram account needed. Now verified via Telegram's `secret_token` mechanism on every incoming webhook request. **Set `TELEGRAM_WEBHOOK_SECRET`** in Railway (falls back to a derived value if unset, but a dedicated secret is strongly recommended for a public URL).

**Performance:**
- **New:** short-lived caching (60s) for repo lists and per-repo language breakdowns, plus a longer-lived cache (10min) for your GitHub username — My Repos, Pinned, Bulk Select, and Search were all independently re-fetching the same data within seconds of each other. Every write path (create/delete/rename/upload/visibility/bulk actions/disconnect) explicitly invalidates the relevant cache, so nothing goes stale.
- **Fixed:** GitHub API client reuse extended with retry-with-backoff for read operations (repo list, tree, file content, languages) — one retry on a transient 5xx/network error before giving up. Deliberately not applied to writes, which could risk double-executing a mutation.
- **New:** health check pings (Postgres/Redis) now cache for 5s to avoid redundant DB round-trips if Railway polls frequently.

**Stability:**
- **New:** process-level crash handlers — an uncaught exception now triggers the same clean shutdown (closing DB connections properly) instead of the process just disappearing; unhandled promise rejections are logged clearly instead of vanishing silently.
- **New:** double-tap protection on every destructive action (delete repo, delete file, bulk actions, disconnect) — a duplicate tap while the first is still processing gets a clean "already processing" reply instead of running twice.
- **New:** zip bomb guard — checks total *uncompressed* size from zip metadata before extracting a single byte, not just the compressed size we already capped.
- **Fixed:** single-file uploads (not zips) had no size cap at all — now capped at 5MB.
- **New:** timeout on the Telegram file-download fetch — a hung request no longer hangs indefinitely.
- **New:** global Express error handler — an unexpected error in a route now fails clean instead of behaving unpredictably.
- **New:** GitHub rate-limit errors now get their own specific message showing the actual reset time, instead of a generic error.
- **New:** Telegram's flood-control responses (429 + `retry_after`) are now honored during Bulk Actions' progress updates instead of just being swallowed.
- **New:** Redis reconnection events are now logged, instead of silently retrying with library defaults.
- **New:** structured logging (`lib/logger.js`) replacing scattered `console.log` across the app's core infrastructure — timestamped, leveled, consistent.
- **Improved:** Node's heap cap is now set via `NODE_OPTIONS` (an env var) instead of hardcoded in `package.json` — tunable per-plan without a redeploy.

### v0.5.0 — Fixed the OOM crash loop
Railway confirmed the bot was hitting the free tier's 512MB ceiling and getting hard-killed — happening even at rest, and faster under active use. Root-caused and fixed in layers:

- **Fixed:** Node's heap wasn't capped, so V8 never felt pressure to garbage-collect before the container's real limit — added `--max-old-space-size=384`.
- **Fixed:** Postgres pool was uncapped (up to 10 idle connections); capped to 3 via `PG_POOL_MAX`.
- **Fixed:** a new Octokit client was constructed on *every single* GitHub API call instead of being reused — now cached per token.
- **New:** graceful shutdown on `SIGTERM`/`SIGINT` — Postgres pool and Redis connection now close cleanly instead of the process just disappearing.
- **New:** a self-imposed memory watchdog that triggers a clean restart before Railway's kernel would otherwise force-kill the process.
- **Fixed (the big one):** Upload's raw file bytes were being serialized into Redis on every wizard step (path selection → summary → commit) instead of once. Now held in a short-lived in-process cache; only a lightweight reference touches session state. This directly explains "crashes faster when actively using it."
- **New:** `GET /health` endpoint for Railway to poll.
- **Cleanup:** removed `archiver` from dependencies — listed in `package.json` but never actually used anywhere in the code. Lazy-loaded `adm-zip` so it's only pulled into memory when a zip upload actually happens, not on every scene load.

### v0.4.0 — Completed the 3 noted gaps, plus another bug-scan pass
The 3 items explicitly noted as "reported, not fixed" in v0.3.1, now actually wired:

- **Notification toggles now do something** for 3 of the 4 categories:
  - ⚠️ **System Alerts** — Settings now proactively pushes a message (not just an Activity Log entry) when Postgres or Redis is unreachable, debounced to once per 10 minutes so it doesn't spam on repeated views.
  - 🔑 **Token Health** — a new shared error helper detects GitHub auth failures (expired/revoked token) anywhere in the bot and responds with the specific "reconnect" message we originally designed, instead of a generic error. Wired into Upload, Create/Rename/Delete Repo, Visibility toggle, Download, Edit File, and Bulk Actions.
  - ⏳ **Long Operations** — Bulk Actions (5+ repos) now sends an explicit "long operation finished" callout when this is on, in addition to the normal summary.
  - 🔔 **GitHub Activity** remains honestly documented as pending — it needs a receiving webhook endpoint, still a deferred item, not silently pretending to work.
- **Browse Files now paginates** (8 items/page) — a large folder no longer risks exceeding Telegram's inline-keyboard button limit.
- **Bulk Actions now stop cleanly on a bad token mid-batch** instead of grinding through every remaining repo and reporting the same failure N times — detects it once, reports it once, shows what did complete beforehand.

**Additional bugs found during this pass and fixed:**
- Deep-audited every button's callback data against the router again (habit now) — no new orphaned callbacks found this round.
- Verified the System Alert debounce logic wasn't accidentally checking its own just-written log entry (would have suppressed the very first alert every time) — caught and reordered before shipping.

### v0.3.1 — Deep audit bug fixes
A full cross-reference pass (every button's callback data checked against the router, every BBTB label checked against its handler) turned up 5 real issues, all fixed:

- **Fixed (serious):** the global ❌ Cancel button only cleared 2 of 5 possible pending session flows. Tapping Cancel while creating a tag, editing a default, or mid-way through typing "RESET" to confirm a full data wipe left that flag stuck active — meaning an unrelated later message could get silently misinterpreted in that stale context (worst case: an unrelated message happening to read "RESET" could trigger an unintended full data wipe). Cancel now clears every pending flow's flag, every time.
- **Fixed:** Edit File's and Rename Repo's confirm steps treated *any* stray callback (not just the intended button) as if it meant "confirm" — including a tap on an unrelated old button elsewhere in the chat. Both now explicitly check for the exact expected callback and reject anything else.
- **Fixed:** stale/expired button taps left Telegram's loading spinner stuck with no response. Every unmatched callback now gets an explicit "This button has expired" reply.
- **Removed:** dead code — a leftover "Upload Here" button path from before that feature was redesigned as a BBTB button; the flag that would have triggered it was never actually set anywhere.
- **Verified, not changed:** re-audited Bulk Actions' progress-line rendering (looked suspicious, traced through by hand — confirmed correct), and cross-checked every new v0.3.0 table's SQL constraints against every `ON CONFLICT` clause in the corresponding JS (all match).

**Confirmed still open** (reported, not yet fixed — awaiting direction): 3 of the 4 Notification toggles (System Alerts, Long Operations, Token Health) save state but nothing reads them yet; Browse Files has no pagination for large folders; token-expiry-mid-action doesn't route to the specific reconnect message we designed for it.

### v0.3.0 — Feature expansion
Nine new features, one long-standing bug fixed properly, added carefully so nothing sits half-wired:

- **Fixed:** Edit File's ❌ Cancel (and every exit path — success, error, stale-file conflict) dumped you at Main Menu instead of back to the exact Browse Files folder you came from.
- **Fixed:** Repo View still showed the old single-language emoji-circle format instead of the percentage breakdown already fixed elsewhere in v0.2.0 — now consistent everywhere, using the locked tree-character formatting standard.
- **New:** 📌 Pinned Repos, with manual reorder (⬆️⬇️) — entry point lives in My Repos' BBTB, not Main Menu.
- **New:** 🏷️ Tags — create/assign/remove per repo, filter My Repos by tag, bulk-select by tag, shown as chips wherever a repo is listed.
- **New:** 🧹 Bulk Repo Actions — multi-select with smart shortcuts (Select All, Invert, Stale 6mo+, by visibility, by tag), delete/visibility/download in one pass, live per-item progress, and an honest partial-failure report if some fail.
- **New:** 📥 Batch Upload — the existing Upload flow now collects multiple loose files before asking for a path, one combined commit.
- **New:** 🔁 Replace (file) and 🔁 Replace Folder (full sync with an explicit delete-preview before committing — the only place Upload is allowed to remove files, and only with your confirmation).
- **New:** ⬆️ Upload Here — uploads straight into whatever folder you're browsing.
- **New:** ⚙️ My Defaults — saved visibility/commit-message/upload-path/sort/filter, with a pattern-based "learn from me" suggestion after 3 consistent choices.
- **New:** 📦 Storage & Data — live counts of what GitroHub stores about you, granular or full-reset clearing (full reset requires typing "RESET", not just a tap), JSON/text export, and configurable auto-cleanup.
- **New:** 🔑 Access Log — separate from general Activity, tracks connect/reconnect/disconnect events specifically, with an optional alert on new connections.
- **Internal:** caught and fixed two features that were built but never wired to anything callable (`checkVisibilityPattern`, `getLastPath`) during a dead-code sweep before release — both now genuinely affect the Create Repo and Upload flows.
- **Internal:** caught and fixed two new `reply_markup` BBTB/inline conflicts (same class of bug as v0.1.1) introduced in the new Bulk Select screens, caught by the same automated scan before shipping.

### v0.2.0 — Real-world testing fixes
A big pass of fixes based on hands-on testing against a live account:

- **Fixed:** Download Repo (and external repo download) produced an empty 9-byte zip for any private repo — the code was fetching an unauthenticated `github.com/.../archive/...zip` URL, which 404s without a session for private repos. Now uses Octokit's authenticated archive endpoint, works for private and public repos alike.
- **Fixed:** Repo list showed a single guessed "primary language" with an emoji circle. Now shows a real top-3 language breakdown with percentages (`GET /repos/{owner}/{repo}/languages`), and repos are visually separated with divider lines instead of running together.
- **Fixed:** Tapping ↕️ Sort or 🔎 Filter crashed with `400: message can't be edited` — these were trying to edit a message that didn't exist from that context (a BBTB tap has no prior bot message attached to edit). Now they send their own fresh message, edit *that*, briefly show a confirmation, auto-delete it, then send a fresh repo list.
- **Fixed (structural):** Any BBTB button or even `/start` got silently swallowed while inside a wizard (Create Repo, Upload, Rename, Edit File) — Telegraf hands control entirely to the active scene, so handlers registered afterward never ran. Fixed by attaching the exact same navigation handlers directly onto every scene as first-class escape hatches, so `/start`, `/cancel`, and every BBTB nav button now work identically whether or not a wizard is active.
- **Fixed:** "⬆️ Upload Files" button (shown on empty repos and after creating a new repo) did nothing — its callback pattern was never wired up in the router.
- **Fixed:** Repo deletion failed with "Must have admin rights to Repository" — the OAuth scope only requested `repo`, not `delete_repo`. Scope now requests both. **You'll need to disconnect and reconnect once** for this to take effect on an already-linked account.
- **Fixed:** Uploading a photo via Telegram's image picker failed with a generic "send a document" message — now explicitly explains photos get compressed (altering file bytes) and tells you to use the 📎 File option instead.
- **Fixed:** Typing a manual upload path had an unreachable "(leave blank for root)" instruction — Telegram doesn't allow sending empty text. Added an explicit "📍 Use Root" button instead.
- **Improved:** Before asking for a manual upload path, the bot now shows the repo's current top-level file/folder structure for context.
- **Improved:** Upload change-detection now shows exact size deltas for modified files (e.g. `helper.js: 2.1 KB → 2.4 KB`), and refuses outright with a clear message — no Commit button offered at all — when nothing actually changed, instead of allowing a no-op commit.
- **New:** Bot commands (`/start`, `/settings`, `/cancel`) now register automatically via `setMyCommands` on boot — no manual BotFather setup needed.
- **New:** Distinct disconnected-state flow — BBTB now shows only "🔗 Connect GitHub" and "⚙️ Settings" while logged out (instead of the full menu with dead buttons underneath), and Settings shows clear "Not connected" placeholders instead of blank/broken GitHub-dependent fields. Disconnecting now resets the BBTB immediately.
- **Improved:** Welcome-back message now shows your GitHub username as `@username` and includes a live repo count.

### v0.1.1 — Bug fix
- **Fixed:** inline keyboards were being silently dropped on 7 screens due to a `reply_markup` conflict between inline and BBTB keyboards sharing one message.

### v0.1.0 — Initial build
- Owner-only gate, OAuth Web Flow with animated callback page, My Repos, Create/Rename/Delete repo, Visibility toggle, Upload, Browse Files, Download, Fork, Settings dashboard, Activity Log, Notifications.

</details>

---

