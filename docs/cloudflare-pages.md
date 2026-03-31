# Cloudflare Pages Setup

Use this path when you want the always-free browser-first deployment:

- Cloudflare Pages serves the frontend
- Supabase stores auth, collections, environments, settings, and history
- requests run from the end user's browser when the target API allows it
- proxy and AI features stay disabled in this static deployment

## Cloudflare Pages

Create a Pages project from the private GitHub repo and use:

- Framework preset: `None`
- Build command: `./scripts/build-pages.sh`
- Build output directory: `frontend`

## Pages Environment Variables

Add these in Cloudflare Pages:

```text
POSTFREELY_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
POSTFREELY_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
POSTFREELY_PUBLIC_URL=https://YOUR_PROJECT.pages.dev
POSTFREELY_ENABLE_GOOGLE_AUTH=true
POSTFREELY_ENABLE_PASSWORD_AUTH=false
```

## Important

Do not put these in Cloudflare Pages:

- `SUPABASE_SERVICE_ROLE_KEY`
- Google client secret

Those are server-side secrets and should not be exposed in a static frontend deployment.

## Supabase

Run `docs/supabase_schema.sql` in the Supabase SQL editor first.

Then in Supabase Auth:

- set Site URL to your Pages URL
- add redirect URL `https://YOUR_PROJECT.pages.dev/auth/callback.html`
- enable Google provider
- if you are staying Google-only for now, disable Email in the Supabase Auth providers list

## Result

After deploy, your production app URL is:

```text
https://YOUR_PROJECT.pages.dev
```
