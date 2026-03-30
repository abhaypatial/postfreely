# PostFreely Cloud Deploy

## Recommended free stack

- Oracle Cloud Always Free `VM.Standard.A1.Flex` VM for the app and runner
- Supabase for auth and saved user data
- DuckDNS for a free hostname
- Caddy for automatic HTTPS

If you already own a domain, you can replace DuckDNS with Cloudflare DNS/proxy and keep the same VM + Caddy setup.

This app now supports both local-file mode and cloud mode. For real public use, use cloud mode so user collections, environments, history, settings, and AI context are saved per account.

## Do I need a domain?

No, not to test.

You can test on:

```text
http://YOUR_PUBLIC_IP:5000
```

But for a real public launch, you should use a hostname. A paid domain is not required. A free DuckDNS subdomain is enough.

Use a public hostname if you want:

- trusted HTTPS in the browser
- Google sign-in
- a stable app URL for users

## 0 to 100 deployment steps

### 1. Create an Oracle Cloud VM

Use these choices:

- Shape: `VM.Standard.A1.Flex`
- OCPUs: `2`
- Memory: `12 GB`
- Image: `Ubuntu`
- Public IP: `Yes`
- Boot volume: default is fine

Notes:

- Always Free compute must be created in your tenancy home region
- If Oracle says there is no capacity, try another availability domain in the same region

### 2. Open the VM firewall

In Oracle Cloud security rules, allow:

- TCP `22` from your IP only
- TCP `80` from `0.0.0.0/0`
- TCP `443` from `0.0.0.0/0`

### 3. Connect from Windows

Use the SSH private key Oracle gave you when you created the instance:

```powershell
ssh -i C:\path\to\oracle-key.key ubuntu@YOUR_PUBLIC_IP
```

If Oracle gave you a different default username, use that instead.

### 4. Install Docker and Compose on the VM

Run:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

### 5. Get a free hostname

Create a free DuckDNS hostname, for example:

```text
postfreely-demo.duckdns.org
```

Point it to your Oracle public IP.

### 6. Create a Supabase project

1. Create a project in Supabase.
2. Open the SQL editor.
3. Run [supabase_schema.sql](/C:/Users/AbhayPatial/OneDrive%20-%20Volante%20Software%20Inc/Desktop/pythonproj/PostFreely/docs/supabase_schema.sql).

This creates the tables used for:

- users/profiles
- collections
- environments
- history
- saved settings

### 7. Configure Supabase Auth

#### Email/password

Email/password already works in the app.

While testing, either:

- leave email signups without confirmation if you want quick testing
- or configure SMTP before public launch

#### Google sign-in

Enable Google in Supabase Auth providers.

Set your app URL values to your final hostname:

- Site URL: `https://YOUR-DUCKDNS-SUBDOMAIN.duckdns.org`
- Redirect URL: `https://YOUR-DUCKDNS-SUBDOMAIN.duckdns.org/auth/callback.html`

In Google Cloud, create OAuth credentials and use the callback URL Supabase shows you inside its Google provider setup.

### 8. Get your Supabase keys

You need:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the service role key secret.

### 9. Upload the PostFreely project to the VM

From your Windows machine:

```powershell
scp -i C:\path\to\oracle-key.key -r "C:\Users\AbhayPatial\OneDrive - Volante Software Inc\Desktop\pythonproj\PostFreely" ubuntu@YOUR_PUBLIC_IP:~/
```

Then SSH in and go to the project:

```bash
cd ~/PostFreely
```

### 10. Create the production env file

Copy the template:

```bash
cp .env.example .env
```

Edit it:

```bash
nano .env
```

Set at least these values:

```text
HOST=0.0.0.0
PORT=5000
POSTFREELY_DATA_DIR=./data
POSTFREELY_DEFAULT_TIMEOUT_SECONDS=30
POSTFREELY_DEFAULT_RUNNER_PARALLEL=4
POSTFREELY_MAX_HISTORY_ENTRIES=200
POSTFREELY_INSECURE_SSL=0
POSTFREELY_ENABLE_GOOGLE_AUTH=1
POSTFREELY_PUBLIC_URL=https://YOUR-DUCKDNS-SUBDOMAIN.duckdns.org
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
POSTFREELY_ADMIN_EMAILS=abhay.patial13@gmail.com
```

If you want admin access to all user workspaces, make sure your email is included in `POSTFREELY_ADMIN_EMAILS`.

### 11. Create the Caddy config

Copy the example:

```bash
cp Caddyfile.example Caddyfile
```

Edit it:

```bash
nano Caddyfile
```

Replace the example hostname with your DuckDNS hostname:

```text
YOUR-DUCKDNS-SUBDOMAIN.duckdns.org {
  encode gzip zstd
  reverse_proxy postfreely:5000
}
```

### 12. Start the app

Run:

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs -f
```

Health check:

```text
https://YOUR-DUCKDNS-SUBDOMAIN.duckdns.org/healthz
```

### 13. Verify the deployment

Open:

```text
https://YOUR-DUCKDNS-SUBDOMAIN.duckdns.org
```

Test this checklist:

1. The sign-in screen opens.
2. Email/password sign-in works.
3. Google sign-in works if enabled.
4. Create a collection and refresh the page.
5. The collection is still there.
6. Create an environment and refresh the page.
7. The environment is still there.
8. Run a request and confirm history saves.
9. Open the runner and test a small collection run.

### 14. Pick fast runner defaults

The runner has a `Parallel` control now. Start here:

- `Parallel = 4` for most APIs
- `Parallel = 2` for strict rate-limited APIs
- `Parallel = 6` only if iterations are independent and the target API can take the load

Inside one iteration, requests still stay in order. Parallelism is across iterations.

### 15. Restart after changes

Whenever you change env vars or the Caddy config:

```bash
docker compose up -d --build
```

## Quick no-domain test path

If you only want to smoke-test the server without DuckDNS, you can run:

```bash
docker build -t postfreely .
docker run --env-file .env -p 5000:5000 postfreely
```

Then open:

```text
http://YOUR_PUBLIC_IP:5000
```

Use this only for testing. Do not use this path for Google sign-in or a real public rollout.

## Admin workspace switching

If your email is listed in `POSTFREELY_ADMIN_EMAILS`, the top bar shows a `Workspace` switcher.

That lets you:

- view another user's collections
- view another user's environments
- run another user's collections

Your own theme and AI settings stay personal.

## Files already prepared in this repo

- [.env.example](/C:/Users/AbhayPatial/OneDrive%20-%20Volante%20Software%20Inc/Desktop/pythonproj/PostFreely/.env.example)
- [Dockerfile](/C:/Users/AbhayPatial/OneDrive%20-%20Volante%20Software%20Inc/Desktop/pythonproj/PostFreely/Dockerfile)
- [docker-compose.yml](/C:/Users/AbhayPatial/OneDrive%20-%20Volante%20Software%20Inc/Desktop/pythonproj/PostFreely/docker-compose.yml)
- [Caddyfile.example](/C:/Users/AbhayPatial/OneDrive%20-%20Volante%20Software%20Inc/Desktop/pythonproj/PostFreely/Caddyfile.example)
- [supabase_schema.sql](/C:/Users/AbhayPatial/OneDrive%20-%20Volante%20Software%20Inc/Desktop/pythonproj/PostFreely/docs/supabase_schema.sql)

## If something fails

Start with:

```bash
docker compose logs -f
```

Then check:

- DuckDNS points to the correct public IP
- Oracle security list allows `80` and `443`
- `.env` values are correct
- `POSTFREELY_PUBLIC_URL` exactly matches the browser URL you open
- Supabase redirect URL exactly matches `/auth/callback.html`
