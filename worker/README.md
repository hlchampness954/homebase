# HomeBase AI Worker (`homebase-ai`)

The server side of HomeBase v2: a single Cloudflare Worker that verifies the user's Supabase session, talks to Postgres through PostgREST with the service-role key (always scoped to the caller's household), runs the deterministic planner from `../shared`, and drives Claude's tool-use loop over Server-Sent Events.

No npm dependencies. `src/index.js` imports `../../shared/{dates,recurrence,planner}.js` directly, so the browser and the Worker share the same planning code; `wrangler` bundles them at deploy time.

```
worker/
  wrangler.toml      name, cron, vars, optional KV binding
  src/index.js       the whole Worker
  test/smoke.mjs     offline test of the pure helpers
```

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | `{ok:true, model}` |
| `POST /chat` | JWT | `{thread_id?, message, context:{view,date,device,now}}` → SSE stream (see below) |
| `POST /confirm` | JWT | `{proposal_id}` executes a confirm-required tool → `{ok, action, actions, result}` |
| `POST /undo` | JWT | the `undo` descriptor from an `action` event → reverses that one change |
| `POST /plan` | JWT | `{date?}` runs the planner and writes `scheduled_start/end` on chosen tasks → plan JSON |
| `POST /learn` | JWT | runs the nightly pattern job for the caller's household → summary |

Cron (UTC): `30 10 * * *` → `/plan` for every household (05:30 CDT), `30 4 * * *` → `/learn` (23:30 CDT). In CST both land an hour earlier, which is fine.

Auth: `Authorization: Bearer <supabase user JWT>`. The Worker calls `GET /auth/v1/user` with the anon key, then looks up `household_members` with the service key. A user in several households can pick one with `X-Household-Id`.

## Deploy

```bash
npm i -g wrangler
cd worker
wrangler login

wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SUPABASE_URL                # https://<ref>.supabase.co
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

wrangler deploy
```

`wrangler deploy` prints the Worker URL (`https://homebase-ai.<account>.workers.dev`). Change the model without touching the app by editing `MODEL` in `wrangler.toml` and redeploying, or `wrangler deploy --var MODEL:claude-…`.

### Optional KV (rate limit, weather cache, proposals)

```bash
wrangler kv namespace create RATE
# paste the id into wrangler.toml under [[kv_namespaces]] and redeploy
```

Without the binding the Worker still works: rate limiting is skipped, the Open-Meteo forecast is cached per isolate for an hour, and proposals (delete / forget / bulk update cards) are held in memory for 10 minutes. The in-memory store lives inside one Worker isolate, so a confirm that lands on a different isolate (rare for a single household, more likely after a deploy or idle period) returns `404 Proposal not found or expired` and the user simply asks again. Bind KV to make proposals durable.

## Point the app at the Worker

In the app's Settings → Connections (or the constant near the top of `index.html`) set the AI endpoint to the Worker URL. The page sends `fetch(WORKER_URL + '/chat', { headers: { Authorization: 'Bearer ' + session.access_token } })` and reads the SSE stream. `ALLOWED_ORIGIN` in `wrangler.toml` must match the page origin (`https://hlchampness954.github.io`); `http://localhost:*` and `http://127.0.0.1:*` are always allowed for development.

## SSE contract (`POST /chat`)

Each frame is `event: <type>\ndata: <json>\n\n`.

| event | data | when |
|---|---|---|
| `thread` | `{thread_id}` | first, so the client can keep the conversation |
| `text` | `{delta}` | streamed assistant text |
| `tool` | `{name, status:'start'|'done', summary}` | around each tool call ("Logging maintenance · HVAC filter…") |
| `action` | `{id, at, summary, entity_type, entity_id, action, reason, undo}` | every executed mutation (also logged to `activity_log` with `actor='ai'`) |
| `proposal` | `{id, summary, tool, input}` | a confirm-required tool was requested; show a card, then `POST /confirm` |
| `done` | `{thread_id, usage, actions[], proposals[]}` | end of turn |
| `error` | `{message}` | fatal error; the stream closes after it |

`undo` shapes the client can apply directly with supabase-js: `{op:'delete', table, id}`, `{op:'update', table, id, patch}`, `{op:'bulk_update', table, rows:[{id, patch}]}`, `{op:'restore_day_modes', dates, rows}`; an optional `also` carries a second step (e.g. deleting a `routine_log` row and restoring `routines.last_done_at`).

## Test with curl

```bash
W=https://homebase-ai.<account>.workers.dev
curl -s $W/health
# → {"ok":true,"model":"claude-sonnet-5","time":"…"}

# A user JWT: in the app's devtools, `(await supabase.auth.getSession()).data.session.access_token`
JWT=eyJ…

curl -N -s $W/chat \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -H "Origin: http://localhost:8080" \
  -d '{"message":"What do I need to do today?","context":{"view":"today","device":"curl"}}'

curl -s $W/plan  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{}'
curl -s $W/learn -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{}'
curl -s $W/confirm -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"proposal_id":"<id from a proposal event>"}'

# local dev
wrangler dev            # then use http://localhost:8787 as $W
wrangler tail           # live logs of the deployed Worker
```

Offline smoke test (no network, no secrets):

```bash
node worker/test/smoke.mjs
```

## Tools the model can call

Read: `search_everything`, `get_today`, `list_tasks`, `get_calendar`, `find_open_time`, `list_projects`, `get_project`, `list_maintenance`, `list_plants`, `get_pet_history`, `search_memory`, `search_history`, `get_weather`.

Write (execute immediately, each emits an `action`): `create_task`, `update_task`, `complete_task`, `postpone_task`, `create_event`, `move_event`, `create_work_block`, `set_day_mode` (writes `day_modes`, runs `planner.replan`, applies moves with `activity_log.reason='replan:<mode>'`; `mode:'normal'` clears the mode and restores untouched moved tasks), `replan_day`, `replan_week`, `update_project_step`, `add_project_step`, `add_project_cost`, `record_maintenance`, `log_plant_observation`, `log_pet_activity`, `log_routine`, `add_list_item`, `create_note`, `link`, `save_memory`, `update_memory`.

Proposal only (need `/confirm`): `delete_task` (sets `status='cancelled'`, reversible), `forget_memory` (sets `status='rejected'`), `bulk_update`.

Names are resolved leniently: "the HVAC filter rule" finds `maintenance_rules.name = 'HVAC filter (house)'`; if several rows match, the tool returns the candidates and the model asks.

## Nightly learning (`/learn`)

Per household, from the last 120 days:

- usual weekday per task series / routine (last 12 completions, n ≥ 4, share ≥ 0.6) and postpone tendency (≥ 50 % over ≥ 4) → one `pattern` memory per entity, `data.usual_day` read by the planner;
- realistic duration (trimmed median of `actual_min` vs estimate, n ≥ 3, diff > 25 %) → `stat` memory and the estimate is updated on open instances / `routines.default_min`;
- weekend capacity (median minutes completed on active Sat/Sun days over the last 6 weekends) → `households.settings.learned_weekend_capacity` + `stat` memory;
- real maintenance intervals (median gap in `maintenance_log`, ≥ 2 gaps) → `stat` memory flagged `needs_confirmation`, the rule is not changed;
- plant watering interval (median gap between `water`/`topoff` observations, ≥ 3 gaps) → `plants.water_interval_days` + `stat` memory.

Observed memories are upserted by `(entity_type, entity_id, kind)`, so re-runs update `content / confidence / evidence_count` instead of duplicating.