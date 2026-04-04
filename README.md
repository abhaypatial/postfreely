# PostFreely

PostFreely is a fast API workspace with a browser-first runner, local-first development flow, and optional cloud mode for shared access.

## Highlights

- Browser-first request execution for CORS-compatible APIs
- Proxy fallback for APIs that cannot be called directly from the browser
- Collection runner with parallel iterations
- Collection variables and environment variables with `{{variable}}` interpolation
- Saved collections, environments, history, and AI-assisted request workflows
- Supabase-ready auth and cloud persistence path
- Docker and health-check support for hosted deployments

## Quick Start

Run locally with Python:

```bash
python backend/core/server.py
```

Then open:

```text
http://localhost:5000
```

## Cloud Notes

- `.env` is auto-loaded by `backend/core/server.py`
- `docker-compose.yml` includes a `/healthz` health check
- outbound HTTPS certificate verification is enabled by default
- shared/public deployments should use Supabase-backed cloud mode
- browser-first execution is the best fit for always-free hosting goals

## Structure

```text
postfreely/
|-- backend/
|   |-- api/
|   |-- core/
|   |-- db/
|   `-- utils/
|-- config/
|-- docs/
|-- frontend/
|   |-- assets/
|   |-- index.html
|   `-- pages/
|-- scripts/
|-- .env.example
|-- docker-compose.yml
|-- Dockerfile
`-- README.md
```

## Local Testing

The app can be started with a plain Python runtime and does not require a Node build step for local use.

Useful endpoints:

- `/healthz`
- `/api/public/config`
- `/runner` or `/runner/`

## Hosting Direction

Recommended free-first architecture:

- Cloudflare Pages for the frontend
- Supabase for auth and user data
- Browser-first runner execution from the end user's machine
- Optional proxy/server mode only where direct browser access is blocked

Cloudflare Pages build details live in [docs/cloudflare-pages.md](docs/cloudflare-pages.md).
Supabase email confirmation and custom email branding notes live in [docs/supabase-auth-email.md](docs/supabase-auth-email.md).

## License

MIT. See [LICENSE](LICENSE).
