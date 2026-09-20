# HomeBase v2 — Build Plan

**Status:** Draft for Luke's approval. Nothing in the repo has been changed.
**Decisions locked (Sep 19, 2026):** single-file HTML PWA + Supabase · AI brain in the existing Cloudflare Worker · phased rebuild.
**Blocker:** GitHub connector not yet attached. Once it is, Phase 1 starts from this doc.

---

## 0. What exists today (v17) and what has to change

The current `index.html` is a working v17 app: Tasks / Home / Projects / Calendar tabs, Supabase sync, PIN lock, full-screen AI chat through a Cloudflare Worker. It is a good shell but it cannot become v2 by patching, for these concrete reasons:

| # | v17 defect | Why it blocks v2 |
|---|---|---|
| 1 | **Date bug.** `TODAY = new Date().toISOString().split('T')[0]` is the **UTC** date. After 7 pm CDT (6 pm CST) the app thinks it is tomorrow. Also computed once at load, so the wall iPad drifts after midnight. | Every "today" list, overdue flag and recurrence is wrong every evening. |
| 2 | **Security.** RLS policy is `allow_all` with the anon key in the page. Anyone with the URL + key has full read/write. PIN is a display lock only, default `1221` in code. | v2 needs real auth so the AI can act with authority and so Hayley can have her own login. |
| 3 | **AI sees a summary, not the data.** System prompt includes only the first 8 open tasks; actions mutate browser arrays and most (`edit_task`, `add_event`, `add_project`, `complete_task` …) never call `sbSave`, so changes are lost on reload. | Spec §3: AI must query the DB and write through structured tools. |
| 4 | **No memory.** Nothing is learned or stored between chats. | Spec §4. |
| 5 | **No Today command center / capacity / replanning.** "Today" is a flat filter on `date === TODAY`. | Spec §5–6. |
| 6 | **Flat data model.** `tasks.cat` is a folder id; no projects↔tasks↔rooms links, no routines, pets, plants, maintenance history. | Spec §2. |
| 7 | **Render churn.** `renderAll()` on every change rebuilds all panes with `innerHTML`; swipe state, scroll position and focus are lost. Duplicate CSS blocks (`.trow`, `.task-home`, `.sf-hdr` defined twice). | Not "smooth" on iPad/iPhone. |
| 8 | **Two recurrence schemes.** The calendar virtually expands one recurring row onto every future date, while completing it materialises a new row. An overdue weekly task therefore shows on every week, single instances can't be completed or moved from the calendar, and the two schemes drift. | |
| 9 | Seed data is demo data (Max & Luna, Master Bath Renovation) — not Ruby, Nursery, Paver Patio. | |
| 10 | The Worker snippet in the setup modal is out of date with the app (it expects `x-api-key` from the browser and has no `GET` health route that `testAI()` calls). The Worker actually deployed isn't in the repo copy I have. | I need the live Worker source; v2 replaces it anyway, with the key only ever server-side. |

**Approach:** rewrite the front-end file with a proper store/render architecture, keep the visual language (Fraunces + DM Sans, dark theme, teal accent), migrate the existing rows, and replace the Worker with a real orchestrator.

---

## 1. Architecture

```
GitHub Pages (static, no build)              Cloudflare Worker (server-side)          Supabase
┌──────────────────────────────┐   HTTPS     ┌──────────────────────────────┐        ┌──────────────────┐
│ index.html  (app shell+UI)   │ ───JWT────▶ │ /chat   tool-use loop        │ ─────▶ │ Postgres + RLS   │
│ sw.js       (offline shell)  │ ◀──SSE───── │ /plan   daily planner        │ svc key│ Realtime          │
│ manifest.webmanifest         │             │ /learn  nightly pattern job  │        │ Auth              │
│ icons/                       │             │ cron: 05:30 & 23:30 CT       │        │ Storage (photos)  │
└──────────────┬───────────────┘             └──────────────────────────────┘        └────────▲─────────┘
               │ supabase-js (anon key + user JWT, RLS-scoped)                                 │
               └───────────────────────────── direct CRUD + realtime subscriptions ────────────┘
```

- **Browser talks to Supabase directly** for all ordinary CRUD (fast, realtime, offline-cacheable). RLS scopes every row to the household.
- **Browser talks to the Worker only for AI** and for the planner. The Worker verifies the user's Supabase JWT, then uses the **service-role key** to run tools — always filtered to that user's `household_id`.
- **Secrets:** `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` are Worker secrets (`wrangler secret put`). The page holds only the anon key + Worker URL.
- **Repo layout:**
  ```
  /index.html            app (single file, CSS+JS inline)
  /sw.js                 service worker: cache-first for shell, network for Supabase
  /manifest.webmanifest
  /icons/*.png
  /worker/src/index.js   orchestrator (wrangler project, deployed separately)
  /worker/wrangler.toml
  /supabase/migrations/001_v2_schema.sql, 002_rls.sql, 003_seed_household.sql, 004_migrate_v17.sql
  /docs/                 this plan, "What HomeBase Knows" spec, changelog
  ```
  "No build step" holds for the app. The Worker is deployed with `wrangler deploy` (one command); it is the only server component.

---

## 2. Data model (Postgres)

Every table has `id uuid pk default gen_random_uuid()`, `household_id uuid not null`, `created_at`, `updated_at` (trigger), and soft-delete `deleted_at` where history matters. Dates are `date` (local calendar day) and timestamps are `timestamptz`; the household stores `tz = 'America/Chicago'` and all "today" logic converts with it.

| Table | Key columns | Notes |
|---|---|---|
| `households` | name, tz, settings jsonb | settings = capacity table, discretionary windows, weather lat/lon |
| `household_members` | user_id (auth.users), person_id, role | drives RLS |
| `people` | name, is_user, color | Luke, Hayley (and future) |
| `areas` | name, kind (room/life/relationship), emoji, sort | replaces `folders`; "Relationship" is a first-class area |
| `projects` | name, priority int, status, stage, description, budget, room_id, target_date | progress is **computed** from steps |
| `project_steps` | project_id, title, phase, sort, status, depends_on uuid[], est_min, done_at, note | dependency graph for Patio/Drain |
| `project_costs` | project_id, item, qty, projected, actual, purchased_at | BOM |
| `tasks` | title, importance (`must`/`should`/`nice`), status, due_date, window_start, window_end, scheduled_start, scheduled_end, duration_min, location (`home`/`anywhere`/`away`), weather_dependent bool, energy (`low`/`med`/`high`), area_id, project_id, step_id, room_id, asset_id, assignee_id, recurrence jsonb, series_id, postponed int, completed_at, actual_min, source (`user`/`ai`/`routine`/`maintenance`) | one row per instance; `series_id` groups a recurring series |
| `events` | title, starts_at, ends_at, all_day, kind (`fixed`/`work_block`/`travel`), task_id, project_id, recurrence jsonb, color, notes | work blocks are events linked to a task |
| `routines` | name, cadence jsonb, area_id, pet_id, min_version text, last_done_at, streak, active | adaptive things: flowers, date night, mow, Ruby training, household reset, hydro/plant checks |
| `routine_log` | routine_id, done_at, duration_min, detail jsonb, note | history for learning |
| `rooms` | name, floor, dims jsonb, finishes jsonb, notes | digital twin (phase 3) |
| `assets` | name, room_id, brand, model, serial, purchased_at, warranty_until, consumables jsonb, photos | HVAC, purifier, water heater… |
| `maintenance_rules` | asset_id, name, interval_days, last_done_at, next_due (generated), instructions | "HVAC filter every 90 d" |
| `maintenance_log` | rule_id, done_at, note, cost, photo | learning real filter life |
| `pets` | name, species, birthdate, notes | Ruby |
| `pet_activities` | pet_id, kind (`training`/`walk`/`vet`/`med`), at, duration_min, focus text, note | |
| `plants` | name, species, location, container, group_name, soil, notes | outdoor + hydroponics crops |
| `plant_observations` | plant_id, at, kind (`water`/`fertilize`/`prune`/`repot`/`observe`/`harvest`), soil_state, ph, ec, water_level, note, photo | |
| `lists` / `list_items` | name / text, qty, done, store, task_id | shopping & packing |
| `notes` | title, body, area_id, project_id, room_id, vendor bool, phone, url | vendors live here with `vendor=true` |
| `files` | storage_path, kind (`photo`/`scan`/`manual`), taken_at, links → | Supabase Storage bucket `household-media` |
| `links` | from_type, from_id, to_type, to_id, rel | generic relationship table for anything not covered by FKs |
| `day_modes` | date, mode (`normal`/`busy`/`travel`/`sick`/`vacation`/`project`), capacity_override_min, note | drives capacity |
| `memories` | see §4 | |
| `ai_threads` / `ai_messages` | thread_id, role, content jsonb, tool_calls jsonb, tokens | conversation history the AI can search |
| `activity_log` | actor (`luke`/`hayley`/`ai`/`system`), entity_type, entity_id, action, before jsonb, after jsonb, reason | audit + learning source |

**Recurrence JSON** (tasks, events, routines):
```json
{ "freq": "weekly", "interval": 1, "byweekday": ["sat","sun"], "prefer": "sat",
  "backup": { "byweekday": ["thu"], "before": "09:00" },      // trash: Wed night, Thu-morning check
  "anchor": "completion" | "schedule" }                       // next = last done + interval, or fixed grid
```
Next-instance materialisation happens **only in one place** (`nextInstance(rule, fromDate)` shared by client and Worker) and only on completion/skip — the calendar never virtually expands, which removes defect #8.

---

## 3. Auth, RLS, sync

- **Supabase Auth**, email + magic link (Luke and Hayley each have a user). The `household_members` row maps `auth.uid()` → household.
- **RLS on every table:**
  ```sql
  create policy hh_select on tasks for select using (household_id = any(my_households()));
  create policy hh_write  on tasks for all    using (household_id = any(my_households()))
                                              with check (household_id = any(my_households()));
  -- my_households() = security-definer fn: select array_agg(household_id) from household_members where user_id = auth.uid()
  ```
- **Wall iPad:** stays signed in as Luke; local 4-digit PIN is a *display* lock (as spec §15 says), with the session token in `localStorage`. Auto-lock timer only in wall mode.
- **Realtime:** one channel, `postgres_changes` on each table filtered `household_id=eq.<id>`. Client store applies upsert/delete by id and re-renders only the views that depend on that table.
- **Client store:** a plain in-memory map per table + a `dirty` set. Writes are optimistic: mutate store → render → `upsert` → on error roll back + toast. This replaces `renderAll()`.
- **Offline (phase 2):** IndexedDB queue of pending writes replayed on `online`; shell cached by `sw.js`. Server stays authoritative — last-write-wins by `updated_at`.

---

## 4. Memory & learning (the "growing memory")

### 4.1 Schema
```sql
create table memories (
  id uuid pk, household_id uuid, subject text,          -- scheduling|home|projects|plants|pets|family|preferences|people
  kind text,                                            -- fact | preference | pattern | stat
  content text,                                         -- one plain sentence, e.g. "Mowing usually happens Saturday morning."
  source text,                                          -- stated | observed | inferred
  confidence numeric(3,2), evidence_count int default 1,
  status text default 'active',                         -- active | ignored | rejected
  entity_type text, entity_id uuid,                     -- optional anchor (a routine, task series, asset)
  last_confirmed_at timestamptz, last_used_at timestamptz, expires_at timestamptz,
  fts tsvector generated always as (to_tsvector('english', content)) stored
);
create index on memories using gin(fts);
```
Start with **Postgres full-text search + subject tags** for retrieval — no external embedding service, no extra key. Upgrade path: `pgvector` + Voyage embeddings if recall proves weak (measured by "did the AI miss a stored fact" in real use).

### 4.2 How memories are created
1. **Stated** — user says something durable ("we like to do house projects Saturday mornings", "Hayley prefers tulips"). The model calls `save_memory` with `source='stated', confidence=0.9`. The chat reply shows a small "Remembered: …" chip so it is never silent.
2. **Observed** — nightly `/learn` job (Worker cron 23:30 CT) computes from `activity_log`, `routine_log`, `maintenance_log`, `plant_observations`:

   | Pattern | Method | Write when |
   |---|---|---|
   | Usual day for a recurring task/routine | day-of-week histogram of `completed_at` over last 12 instances; `share = max_count / n` | `n ≥ 4` and `share ≥ 0.6` → confidence = share |
   | Realistic duration | median of `actual_min` (ignore top/bottom 10 %) vs `duration_min` | `n ≥ 3` and diff > 25 % → update estimate + memory |
   | Postpone tendency | `postpone_rate = Σ postponed / n` per series | rate ≥ 0.5 over ≥ 4 instances |
   | Weekend capacity | median discretionary minutes actually completed on Sat/Sun over last 6 weekends | always; feeds capacity table |
   | Real filter life / maintenance interval | median days between `maintenance_log.done_at` | `n ≥ 2` → propose new `interval_days` (needs confirmation) |
   | Plant drying interval | median days between `water` observations per plant, split by month | `n ≥ 3` |
   | Flowers / date-night cadence | actual gaps in `routine_log` | reported in Weekly Reset, not auto-changed |

   Observed memories carry `evidence_count`; re-running the job **updates** the existing row (matched by `entity_id + kind`) rather than adding duplicates.
3. **Inferred** — the model may propose an inference during chat ("It looks like you avoid errands on Sundays — want me to remember that?"). Saved only on a yes.

### 4.3 How memories are used
- Prompt assembly per turn: (a) all `preference` memories with `confidence ≥ 0.8` (small, stable set), (b) top 12 by FTS rank against the user message + current view context, (c) memories anchored to entities mentioned in the message. Budget ≈ 1,500 tokens. `last_used_at` is stamped so unused memories can be reviewed.
- The planner (§5) reads `pattern` memories directly (usual day, duration, postpone rate) — no LLM in the loop.
- **"What HomeBase Knows"** screen: grouped by subject; each row has Confirm (→ confidence 1.0, `last_confirmed_at`), Edit, Ignore (status=ignored, excluded from prompts but kept), Delete. Confidence shown as words: "Sure / Likely / Guess".

---

## 5. Today planner (deterministic; same code in client and Worker)

### 5.1 Capacity
Discretionary minutes per day, from `households.settings.capacity` (editable in Settings; defaults below), minus fixed events overlapping the discretionary windows:

| Day type | Weekday | Sat/Sun | Windows |
|---|---|---|---|
| normal | 90 | 300 | Mon–Fri 17:30–21:00 · Sat/Sun 08:00–18:00 |
| busy | 30 | 180 | |
| travel | 0 home / 30 remote | 0 / 30 | only `location != home` tasks |
| sick | 20, must-only | 20 | |
| vacation | 0 unless a mode note says otherwise | | |
| project | 90 | 360, reserved for the chosen project | |

`capacity = base − Σ min(overlap(event, window))`, floor 0. Learned weekend capacity (§4.2) replaces the Sat/Sun default once `n ≥ 6`.

### 5.2 Scoring a candidate task for a given day
```
score = importance                  must 100 · should 40 · nice 10
      + urgency                     due_date: 50 · max(0, 1 − days_to_due / 7);  overdue: +60 + 5/day (cap +90)
      + project_priority            P1 +25 · P2 +15 · other +5   (only when the step is unblocked)
      + pattern_fit                 +15 if a "usual day" memory matches this weekday
      + staleness                   +2 per postponement (cap +20)
      + block_fit                   +10 if duration ≤ largest free block that day
      − weather                     weather_dependent && rain_prob ≥ 50 % (Open-Meteo, lat 29.70 lon −98.12) → −100
      − location                    day mode travel && location = home → −1000
      − energy                      sick && energy = high → −50
```
### 5.3 Selection
1. All `must` tasks due/scheduled that day are placed first (they are never cut; if they exceed capacity the day is flagged "overloaded").
2. Remaining candidates (due within the next 7 days, or window open, or next unblocked step of a priority project) sorted by score; greedily add while `Σ duration_min ≤ capacity`. Visible Today list capped at 7; overflow goes to **Coming Up**.
3. Ties broken by earlier due date, then shorter duration.

### 5.4 Needs Attention (3–6 items, ranked)
| Rule | Trigger | Rank |
|---|---|---|
| Overdue must-do | any | 1 |
| Maintenance overdue | `next_due < today` | 2 |
| Trash | Wednesday after 17:00 and not logged → "Trash out tonight"; Thursday before 09:00 and still not logged → "Verify trash" | 2 |
| Flowers gap | days since last `routine_log` ≥ 7 (nudge Thu/Fri, matches "end of week") | 3 |
| Date night | none logged or scheduled this month and day-of-month ≥ 15 | 3 |
| Mowing | ≥ 8 days since last, weekend within 2 days, best day chosen by lowest rain prob then lower load | 3 |
| Stalled priority project | no step completed in 14 days | 4 |
| Open-block opportunity | Sat/Sun free block ≥ 120 min and P1 has an unblocked next step | 4 |
| Plant check due | per-plant learned interval elapsed (or 5 days default) and no rain ≥ 5 mm in last 48 h | 5 |
| Ruby training | none logged today, after 18:00 | 5 |

Cap 6; each item has one tap action (log it / schedule it / snooze 1 day).

### 5.5 When it runs
- Client: on load, on any store change touching tasks/events/day_modes, and at local midnight (timer).
- Worker `/plan` cron 05:30 CT: recomputes, writes `scheduled_start/end` for chosen tasks as work blocks, and prepares the morning "Today" note the AI can narrate. No push notifications in phase 1 (PWA web push on iOS requires Home-Screen install; phase 2).

---

## 6. Replanning engine

Triggered by `set_day_mode` (from chat: "I'm sick today", "traveling Tue–Thu", "Friday off") or by editing a day in the UI.

1. Write `day_modes` rows for the affected dates.
2. Collect tasks scheduled/due in those dates.
3. Classify each: **keep** (must, or fits the new capacity and location), **reduce** (routine with a `min_version`, e.g. Ruby training 10 min → 3 min, household reset → "kitchen only"), **move**.
4. Place moved tasks: iterate days after the affected range (or before departure for travel if `due_date < return`), score with §5.2, add while capacity allows; **spread** rule: a day receives at most `capacity` minutes of moved work, so the return day / Friday cannot become a pile-up. Anything unplaced within 7 days goes to backlog with a Needs Attention note.
5. Log every move to `activity_log` with `reason = 'replan:sick'` etc. — this is the audit trail and the AI's source for the summary ("Kept 3, moved 5 to Sat/Sun, reduced Ruby training to a short session").
6. Reversal: "I'm feeling fine now" → delete the mode row and re-run; moved tasks that have not been touched by the user return to their original slots (stored in `before`).

---

## 7. AI orchestrator (Cloudflare Worker)

### 7.1 Endpoints
| Route | Purpose |
|---|---|
| `POST /chat` | body `{thread_id?, message, context:{view, date, device}}`, header `Authorization: Bearer <supabase JWT>`. Streams SSE: `text` deltas, `tool` events ("Completing HVAC filter…"), `done {actions[], proposals[]}`. |
| `POST /confirm` | executes a proposal (`proposal_id`, signed by the Worker, 10-min TTL) |
| `POST /plan` and `POST /learn` | manual triggers of the cron jobs (also used for tests) |
| `GET /health` | |

Auth: `supabase.auth.getUser(jwt)` with the service client → `household_id` from `household_members`. Every tool query appends `.eq('household_id', hh)`. Rate limit 60 req/min per user (Cloudflare KV counter).

### 7.2 Loop
```
system = persona + household profile + capacity/today snapshot (≈600 tok)
       + memories (§4.3, ≈1500 tok) + tool-use rules
messages = last 20 turns of the thread (from ai_messages) + new message
repeat ≤ 8 times:
  resp = anthropic.messages.create({ model: env.MODEL, tools, stream:true })
  if stop_reason == 'tool_use': run each tool → append tool_result; continue
  else break
persist assistant turn + tool calls to ai_messages; write activity_log per mutation
```
Model id is an env var so it can be bumped without redeploy of the app.

### 7.3 Tools (JSON-schema, all household-scoped)
Read: `search_everything(q)`, `get_today(date)`, `list_tasks(filter)`, `get_calendar(from,to)`, `find_open_time(duration_min, from, to, prefer)`, `list_projects()`, `get_project(id)`, `list_maintenance(status)`, `list_plants()`, `get_pet_history(pet, kind, days)`, `search_memory(q, subject)`, `search_history(q, days)`, `get_weather(days)`.
Write: `create_task`, `update_task`, `complete_task`, `postpone_task(id, to)`, `delete_task`†, `create_event`, `move_event`, `create_work_block(task_id, start, end)`, `set_day_mode(date_range, mode, note)` → runs §6, `replan_day/replan_week`, `update_project_step(id, status|note)`, `add_project_step`, `add_project_cost`, `record_maintenance(rule_id, done_at, note)` → logs + recomputes `next_due` + closes/creates the task, `log_plant_observation`, `log_pet_activity`, `log_routine(routine_id, detail)`, `add_list_item`, `create_note`, `link(from, to, rel)`, `save_memory`, `update_memory`, `forget_memory`†, `bulk_update`†.
† = returns a **proposal** instead of executing; the client shows a confirm card. Everything else executes immediately (spec §3: "act instead of forcing forms"; confirmation only for destructive/bulk).

### 7.4 Client side of the AI
- **Ask HomeBase bar** persistent on every screen (bottom on phone, header on iPad/desktop, large on Wall). `/` focuses it on desktop. Voice via Web Speech API where available (Safari iOS supports `webkitSpeechRecognition` in a user gesture).
- Full thread view slides up; streaming text; tool events render as inline status lines; results as action cards with Undo (uses `activity_log.before`).
- Quick chips are generated from Needs Attention, not hard-coded.

---

## 8. UI / UX plan

**Information architecture:** Today (home) · Tasks · Home · Projects · Calendar · Ask (everywhere) · Settings (people, capacity, What HomeBase Knows, wall PIN, connections).

**Breakpoints & layout**
| Width | Nav | Layout |
|---|---|---|
| < 768 (iPhone) | bottom tab bar + Ask bar above it | single column, sheets for editors, swipe actions |
| 768–1180 (iPad portrait/landscape) | left rail (icons + labels) | two-pane: list + detail; Ask bar in header |
| > 1180 (Windows/Mac) | left rail | three-pane where useful (Projects: list · detail · costs), keyboard shortcuts (`n` new task, `/` ask, `1–5` tabs) |
| `?wall=1` | none | landscape Day view (time, Today, Needs Attention, Projects, Tomorrow, big Ask) ↔ Week view by swipe; 24 px base type; auto-dim 23:00–06:00; PIN lock |

**Smoothness rules (the actual mechanics)**
- Per-view render functions keyed by table; store change → only dependent views re-render; list rows re-rendered by `id` diff (keep DOM nodes, update text) so swipes/scroll survive.
- `100dvh`, `env(safe-area-inset-*)`, `overscroll-behavior: contain` on sheets, `touch-action: pan-y` on rows, inputs ≥ 16 px (no iOS zoom), `-webkit-tap-highlight-color` cleared, `will-change: transform` on sheets only while open.
- All animations ≤ 250 ms, `prefers-reduced-motion` respected.
- PWA: `display: standalone`, `apple-touch-icon`, `theme-color` per theme, service worker precache of the shell; first paint from cache, data from Supabase.
- Light + dark theme via `prefers-color-scheme`, tokens on `:root`; same teal accent; type: Fraunces (headings) / DM Sans (UI), loaded from Google Fonts with `font-display: swap` and a system fallback so the wall iPad never shows blank text offline.
- Progressive disclosure: task row = title + one context line ("Sat · Nursery"); tap → sheet with everything.
- Accessibility: 44 px targets, focus rings on desktop, `aria-live` for toasts and AI status.

**Testing:** Playwright (already in this sandbox) against the built file at 390×844, 820×1180, 1366×768 and `?wall=1` 1180×820, with a mocked Supabase; screenshot review of every screen before each phase ships.

---

## 9. Initial real data (spec §7)

Seeded by `003_seed_household.sql` on first run (idempotent, skips if the household exists):

- **People:** Luke, Hayley. **Pet:** Ruby (dog).
- **Areas:** rooms carried over from v17 folders + Nursery, Patio/Yard; life: Family, Errands, Pets, **Relationship**.
- **Projects:** Nursery (priority 1, stage from you); Paver Patio + French Drain (priority 2) with phases → steps and `depends_on`: excavation → drainage planning → French drain → downspout connections → grading → base prep → compaction → pavers → edging → gravel/landscaping → finish.
- **Routines:** Ruby training (daily, min_version "3-minute session"), household reset (daily, min "kitchen only"), flowers (weekly, nudge Thu/Fri), mow (weekly Sat|Sun chosen by planner), trash (Wed 20:00, backup check Thu 08:00), hydroponics check (every 3 d to start, adaptive), outdoor plant check (adaptive), date night (monthly).
- **Maintenance rules:** house HVAC filter (90 d), indoor air purifier filter (interval from the unit's spec once captured), AC condensate drain (30 d during cooling season). Others only after equipment onboarding.
- **Backlog (nice):** tidy garage, go through old boxes, sort/donate/discard, organise kept items.
- **Migration `004_migrate_v17.sql`:** old `tasks` → `tasks` (cat → area_id, pri High→must / Medium→should / Low→nice, repeat string → recurrence JSON), `maintenance` → `maintenance_rules` (+ one `maintenance_log` row if a past date exists), `equipment` → `assets`, `notes` → `notes(vendor=true when body has a phone)`, `projects.steps/bom` → `project_steps`/`project_costs`, `events` → `events`, `folders` → `areas`. Old tables are renamed `v17_*`, not dropped (archive, never delete).

---

## 10. Phases, deliverables, acceptance

### Phase 1 — Foundation + Today + AI with memory
1. Supabase: migrations 001–004, Auth enabled, RLS on, Storage bucket. Luke + Hayley users created.
2. Worker: `/chat` with streaming, JWT verification, full tool set of §7.3 except replanning, `/learn` job, `/plan` job, `/confirm`.
3. App: new store/render core; Auth screen (magic link); Today (Must Do / Today / Needs Attention / Projects / Coming Up / Ask); Tasks (lists by area, sheets); Projects (steps with dependencies, costs, computed progress); Calendar (month/week/day with fixed events, deadlines, work blocks); Home (assets, maintenance rules + log, notes/vendors); Settings incl. **What HomeBase Knows**; responsive shell for phone/iPad/desktop; PWA manifest + SW.
4. Seed + migrate real data.

*Acceptance:* "I changed the HVAC filter" → maintenance_log row, `next_due` = today + interval, old task closed, next task created, one reply sentence. "What do I need to do today?" answers from live data. Date rolls over correctly at local midnight (test at 19:30 CDT). Hayley can log in and sees the same household. Screens verified at the four viewports. Old v17 data present in new views.

### Phase 2 — Replanning, Weekly Reset, Wall
Day modes + §6 engine (`set_day_mode`, sick/travel/busy/project/vacation); Weekly Reset (Sunday view + AI narrative: done, missed, project progress, upcoming, stalled, proposed blocks); `?wall=1` Day/Week views with PIN and auto-dim; offline write queue; web push for the few Must-Do reminders (iOS Home-Screen PWA).

*Acceptance:* "I'm traveling Tue–Thu" produces a plan with nothing home-bound on those days and no Friday pile-up (max-per-day rule verified). Wall view readable at 8 ft (type ≥ 24 px, contrast ≥ 7:1).

### Phase 3 — Home capture, plants, Ruby, history
Room-by-room capture flow (photos → Storage, nameplate OCR via the model's vision through the Worker), assets with consumables ("what filter does the purifier take?"), plants + hydroponics logging with photo timeline, Ruby training history and "skills not practiced lately", universal search across everything incl. history, optional Google Calendar import through the Worker (OAuth stays server-side).

---

## 11. Open questions for Luke (answer whenever — none block starting Phase 1 planning)

1. Is the Supabase project already live with your real data, or still the demo seed? (Determines whether migration 004 matters.)
2. Current Cloudflare Worker URL and whether you're fine with me replacing its code entirely.
3. Should Hayley get her own login in Phase 1?
4. Nursery: current stage and next action, so the seed is accurate.
5. Wall iPad: model/size and whether it's landscape-mounted (assumed yes).
6. Hydroponics: how many crops/units, and do you measure pH/EC now?
7. Anything in v17 you actively like and want kept as-is (visuals, the room presets, the summary charts)?

---

## 12. Next step

When the GitHub connector is attached (or the repo folder is linked from the laptop), Phase 1 begins in this order: schema + RLS → Worker → app core → Today → remaining views → seed/migrate → viewport tests. Each step lands as its own commit on a `v2` branch; `main` (GitHub Pages) is untouched until Phase 1 acceptance passes.