# HomeBase v2

Personal / household operating system for Luke & Hayley. Single-file PWA (no build step) on GitHub Pages, Supabase as the authoritative database, a Cloudflare Worker as the AI brain.

```
index.html              the app (CSS + JS inline; ES module imports ./shared/*)
sw.js, manifest.webmanifest, icons/     PWA
shared/                 dates.js · recurrence.js · planner.js — shared by app and Worker
worker/                 Cloudflare Worker: /chat (streaming tool-use), /plan, /learn, /confirm
supabase/migrations/    001 schema · 002 RLS · 003 seed (Luke's real household)
docs/                   build plan, v17 archive
parts/                  source parts concatenated into index.html (cat parts/* > index.html)
```

## First-time setup (about 20 minutes)

1. **Supabase** — in the SQL editor run, in order: `supabase/migrations/001_v2_schema.sql`, `002_rls.sql`, `003_seed_household.sql`. Enable Email auth (Authentication → Providers). The old v17 tables are renamed `v17_*`, not dropped.
2. **Worker** — see `worker/README.md` (`wrangler login`, four `wrangler secret put`, `wrangler deploy`). Copy the Worker URL.
3. **App** — GitHub Pages serves this branch. Open the site, enter the Supabase URL + anon key (or drop a `config.js` next to `index.html`, see `config.example.js`), sign up with your email, choose **Create household** — that seeds Ruby, the Nursery and Patio projects, routines, maintenance rules and starter memories. Paste the Worker URL under Settings → App & connections.
4. **Hayley** — signs up on her own device, chooses **Join household**, enters the invite code from Settings → Household.
5. **Wall iPad** — open the site, sign in as Luke, Add to Home Screen, then open `…/?wall=1`. Set a display PIN in Settings.

`?demo=1` runs the whole UI on an in-memory copy of the seed data with no backend — useful for previews.

## Editing

Edit files in `parts/`, then `cat parts/01-head.html parts/02-body.html parts/03-core.js parts/04-today-tasks.js parts/05-home-projects-calendar.js parts/06-settings-ai-wall-init.js > index.html`. Bump `VERSION` in `sw.js` when shipping so installed PWAs refresh.