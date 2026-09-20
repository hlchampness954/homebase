# HomeBase v2 — status

_Updated Sep 20, 2026 (overnight build)_

## Live right now

| Piece | State |
|---|---|
| App | `https://hlchampness954.github.io/homebase/` — build 2.1.0-p2, SW `hb-v2-p2b` |
| Database | Supabase `whcybmydykhicergqokx`, migrations **001–005 applied**; Email auth on; Site URL set |
| Worker | `homebase-proxy.hlchampness.workers.dev`, auto-deployed by Cloudflare Workers Builds from `main` (root `worker/`) |
| Secrets | 4 Worker secrets set by Luke (Anthropic key, Supabase URL, publishable key, secret key) |
| Account | Luke signed up + household created (seeded: Ruby, Nursery, Patio, routines, rules, memories) |

## Done overnight (Sep 19 → 20)

- **AI reliability**: fixed the `thinking block must contain signature` 400 (Sonnet 5 thinking blocks now round-trip), added retries/backoff on 429/529, friendly error text, prompt caching (tools + static rules), `max_tokens` 4096, 12 tool iterations.
- **Web research**: Anthropic server-side `web_search` + `web_fetch` with New Braunfels location; sources shown under replies.
- **Full app control**: `create_project` (steps + costs in one call), `update_project`, generic `list_records / create_record / update_record / archive_record` over every table (archive needs confirmation).
- **Attachments (spec §1–10)**: paperclip / camera / files / drag-drop / paste in Ask HomeBase; private bucket upload with a client-side JPEG derivative; `files` extended + `file_links` (many-to-many); Worker resolver feeds images/PDFs/text to the model; tools `get_file / search_files / link_file / unlink_file / update_file_metadata / delete_file` (confirm); files card on project pages; Recent files on Home.
- **Person lens (spec §11–13)**: "View as" pill (Luke / Hayley / Household) with task scope Mine / Household / All; per-device default (`household_devices`); `task_assignments` synced with `assignee_id` by trigger; person-scoped memories; AI knows who is speaking ("remind me" = that person), `assign_task`, `get_person_context`, `get_household_overview`, `get_recent_changes`.
- **Chat rendering**: headings, lists, tables, links, code, sources; attachment chips.
- **Sign-in**: email is kept after a failed attempt; clearer Create-account guidance.
- CI workflow file written (`.github/workflows/verify-homebase.yml`) but **not committed** — GitHub's web editor refused workflow files; add it from a normal git push when convenient.

## Next

1. Luke: reload the app on each device (PWA updates on second open), pick the device's person under the pill → "This device…".
2. Acceptance run: receipt photo → Patio cost; rosemary photo question; "what's going on with the house?"; "give Hayley the crib sheets task"; research + `create_project`.
3. Phase 2 leftovers: Weekly Reset view, web push, offline write queue, proper recurrence picker, Hayley's device set-up.
