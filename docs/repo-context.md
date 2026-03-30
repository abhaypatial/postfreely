# PostFreely Repo Context

This file is the compact architecture map for the current codebase. It is meant to reduce repeated full-repo reads and give future work a stable starting point.

## Product Summary

PostFreely is a zero-build API client and collection runner:

- frontend: static HTML/CSS/vanilla JS served by the Python backend
- backend: Python `http.server` app with route dispatch in `backend/core/router.py`
- request execution: server-side proxy in `backend/api/api_proxy.py` avoids browser CORS limits
- persistence modes:
  - local mode: JSON files under `data/`
  - cloud mode: Supabase Auth + Supabase Postgres through `backend/db/db_cloud.py`

## Runtime Shape

Startup path:

1. `backend/core/server.py`
2. loads `.env` if present
3. seeds local data via `backend/db/db_init.py`
4. starts `ThreadingHTTPServer`
5. routes API calls or serves static frontend files

Important runtime endpoints:

- `/` -> `frontend/index.html`
- `/runner` -> `frontend/pages/runner.html`
- `/healthz` -> basic deployment health check
- `/api/*` -> routed backend handlers

## Source Map

### Backend

- `backend/core/server.py`: app entry point, `.env` bootstrap, server start
- `backend/core/router.py`: HTTP router, static file serving, health endpoint
- `backend/api/api_proxy.py`: outbound HTTP requests, auth/header/body handling, history writes
- `backend/api/api_runner.py`: in-memory concurrent collection runner with stop/poll support
- `backend/api/api_users.py`: local auth fallback or Supabase auth bridge
- `backend/api/api_collections.py`: collection CRUD and import flow
- `backend/api/api_environments.py`: environment CRUD and active environment switching
- `backend/api/api_settings.py`: per-user UI/runtime settings
- `backend/api/api_history.py`: request history read/clear
- `backend/api/api_public.py`: frontend bootstrap config
- `backend/api/api_admin.py`: admin user listing for workspace switching
- `backend/api/api_ai.py`: AI chat/analyze/generate/fix features

### Data Layer

- `backend/db/db_init.py`: local file paths, seeds, default settings
- `backend/db/db_misc.py`: history/settings/user helpers
- `backend/db/db_collections.py`: collection persistence and import helpers
- `backend/db/db_environments.py`: environment persistence helpers
- `backend/db/db_access.py`: actor/owner/admin context resolution
- `backend/db/db_cloud.py`: Supabase REST/Auth integration

### Frontend

- `frontend/index.html`: main app shell and modals
- `frontend/pages/runner.html`: collection runner UI and polling logic
- `frontend/assets/js/core/api.js`: shared API client, auth session storage, admin scope
- `frontend/assets/js/core/state.js`: global client-side app state
- `frontend/assets/js/app.js`: main boot flow, workspace hydration, request UI
- `frontend/assets/js/modules/modals.js`: auth, import, environment, save, AI, theme modals
- `frontend/assets/css/main.css`: full UI theme system
- `frontend/auth/callback.html`: Supabase redirect/session restore page

### Deployment and Config

- `Dockerfile`: single-container Python app image
- `docker-compose.yml`: app + Caddy reverse proxy
- `Caddyfile.example`: HTTPS reverse proxy template
- `.env.example`: deploy-time environment template
- `docs/cloud-deploy.md`: free-tier deployment runbook
- `docs/supabase_schema.sql`: database schema for cloud mode

## Persistence Model

### Local Mode

- uses JSON files in `data/`
- best for single-machine use
- no shared multi-user persistence

### Cloud Mode

Enabled when these exist:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Cloud mode provides:

- email/password sign-in
- Google sign-in through Supabase
- per-user collections
- per-user environments
- per-user history
- per-user UI settings
- admin workspace switching using `POSTFREELY_ADMIN_EMAILS`

## Hosting Recommendation

Best fully-free practical path for this exact architecture:

- Oracle Cloud Always Free VM for the Python app and runner
- Supabase free tier for auth + saved user data
- Caddy for HTTPS
- DuckDNS for a free hostname

Cloudflare is still useful if you already own a domain:

- use Cloudflare DNS/proxy in front of the VM
- keep Caddy on the VM for origin HTTPS

Cloudflare Pages/Workers alone are not a clean fit for the current backend because the app relies on:

- long-running Python server behavior
- in-memory runner polling state
- arbitrary outbound HTTP proxying

## Performance Notes

- runner parallelism already exists and is user-configurable
- default runner parallelism comes from settings and now supports env-based defaults
- this app is single-process and single-node by design
- runner snapshots are in memory, so horizontal scaling is not currently a target architecture

## Security Notes

- outbound HTTPS certificate verification is now enabled by default
- `POSTFREELY_INSECURE_SSL=1` should be used only for self-signed local testing
- Supabase service-role key must stay server-side only
- public shared deployment should always use cloud mode, not JSON-file mode

## Known Architectural Limits

- no real background queue for runner jobs
- runner state disappears on process restart
- no persistent storage for open browser tabs/workbench state beyond local browser storage
- no automated tests in repo yet
- Python standard library server is fine for a small free-tier deployment, but not the long-term scale architecture

## Recommended Next Steps

1. Create Supabase project and run `docs/supabase_schema.sql`
2. Configure Google provider in Supabase Auth
3. Deploy the repo on a free Oracle VM with Docker Compose
4. Point DuckDNS or Cloudflare-managed DNS to the VM
5. Validate `/healthz`, sign-in, persistence, and runner behavior
