# HomeBase v2 — status

_Updated Sep 19, 2026_

## Where things are

- **Branch `v2`** in the local clone holds Phase 1 (2 commits on top of `main`). `main` (GitHub Pages) is untouched and still serves v17.
- Push from the Cowork session failed: the git proxy only injects credentials for repositories in the session's authorized source set, and the GitHub sync was added to the project after this session started. A **new session in the HomeBase project** should be able to push `v2`; otherwise upload `homebase-v2-phase1.zip` through the GitHub web UI onto a `v2` branch.

## Phase 1 — built, verified in demo mode at 390×844, 820×1180, 1180×820, 1366×768

| Area | State |
|---|---|
| `supabase/migrations/001–003` | written; **not yet run** against Luke's project |
| `worker/` | written; smoke tests pass; mocked end-to-end run of all 38 tools; **not yet deployed** |
| `index.html` app | Today, Tasks, Home, Projects, Calendar, Settings + What HomeBase Knows, Ask bar + AI panel (SSE), Wall (`?wall=1`), PWA; demo mode (`?demo=1`) |
| Real-data test | pending — needs migrations run + Worker deployed + Luke's sign-in |

## Next steps (in order)

1. Get `v2` pushed (new session, or web upload).
2. Luke: run the three migrations in Supabase SQL editor; enable Email auth.
3. Luke: `cd worker && wrangler login && wrangler secret put ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY && wrangler deploy`.
4. Open the v2 site (GitHub Pages can serve the `v2` branch via Settings → Pages, or merge to `main` after acceptance), sign up, **Create household**, paste Worker URL.
5. Acceptance run from the build plan §10: "I changed the HVAC filter", "what do I need to do today?", date rollover after 7 pm, Hayley joins by invite code.
6. Then merge `v2 → main`.

## Known gaps / Phase 2 candidates

- Weekly Reset view and web push not built yet (Phase 2 per plan).
- Offline write queue not built (reads work offline via service worker cache; writes need a connection).
- Wall PIN is a display lock only (by design).
- Custom recurrence picker uses two `prompt()` dialogs — replace with a proper sheet.
- Photos/Storage uploads (Phase 3).