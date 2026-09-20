# HomeBase v2

Personal / household operating system for Luke & Hayley. Single-file PWA (no build step) on GitHub Pages, Supabase as the authoritative database, a Cloudflare Worker as the AI brain.

```
index.html              the app (CSS + JS inline; ES module imports ./shared/*)
sw.js, manifest.webmanifest, icons/     PWA
shared/                 dates.js · recurrence.js · planner.js · attachments.js — shared by app and Worker
worker/                 Cloudflare Worker: /chat (streaming tool-use + web search), /plan, /learn, /confirm, /undo
supabase/migrations/    001 schema · 002 RLS · 003 seed · 004 attachments · 005 people/person lens
docs/                   build plan, v17 archive
parts/                  source parts concatenated into index.html (cat parts/* > index.html)
```

## First-time setup (about 20 minutes)

1. **Supabase** — in the SQL editor run, in order: `supabase/migrations/001_v2_schema.sql`, `002_rls.sql`, `003_seed_household.sql`, `004_ai_attachments.sql`, `005_household_people_ai_context.sql`. Enable Email auth (Authentication → Providers) and set the Site URL to the GitHub Pages address. The old v17 tables are renamed `v17_*`, not dropped.
2. **Worker** — deployed automatically by Cloudflare Workers Builds from this repo (root directory `worker`, `npx wrangler deploy`). Secrets live only in the Worker (Settings → Variables and Secrets): `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Manual alternative: `worker/README.md`.
3. **App** — GitHub Pages serves this branch. Open the site, enter the Supabase URL + anon key (or drop a `config.js` next to `index.html`, see `config.example.js`), sign up with your email, choose **Create household** — that seeds Ruby, the Nursery and Patio projects, routines, maintenance rules and starter memories. Paste the Worker URL under Settings → App & connections.
4. **Hayley** — signs up on her own device, chooses **Join household**, enters the invite code from Settings → Household.
5. **Wall iPad** — open the site, sign in as Luke, Add to Home Screen, then open `…/?wall=1`. Set a display PIN in Settings.

`?demo=1` runs the whole UI on an in-memory copy of the seed data with no backend — useful for previews.

## Editing

Edit files in `parts/`, then `cat parts/01-head.html parts/02-body.html parts/03-core.js parts/04-today-tasks.js parts/05-home-projects-calendar.js parts/06-settings-ai-wall-init.js > index.html`. Bump `VERSION` in `sw.js` when shipping so installed PWAs refresh.

## What the AI can do

- **Everything the app can.** Specialised tools for the common actions (tasks, calendar, routines, maintenance, plants, pets, lists, notes, memories, projects) plus `create_record / update_record / list_records / archive_record` for every other table. Destructive changes (delete task, delete file, archive, bulk update, forget) create a confirmation card first; everything else executes immediately with Undo.
- **Web research.** Anthropic server-side `web_search` + `web_fetch` (prices, products, contractors near New Braunfels, how-tos). Answers cite sources; budgets can be saved straight into project costs and vendor notes.
- **Attachments — one universal flow.** The paperclip / camera / drag-drop / paste in Ask HomeBase means *give this to HomeBase*. Files go to the private `household-media` bucket (a JPEG derivative is made client-side for analysis and thumbnails), then the AI reads the message + file, searches household context and files it (`file_links` is many-to-many: a receipt can belong to a project, a cost line and the conversation). Ambiguous → one question. See `supabase/migrations/004_ai_attachments.sql`, `worker/src/attachments.js`.
- **People as lenses, not logins.** One shared login; each device defaults to a person (the pill in the top bar: Luke / Hayley / Household; wall iPad = Household). "Remind me" means the speaking person; tasks can belong to one person, several (`task_assignments`) or anyone. Memories can be household-wide or person-scoped. See `005_household_people_ai_context.sql`.
- **Whole-house awareness.** `get_household_overview`, `get_person_context`, `get_recent_changes` give the model a compact snapshot on demand instead of dumping the database into every prompt. Prompt caching keeps the static tools/rules cheap.

## Security model

Keys never touch the page or GitHub: the Anthropic key and the Supabase secret key exist only as Worker secrets. The page uses the publishable key + Row Level Security; the Worker verifies the user's JWT and scopes every query to their household. Files are private (signed URLs for minutes, never stored). Archive, never delete; every AI action is written to `activity_log` with before/after and Undo.
