# HomeBase v2 — status

_Updated Sep 19, 2026_

## Where things are

- **Phase 1 is now committed to `main`** in `hlchampness954/homebase`. GitHub Pages should use the v2 root `index.html`.
- The previous v17 app is preserved at `docs/index.v17.html`.
- The repository now contains the split source files, shared planner/recurrence logic, PWA assets, Supabase migrations, and AI Worker source/tests.

## Phase 1 — built, verified in demo mode at 390×844, 820×1180, 1180×820, 1366×768

| Area | State |
|---|---|
| GitHub repository | **pushed to `main` and verified** |
| `supabase/migrations/001–003` | written; **not yet run** against Luke's project |
| `worker/` | written; smoke tests pass; mocked end-to-end run of all 38 tools; **not yet deployed** |
| `index.html` app | Today, Tasks, Home, Projects, Calendar, Settings + What HomeBase Knows, Ask bar + AI panel (SSE), Wall (`?wall=1`), PWA; demo mode (`?demo=1`) |
| Real-data test | pending — needs migrations run + Worker deployed + Luke's sign-in |

## Next steps (in order)

1. Run the three migrations in the Supabase SQL editor; enable Email auth.
2. Deploy the Worker: `cd worker && wrangler login && wrangler secret put ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY && wrangler deploy`.
3. Open the HomeBase site, sign up, **Create household**, and paste the Worker URL under Settings → App & connections.
4. Run the acceptance checks from the build plan §10: "I changed the HVAC filter", "what do I need to do today?", date rollover after 7 pm, and Hayley joins by invite code.
5. After the real-data acceptance run, continue with Phase 2 items below.

## Known gaps / Phase 2 candidates

- Weekly Reset view and web push not built yet (Phase 2 per plan).
- Offline write queue not built (reads work offline via service worker cache; writes need a connection).
- Wall PIN is a display lock only (by design).
- Custom recurrence picker uses two `prompt()` dialogs — replace with a proper sheet.
- Photos/Storage uploads (Phase 3).
