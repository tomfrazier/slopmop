# Slop Mop server

The backend for the [Slop Mop extension](../slopmop-extension). MIT licensed.

Slop Mop is a small, open research experiment: *not an AI detector, a bad-writing detector*. The extension reads LinkedIn posts before you do. This server is what it asks. For each post it puts twelve questions to **Jev** (from [Typesafe AI](https://typesafe.ai)) in parallel, works out the parts of the score that don't depend on your browser, keeps a small registry of what it has seen and what people voted, and enforces a daily limit per install. It runs as plain [Vercel Functions](https://vercel.com/docs/functions) on Turso and needs nothing else.

Eleven of the twelve questions judge the writing: nine signs of slop from Graphite's [AI tells research](https://graphite.io/five-percent/research/ai-tells), and two counter-signs (sounds like one particular person; useful to a reader). The twelfth asks how likely a model drafted the post and can only soften a score. What goes in, what is stored and how each number is made is written down below, because the point of the experiment is that you can check.

**v1 supports LinkedIn.** Nothing in the API is LinkedIn-specific: every record is keyed by `(network, contentId)`, so
reddit, facebook, instagram and so on are a new entry in [`src/networks.ts`](src/networks.ts) plus a content script in
the extension.

## What it does

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/judge` | Score a post. Returns Jev's verdict, the post's `contentId`, what the community has said (`community`), and your `usage`. Counts as one check. |
| `POST /api/v1/vote` | Record, change or clear (`null`) an install's vote on a post: `no`, `maybe`, `probably` (probably = flagged as slop/spam). One vote per install per post. Free (no check used). |
| `GET /api/v1/usage` | This install's checks used today, the client policy, and the sensitivity thresholds. |
| `GET /api/v1/health` | Setup status (storage, Jev route, limits). No secrets. |
| `GET /api/v1/admin/export` | NDJSON of scores + votes for tuning thresholds. Off unless `ADMIN_TOKEN` is set. |
| `GET`/`POST /api/v1/admin/scoring` | The thresholds and the reader-response model, editable live. Off unless `ADMIN_TOKEN` is set. |
| `GET /api/v1/admin/stats` | Everything the admin dashboard shows (see below). Off unless `ADMIN_TOKEN` is set. |

Every request from the extension carries an `x-install-id` header (a random id created at install).

### The registry (built-in storage)

`content` has one row per post: a **hash of the normalised text** (the content id, identical for everyone and across
LinkedIn's feed, profile and "see all" views), the network's own post id when it is a canonical one, Jev's raw answers,
the criteria version and model that produced them, engagement counts, `first_seen` / `last_seen`, and how many times it
was checked. `votes` holds one row per install per post. `usage` counts checks per install per UTC day.

- Identical content is answered from the registry without calling Jev again (verdicts are reused for `VERDICT_MAX_AGE_DAYS`,
  and re-scored automatically whenever the questions or tell library change).
- Vote counts are always derived from the votes themselves, so they can't drift.
- **The post text is not stored** unless you set `STORE_CONTENT_TEXT=true`. Only a hash, scores and counts are kept.
- Install ids are stored only as a salted hash. Set `INSTALL_ID_SALT` to a random string in production.
- Each `/judge` outcome is also logged (time, network, hashed install id, content id, tokens, latency, error class) for the admin dashboard, and pruned after `EVENT_RETENTION_DAYS`. If you publish this extension, keep the onboarding text and your privacy policy in step with what the server stores.

### Daily cap: 250 checks per install per UTC day

`DAILY_CHECK_LIMIT` (default `250`). Enforced with one atomic upsert, so concurrent requests can't overshoot it. Every
call to `/judge` is one check, including ones answered from the registry. A check that fails on our side is refunded.
Over the cap you get `429` with `{ "error": "daily_limit", "usage": { ..., "resetsAt": "…T00:00:00.000Z" } }` and a
`Retry-After` header; the extension stops asking until then and shows the reset time. Vote calls are free.

## Admin dashboard

`https://<your-project>.vercel.app/admin`: a static page ([`public/admin`](public/admin)) that asks for your
**`ADMIN_TOKEN`** and reads `GET /api/v1/admin/stats` with it. Set `ADMIN_TOKEN` (any long random value,
`openssl rand -hex 32`) in Vercel's environment variables and redeploy. Without it the admin API returns 404 and the page
just says so. The key is held in `sessionStorage` (gone when the tab closes), sent as `Authorization: Bearer`, and compared
in constant time. The page is served with a strict CSP (no external scripts, no framing, `noindex`; fonts and styles come from the server itself) and follows the Slop Mop design system.

![The admin dashboard: Jev's AI-likelihood distribution, tell strength, and community votes](../docs/images/slopmop-5.webp)

It shows, for the last 24h / 7d / 30d / 90d (hourly buckets up to 7d, daily beyond), optionally per network:

- **Volume**: posts seen and unique posts all-time, checks, Jev calls vs. cache hits, and checks per hour/day and by UTC hour of day.
- **Cost**: tokens and dollars per hour/day/network/device, cost per 1,000 checks, and a monthly projection at the last-7-day pace.
  Prices come from `JEV_INPUT_USD_PER_M` / `JEV_OUTPUT_USD_PER_M` (defaults match Jev's $0.042 per million input tokens).
- **Installs**: total, new, active in 24h/7d/30d, and how many devices hit or approach the daily cap today.
- **Devices**: the top 25 by checks with cost, limit hits, errors, votes, active days, first/last seen.
- **What Jev sees**: distribution of AI-likelihood, the share of posts that are AI-likely, and the average strength of each tell.
- **Community**: votes over time, how Jev's scores line up with what voters said, the most-flagged posts, and two
  disagreement lists (voters said slop but Jev didn't / voters said fine but Jev flagged it) as candidates for threshold tuning.
- **Health**: errors and daily-limit hits, Jev latency (avg / p50 / p95), storage row counts, and a button to download the tuning export.

Where the numbers come from: `content`, `votes` and `installs` are permanent; `events` (one row per `/judge` outcome, with
token counts and latency, no post text) is pruned after `EVENT_RETENTION_DAYS` (default 90). Devices are shown only as an
8-character prefix of their salted hash. Time is UTC throughout. History starts when this feature is deployed: checks made
before then were counted for the daily cap but not logged.

Try it locally with demo data (never touches a remote database):
`npm run seed:demo` then `ADMIN_TOKEN=demo npm run dev` and open <http://127.0.0.1:8787/admin>.

## Deploy to Vercel

Everything here deploys from Git, so once the project is connected **every push to your default branch deploys
automatically** (and every pull request gets a preview URL).

1. **Import the repo** at <https://vercel.com/new>. If this folder is part of a larger repo (the `slopmop` monorepo),
   set **Root Directory** to `slopmop-server`. Framework preset: *Other*. No build command is needed.
2. **Add the database.** Project → **Storage** → *Create Database* → **Turso Cloud** (Marketplace). It injects
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (any variable prefix works; see `findTursoEnv`). From the CLI:
   `vercel install tursocloud` (the slug is the one in the integration's Marketplace URL). The schema is created on the
   first request; there is nothing to migrate by hand.
3. **Add Jev through Vercel AI Gateway** so the key stays in Vercel and usage is billed there (Jev is `typesafe-ai/jev`,
   about $0.042 per million input tokens). Create an AI Gateway key in the dashboard
   (<https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys%3FshowCreateKeyModal%3Dtrue>) or with
   `vercel ai-gateway api-keys create --name slopmop`, then add it as an environment variable named
   **`AI_GATEWAY_API_KEY`** (Project → Settings → Environment Variables).
4. **Set `INSTALL_ID_SALT`** to any long random string (`openssl rand -hex 32`).
5. **Deploy** (push, or `vercel --prod`). Check `https://<your-project>.vercel.app/api/v1/health`: `ok: true`,
   `storage: "libsql"`, `jev.via: "gateway"`.
6. **Point the extension at it**: build it with `SLOPMOP_SERVER_URL=https://<your-project>.vercel.app npm run build`
   (in `slopmop-extension`). That URL is baked into the extension's permissions.

Optional variables are listed in [`.env.example`](.env.example). Set `ADMIN_TOKEN` to turn on the admin dashboard and the tuning export.

> Tip: put the function region near your Turso database (`vercel.json` → `"regions"`, or Project → Settings →
> Functions) to keep latency low.

### Deploy button

Once the repo is public you can offer one-click setup:
`https://vercel.com/new/clone?repository-url=<repo url>&root-directory=slopmop-server&env=AI_GATEWAY_API_KEY,INSTALL_ID_SALT&project-name=slopmop-server`
(you still add Turso from the Storage tab afterwards).

## Code layout

```
api/v1/**            one-line Vercel entry points (each calls serve("<route>"))
src/handlers.ts      the router: origin/CORS checks, method table, error responses
src/routes/          one file per endpoint group: judge (parse -> admit -> verdict -> record), vote/usage/health, admin, shared helpers
src/repos/           the database, split by job: caps (daily limit), events, clients (kill switch), content, votes, exports
src/store.ts         wires the repos to the database, config and clock; owns install-id hashing
src/stats/           the dashboard's numbers, one module per section over a shared time-window "scope"
src/weights.ts       pure weight logic (parse, validate, apply); src/weightStore.ts is the live-editable, cached store
src/jev.ts, hedge.ts talking to Jev: hedged requests, rate-limit waits
src/constants.ts     every named limit and default that isn't a config setting
public/admin/        the dashboard: plain ES modules (dom, format, api, charts, widgets, weights, clients, views/*), no build step
test/                vitest; every DB-backed test runs against both SQLite and libSQL; dashboard.test.ts boots the real dashboard in jsdom
```

## Local development

```bash
npm install
cp .env.example .env.local     # put a TYPESAFE_API_KEY (direct) or AI_GATEWAY_API_KEY (gateway) in it
npm run dev                    # http://127.0.0.1:8787/api/v1/health
npm test && npm run typecheck
```

With no Turso variables set it uses a SQLite file at `data/slopmop.db` (gitignored), so you need no cloud account.
`vercel dev` also works if you prefer Vercel's own runner.

### Speed

A check takes about 0.5s (0.3s when the answer is already in the registry). Occasionally a Jev request stalls; the SDK's
default was a 10s timeout with two retries, so one stall cost 10s and three hit the function's 30s limit. Instead the
server **hedges**: if a request hasn't answered after `JEV_HEDGE_MS` (1.5s) it sends a second one and takes whichever
finishes first (up to `JEV_MAX_ATTEMPTS`, each with a `JEV_ATTEMPT_TIMEOUT_MS` of 5s), so the worst case is a few seconds.
Hedged calls are counted on the dashboard. If Jev (or the AI Gateway) answers 429, the server waits as long as it asks (0.5-2.5s) and retries up to `JEV_RATE_LIMIT_RETRIES` times before returning `503 upstream_busy` with `Retry-After: 3`; the rate-limit headers are logged so the real limit is visible in the function logs. The independent database calls in a check (cap + lookup, then the writes + vote
read) also run in parallel. Every `/judge` response carries a `Server-Timing` header (`cap`, `lookup`, `jev`, `write`,
`total`, in ms), so slowness can be diagnosed with `curl -i` and no logs. For the lowest latency, run the function in the
same region as your Turso database (Project → Settings → Functions → Function Region).

### Rate limits are the server's call

The extension decides nothing about how hard it may push. Every `/judge` and `/usage` answer carries a `policy`
(`{ maxConcurrent, ratePerMinute }`, from `CLIENT_MAX_CONCURRENT` and `CLIENT_RATE_PER_MINUTE`); the client remembers it and
paces itself to it. The server also **enforces** the per-minute limit per install: over it, `/judge` answers
`429 rate_limited` with `Retry-After` and the client pauses its whole queue for that long. A refused request costs no check.
Change the numbers in Vercel and every client follows on its next request. The daily cap (`DAILY_CHECK_LIMIT`) works the
same way. This is separate from the shared upstream limit on your Jev/AI Gateway key, which the server handles by waiting
and retrying (`JEV_RATE_LIMIT_RETRIES`).

### Disabling a client (admin kill switch)

In the dashboard's **Devices** table, tick a device's **Disabled** box (or enter a device id under **Disabled clients**). That
install is then refused by `/judge`, `/vote` and `/usage` with `403 client_disabled`, spends no checks, and its votes stop
counting toward the community tallies and the tuning export. The extension shows the message and looks again once an hour;
untick the box to let it back in. Devices are the 8-character ids the dashboard shows (a prefix of the salted install hash),
so this works without ever storing a raw install id. API: `GET /api/v1/admin/clients` lists disabled clients;
`POST /api/v1/admin/clients {"device":"ab12cd34","disabled":true,"reason":"…"}` changes one (admin token required).
An install id is only a random value the extension makes, so a determined user can reinstall for a fresh one; this is a
lever for stopping a specific abuser quickly, not a hard ban.

### Tell weights: private, and editable live ("secret sauce")

How much each tell counts toward the slop score is a tuning result, so the repo ships every tell at weight 1 and the real
values never reach the extension: the server applies them and `/judge` returns only the weighted result (`tellMean`,
`tellRank`, and a `weightsVersion`). Where the weights come from, in order:

1. **Edited live in the admin dashboard** (Tell weights card): sliders per tell, an optional note, Save. The edit is stored in
   the database, applies to every server instance within about 10 seconds, and is logged in a change history you can load
   back into the editor. **Reset to baseline** drops the edit.
2. **`TELL_WEIGHTS`** (Vercel environment variable, JSON such as `{"formulaicHook":0.9,"emptyEvaluation":1.25}`; unlisted
   tells count 1): the baseline that applies when there is no live edit, and what "Reset" returns to.
3. **All 1** (the public default).

**Counter-tells.** Two more sliders sit under their own heading: `humanVoice` (how much a personal voice takes off the slop score) and `usefulness` (how much of the shield comes from Jev's usefulness answer rather than reader response). Each is a multiplier on the designed strength, so 1 is as designed. They are edited, versioned and logged with the tell weights, and like them they never leave the server: `/judge` returns the finished `slop` and `shield` instead (see the next section). They don't take part in the tell mean, and the community suggestion never changes them.

`/health` reports which one is in force (`"live"`, `"env"` or `"default"`), never the values. A stored verdict is re-weighted
on every request, so an edit needs no re-scoring. Each response carries a `weightsVersion`; when it changes, an extension
refreshes the answers it had saved (one daily check each) the next time those posts come up. The weights are readable by
the admin token only (`GET /api/v1/admin/weights`); POST `{"weights": {...}, "note": "..."}` saves, `{"reset": true}` resets.
If the database can't be read, scoring carries on with the last known weights.

Trade-off: a live edit lives in your database (protected by the admin token), while `TELL_WEIGHTS` lives only in Vercel. Keep
`TELL_WEIGHTS` as the baseline either way. This is obscurity, not cryptography: someone with many scored posts could estimate
the weights by regression from the composite, and the extension's `THRESHOLDS` and other constants are public.

**Suggested weights.** *Suggest from community votes* (same card) measures how well each tell alone separates posts the
community called "probably" from ones it called "no", and proposes weights nudged toward that, more firmly as votes
accumulate. It reports how well the composite separates the two groups on the votes and, more importantly, on held-out votes
(5-fold). It needs at least 15 of each kind, and it **never applies anything on its own**. Votes are noisy and installs are
free to create, so treat a suggestion as something to review (and disabled clients' votes are already excluded). A daily
automatic update is deliberately not built: review a suggestion when you have a meaningful number of voters.

### Scoring: the server's half of the decision, and the thresholds

For each `/judge` the server returns `slop` (the tell mean × gain, less the human-voice offset, cut when a single tell stands alone; see below), `shield` (Jev's usefulness answer plus **reader response**, capped at 60%) and `engagementNorm`, computed from the reaction, comment and repost counts that request carried. The extension finishes the arithmetic (the dampener for posts that read human-written, then the threshold).

**When Jev is asked again.** A stored answer is reused for a wait that follows how fast the post is growing (`src/recheck.ts`): the first score is kept an hour; when the post has at least doubled since the last score, the next wait is its doubling time (double in an hour and it is re-scored hourly, and so on while it keeps doubling); each time it has not, the wait doubles (1h, 2h, 4h ... up to 7 days). Inside the wait a request costs no Jev call: the server re-weighs the stored answers against the new counts, so the shield tracks the post even though Jev is not asked. Once the wait is over, the next request re-scores the post: Jev is given the counts now and its previous usefulness answer as observed facts, so a post that has taken off is judged on how readers received it and not only on its text. Each stored row carries `engagement_at_score`, `recheck_interval_ms` and `next_recheck_at` (migration 6); rows from before that count as due once. This is a server matter: many people see the same post, and it is the server that decides when Jev is worth asking again. The extension just sends fresh counts whenever a post has grown about a quarter.

**Two guards against a single loud tell.** Each tell counts toward the mean in proportion to the square root of Jev's confidence in that answer, so a tell Jev wasn't sure of pulls the average up less, and one it had no confidence in has no say. And one sign on its own is thin evidence, because people write sincerely with a single over-the-top habit: a post is scored in full only when at least two tells reach 0.5 with Jev at least 0.5 sure of them. With exactly one standing out, its slop score is multiplied by 0.6. A post with none standing out is broad and mild, and is left as it is. The four numbers (breakout, minimum confidence, signs needed, the multiplier) are in the dashboard's **Scoring** card. These are the fixes for a false positive found on a joke that parodies LinkedIn-speak: Jev read the parody as the real thing, one sign stood out, and another had no confidence behind it.

**Reader response** is `log10(1 + weighted) / 4`, where `weighted = reaction×1 + comment×5 + repost×12`. A post with at least 50 reactions and fewer than 2 comments-plus-reposts per 100 reactions has its credit scaled down (never below 40%), because a pile of reactions with nothing behind it is the shape of a pod or a cheap hook. All six numbers are editable in the dashboard's **Scoring** card.

### Nothing votes itself into the scoring

No vote changes a score, a weight, a threshold or any manifest value, by design and by test. Votes change only the "N people flagged this" line other people see, and feed the dashboard. If they could steer the scoring, anyone could vote their own posts clean, or a rival's dirty. The way settings change is: the admin reads the aggregate data, decides, and saves.

Every number in the score is editable from the dashboard's **Scoring** card (gain, human-voice offset, shield share and cap, how much Jev's confidence counts, the reader-response model, corroboration, the re-scoring schedule, the three thresholds), and every client value from **Client settings**. The tell weights and the two counter-tell weights are in the weights card.

### How a score is made, and a history of every change

The dashboard's **How a score is made** card writes the formula out in plain words with today's numbers, and has a simulator: set Jev's answers to the twelve questions (or start from a preset such as "Blatant AI slop" or "A joke that took off"), and the server runs the real scoring code and shows each step (tell average, slop, shield, AI dampener, score, the number shown, and what each sensitivity does with it). It also previews edits you haven't saved in the weights, Scoring and Client settings cards, and says so. Nothing is saved and no check is used (`POST /api/v1/admin/simulate`).

The **Scoring** and **Client settings** cards keep a change history like the tell weights do: every save and reset is logged with your note (`setting_history`, migration 8), newest first, and **Load** puts an earlier version back in the editor (it applies only when you save).

### The threshold tuner

The **Threshold tuner** card shows, for a set of labelled posts, what each "likely slop" cut would catch and wrongly flag, scored exactly the way production scores right now (live weights, formula, engagement model, corroboration, dampener and the confidence gate; a test checks it matches `/judge`). It suggests Aggressive, Moderate and Mild thresholds, re-draws the labelled posts 300 times to say how stable the Moderate one is (a wide spread means the sample is too small to trust), and warns when there are fewer than 15 of each kind. It only suggests: **Load into the Scoring card** fills in the draft, and nothing takes effect until you save there.

Two sets of labelled posts:
- **Your labelled posts** are the ground truth. Import the extension's saved votes (settings page, *Export JSON*, or the `labels.jsonl` file) with the card's file picker. Only Jev's answers and the engagement counts are kept, never the post text, and the same post imported twice counts once. They live in `curated_labels` (migration 7) and no one else can add to them.
- **Community consensus** is for comparison. A post counts only with at least `minVotes` voters and a `agree` share of them agreeing, from installs that aren't disabled, and the card warns when few installs voted or one install cast more than half the votes.

### The client manifest

Every fixed value the extension runs on is published at `GET /api/v1/manifest` and edited in the dashboard's **Client settings** card (and **Scoring**, for the three thresholds): request timeouts and retries, how long saved answers are trusted, how far ahead the feed is checked, the shortest post worth scoring, where "possibly" starts, the dampener, and so on. Each value has a default, a range and a note (`src/manifest.ts`); only differences from the defaults are stored. The extension keeps the manifest for 24 hours and every `/judge` and `/usage` answer carries a `manifestVersion`, so a client that sees a version it doesn't hold fetches the new one straight away. Values that are malformed or out of range are ignored by the client. Nothing secret is in it: no weights and no reader-response model.

### Which Jev route is used

- `AI_GATEWAY_API_KEY` set → **Vercel AI Gateway** (`https://ai-gateway.vercel.sh/typesafe`, model `typesafe-ai/jev`).
- otherwise `TYPESAFE_API_KEY` → Typesafe AI directly (`jev-latest`).
- `JEV_PROVIDER=gateway|direct` forces one when both are set.

Both use the same Typesafe AI request/response format, so it is the same client with a different base URL and model.

## Tuning thresholds from what people said

```bash
# from a local checkout, pointing at production:  vercel env pull && npm run export -- --network linkedin --since 2026-09-01 > export.ndjson
# or over HTTP (requires ADMIN_TOKEN):
curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://<project>.vercel.app/api/v1/admin/export?network=linkedin&minVotes=3" > export.ndjson
```

Each line has Jev's raw answers (`dimensions`, `aiLikelihood`), engagement, the vote counts, and a `consensus`
(`probably` / `maybe` / `no`, or `null` until `minVotes` people agree). That is exactly what the extension's
`npm run tune` reasons about: consensus is a label you didn't have to hand-vote.

## Clearing test data before a launch

Everything test installs did lives in five tables. To start clean, run this against the production database (Turso shell or dashboard SQL console); it keeps your weights and settings.

```sql
DELETE FROM events;
DELETE FROM votes;
DELETE FROM usage;
DELETE FROM installs;
DELETE FROM content;
```

Leave `content` out if you want to keep the cache of scored posts (it holds no post text unless `STORE_CONTENT_TEXT=true`).

## Drafts

The extension's "check this draft" button in the LinkedIn composer sends a draft to `/judge` like any other post (one check, counted against the install's daily limit). It is scored as unposted writing with no engagement, and is stored the same way as any post: a hash of the text, Jev's scores and counts, never the text itself.

## Adding another network

1. Add an entry to [`src/networks.ts`](src/networks.ts) (id, length limits, and a pattern for any canonical post id).
2. If it needs different criteria, add a per-network overlay to the tell library in `src/traits.ts` / `src/questions.ts`.
3. Write the extension's content script for it; it sends `network` and the post text to the same endpoints.

## Protecting /judge from scripted use

An install id is just a random value the extension makes up; nothing stops a script from generating a fresh one per
request to sidestep the per-install daily cap. Two more checks in `admit()` ([`src/routes/judgeAdmit.ts`](src/routes/judgeAdmit.ts))
don't depend on it:

- **A datacenter IP block.** `/judge` refuses (`403 datacenter_ip`) any request whose IP falls in a published AWS or
  Google Cloud range — the two providers that each publish one stable, authoritative JSON file of every range they
  own ([`src/datacenterRanges.ts`](src/datacenterRanges.ts): `DatacenterList` fetches and caches both, refreshed once
  a day; a failed fetch never blocks a request, it just keeps the last good list). This alone stops a large share of
  scripted traffic, since that's where most of it runs from, and it costs nothing legitimate: a browser extension
  doesn't run inside AWS or GCP. `BLOCK_DATACENTER_IPS` (default on) and `DATACENTER_CIDR_EXTRA` (to hand-add ranges
  for providers with no single published list — Azure, DigitalOcean, Oracle, Hetzner, OVH, Vultr, Linode, ...) are in
  `.env.example`.
- **A per-IP hourly cap**, `IP_HOURLY_LIMIT` (default 250, so an IP can't do in an hour what one install is meant to
  spread across a day), independent of whatever install id a request claims. It resets on the UTC hour and is a
  ceiling *in addition to* the per-install daily cap, not a replacement for it — an install still needs its own quota
  too. Both this and the datacenter block key off `x-forwarded-for` / `x-real-ip` (`src/clientIp.ts`); with neither
  header present (no proxy in front of the server) they simply don't apply, so local `npm run dev` is unaffected.

Neither of these makes the API impossible to script — nothing free-to-install and secretless can guarantee that — but
together they raise the cost of doing so well past what a casual scraper or a resold "AI slop checker" wrapper would
bother with. What's left uncovered: an attacker running from a residential proxy pool, or from a provider outside the
two blocked ranges, looks just like a real user and gets a real user's limits.

Votes are one per install per post, but installs are free to create, so counts can be inflated by a determined actor;
the IP protections above make that harder but don't stop it, since votes aren't check-gated the way `/judge` is.
- The daily counter resets at UTC midnight, not local midnight.
- Judgments are probabilistic. Stiff, formal human writing can score like slop, and the tuning behind the thresholds is small (27 hand votes to start). Votes will improve it, and the admin dashboard shows where Jev and voters disagree.
- Jev through AI Gateway has a 32k-token state limit (posts here are limited to 6,000 characters).
