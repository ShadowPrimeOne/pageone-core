# SearXNG Docker VM Setup (instance-20250807-174459)

Last updated: 2025-08-20

This document captures the exact SearXNG setup on the VM for reproducibility and future maintenance. Update this file whenever the setup changes.

## Current facts (verified from Docker)

- Container name: `searxng`
- Image: `searxng/searxng:latest`
- Version (env): `SEARXNG_VERSION=2025.8.7-4942c9b`
- Config mount (host → container):
  - Host: `/home/shadow_prime_one/searxng/conf3`
  - Container: `/etc/searxng` (read-write)
- Cache volume: `/var/cache/searxng` (Docker named volume)
- Key env vars inside container:
  - `CONFIG_PATH=/etc/searxng`
  - `SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml`
  - `BASE_URL=http://localhost:8080/`
  - `GRANIAN_PORT=8080` (app listens on 8080 inside the container)

### Container orchestration

- No Docker Compose labels detected on container (`com.docker.compose.*` absent). Likely started via a one-off `docker run` (possibly with a restart policy) or a custom systemd unit.
- Restart policy: `unless-stopped` (container auto-restarts unless explicitly stopped)
- Launch entrypoint: `/usr/local/searxng/entrypoint.sh`
- Port binding (Host → Container): `0.0.0.0:8080 -> 8080/tcp` and `[::]:8080 -> 8080/tcp`
- Binds/Mounts:
  - Bind: `/home/shadow_prime_one/searxng/conf3:/etc/searxng` (rw)
  - Volume: `/var/cache/searxng` (Docker local volume)

### Port mapping (confirmed)

From `docker port searxng`:

- `8080/tcp -> 0.0.0.0:8080`
- `8080/tcp -> [::]:8080`

This means the container's port 8080 is exposed publicly on the host on port 8080 (IPv4 and IPv6). A reverse proxy may or may not be present; to be confirmed.

## Confirmed from settings.yml (so far)

Host file: `/home/shadow_prime_one/searxng/conf3/settings.yml`

- `use_default_settings: true`
- `server.secret_key` is set (hex value present)
- `server.public_instance: false`
- `server.limiter: false`
- `server.debug: true`
- `botdetection.enabled: false`
- `search.formats: [html, json]`, `result_count: 10`, `default_category: general`
- Template/static path overrides present (two blocks with reversed precedence)
- `outgoing`: `request_timeout: 2.5`, `max_retries: 1`, pools set, HTTP/2 enabled

Additional observations from full file (first 200 lines):

- No explicit `plugins:` block present (likely relying on defaults since `use_default_settings: true`).
- No explicit `engines:` block present (default engine set in effect).

Notes:
- The key `server.public_instance` is present; some SearXNG docs refer to `server.public`. We will verify effective key name against the container's default schema before making changes.
- No `plugins:` or `engines:` blocks observed yet in the first 80 lines; we will confirm by reviewing the full file.

## Unknowns to confirm

- External port mapping (Host ports → Container 8080)
- Presence and location of reverse proxy (e.g., Nginx) and TLS domain
- Existence and contents of `/home/shadow_prime_one/searxng/conf3/settings.yml`
- Enabled engines and plugins in `settings.yml`

### Reverse proxy status

- Nginx is installed: `nginx/1.26.3 (Ubuntu)`
- Next: locate active site config(s) under `/etc/nginx/sites-enabled/` and check for `proxy_pass` to port 8080.

Active sites (from `/etc/nginx/sites-enabled`):

- `searxng`
- `searxng.bak.1754889941` (backup)

Next: inspect `/etc/nginx/sites-enabled/searxng` to confirm proxy target and hardening (TLS, auth, allowlist, rate limits).

## Step-by-step data gathering (run on the VM)

Run these steps one at a time and paste output back into the task. We will fill the missing details below.

1) List config directory and check for settings.yml
```bash
ls -la /home/shadow_prime_one/searxng/conf3
[ -f /home/shadow_prime_one/searxng/conf3/settings.yml ] && head -n 50 /home/shadow_prime_one/searxng/conf3/settings.yml || echo "settings.yml not found"
```

2) Determine port bindings on the container
```bash
docker inspect searxng | jq '.[0].NetworkSettings.Ports, .[0].HostConfig.PortBindings'
```

3) Check for Nginx (if reverse proxy is in use)
```bash
nginx -v 2>&1 || echo "nginx not installed"
sudo systemctl status nginx --no-pager -l || true
```

3a) List enabled Nginx sites (to identify proxy config)
```bash
ls -la /etc/nginx/sites-enabled
```

4) Quick container logs (recent lines)
```bash
docker logs --tail 100 searxng
```

## Nginx site config (confirmed)

Active site: `/etc/nginx/sites-enabled/searxng`

Key points observed:

- TLS enabled via Certbot:
  - `listen 443 ssl;`
  - Cert paths under `/etc/letsencrypt/live/searxng.pageone.live/`
- HTTP → HTTPS redirect on port 80 for `searxng.pageone.live`.
- Proxy target: `proxy_pass http://127.0.0.1:8080;` (container listens on 8080)
- Branding overrides:
  - Alias for logo SVG: `/static/themes/simple/img/searxng.svg`
  - CSS injection and string substitutions via `sub_filter` (with `Accept-Encoding ""`) inside `location /`
- Included snippet: `/etc/nginx/snippets/searxng_pageone_branding.conf`
- Missing hardening in Nginx:
  - No Basic Auth
  - No IP allowlist
  - No rate limiting on `/search`

Exposure note:

- Docker also publishes container port 8080 on the host (0.0.0.0:8080 and [::]:8080). This is publicly reachable in parallel to Nginx unless firewalled. We may want to:
  - Remove the 0.0.0.0:8080 publish (bind to 127.0.0.1 only), or
  - Block host port 8080 in the firewall (allow 127.0.0.1), to ensure all access flows through Nginx.

### Host firewall status

- UFW not installed (`ufw: command not found`). The system may use nftables directly. We will inspect nftables rules to confirm exposure.

Findings from `sudo nft list ruleset`:

- NAT table shows DNAT for tcp dport 8080 to `172.19.0.3:8080` (Docker container IP):
  - `iifname != "br-3d6f380fa6de" tcp dport 8080 dnat to 172.19.0.3:8080`
- Filter table accepts forwarded traffic to container 8080:
  - `ip daddr 172.19.0.3 ... tcp dport 8080 accept`

Conclusion: host port 8080 is publicly reachable and forwarded by Docker to the container.

## Desired hardening (to apply after confirming above)

- Make instance private in `settings.yml`:
```yaml
server:
  public_instance: false
  secret_key: "<long_random_secret>"
plugins:
  - limiter
```

- Also ensure `server.debug: false` for production.
- Prefer resilient engines; disable brittle ones (Google/Startpage/Brave) and rely on Serper in the app for Google:
```yaml
engines:
  - name: google
    disabled: true
  - name: startpage
    disabled: true
  - name: brave
    disabled: true
  - name: mojeek
  - name: qwant
  - name: wikipedia
```
- If behind Nginx, protect with Basic Auth and optional IP allowlist; add rate limiting on `/search`.

## Remediation steps

### A) Bind container to localhost only (preferred)

Re-create the container binding 8080 to 127.0.0.1 while keeping the same image, mounts, and restart policy:

```bash
set -e
IMAGE=$(docker inspect -f '{{.Config.Image}}' searxng)
docker pull "$IMAGE"

# Stop and back up existing container name for quick rollback
docker stop searxng
BK=searxng_backup_$(date +%s)
docker rename searxng "$BK"

# Re-create bound to localhost
docker run -d \
  --name searxng \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v /home/shadow_prime_one/searxng/conf3:/etc/searxng \
  -v ecbb7b55de6397a93e6f622e2efcc633251f4d048b7c304d32e1147ddd2cd061:/var/cache/searxng \
  "$IMAGE"

# Verify
docker port searxng
curl -fsS http://127.0.0.1:8080/ >/dev/null && echo OK
```

Rollback (if needed):

```bash
docker logs --tail 100 searxng || true
docker stop searxng || true
docker rm searxng || true
docker rename "$BK" searxng
docker start searxng
```

### B) Firewall alternative (if A cannot be done immediately)

Block forwarded traffic to 8080 except from localhost using Docker's DOCKER-USER chains. This is secondary to A) and may be ephemeral across reboots unless persisted.

```bash
sudo nft add rule ip  filter DOCKER-USER tcp dport 8080 ip  saddr != 127.0.0.1 drop
sudo nft add rule ip6 filter DOCKER-USER tcp dport 8080 ip6 saddr != ::1      drop
```

### C) Nginx hardening (rate limit, optional Basic Auth)

1) Add a rate limit zone (e.g., `/etc/nginx/conf.d/ratelimit.conf`):
```nginx
limit_req_zone $binary_remote_addr zone=searx_zone:10m rate=5r/s;
```

2) Apply on `/search` while proxying:
```nginx
location /search {
  limit_req zone=searx_zone burst=10 nodelay;
  proxy_pass http://127.0.0.1:8080;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

3) Optional: Basic Auth
```bash
sudo apt-get update && sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd pageone
```
Add inside the appropriate `location` or at `server {}` level:
```nginx
auth_basic "Restricted";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Reload:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### D) Tighten SearXNG settings

Edit `/home/shadow_prime_one/searxng/conf3/settings.yml`:

```yaml
server:
  public_instance: false
  debug: false
plugins:
  - limiter
```

Then restart the container:

```bash
docker restart searxng
```

## Restart procedures (after edits)

- Docker:
```bash
docker compose restart searxng  # if compose
# or
docker restart searxng
```

## App configuration (Windows dev machine)

- `pageone-core/.env.local`:
```
SEARXNG_BASE_URL=https://searxng.pageone.live
SEARXNG_ENGINES=mojeek,qwant,wikipedia
SEARXNG_PER_QUERY_LIMIT=5
SEARXNG_QUERY_DELAY_MS=800
SERPER_API_KEY=your_serper_key
SERPER_MIN_RESULTS=3
```

## Change log

- 2025-08-20: Document created. Verified container, image, mounts, and env. Recorded current `settings.yml` keys (public_instance=false, limiter=false, debug=true). Awaiting port bindings, reverse proxy details, and full `settings.yml` content.
