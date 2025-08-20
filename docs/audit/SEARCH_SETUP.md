# Search Setup — Scraper Worker (Public Endpoint by Default) and Optional Tunnel

Last updated: 2025-08-14

## Overview

- The AU Google Maps scraper worker runs on a Linux server. For development, the **recommended path is to expose it via a public endpoint** restricted to your IP, and point `SCRAPER_WORKER_URL` at it.
- The SSH tunnel is now **optional (legacy fallback)**. Use it only if you cannot expose the worker.
- The dev script `scripts/dev.ps1` now **auto-detects** `SCRAPER_WORKER_URL` from your environment or `.env.local` and will **skip the tunnel** when the URL points to a remote host (e.g., `http://<vm-ip>:8787`).

See also: `docs/audit/GOLDEN_SEARCH_PROVIDER_SWAP.md` for a current-state snapshot and the plan to switch the first-line Golden Record search to an external API provider (while keeping the VM worker as fallback).

Architecture (public endpoint preferred):
```
Next.js (local) --> http://<vm-ip>:8787  (IP-allowlisted)  --->  Linux:0.0.0.0:8787 (scraper worker)
```

Legacy (tunnel) fallback:
```
Next.js (local) --> http://127.0.0.1:8878  ===SSH Tunnel===>  Linux:127.0.0.1:8787 (scraper worker)
```

## Prerequisites

- Windows 10/11 with PowerShell and OpenSSH client (`ssh` in PATH).
- SSH key at `%USERPROFILE%\.ssh\pageone_ed25519` with access to the Linux server.
- Linux server running the scraper worker, bound to 127.0.0.1:8787 (not publicly exposed).
- Node.js on server (for the worker), Playwright dependencies installed.

## Server Setup (Linux)

1) Choose bind mode:
- Public endpoint (recommended for dev): configure your worker to listen on `0.0.0.0:8787` so the VM can accept traffic on 8787.
- Tunnel-only (legacy): keep `127.0.0.1:8787` and use the SSH tunnel.
- In both modes, ensure `GET /health` returns `{ "ok": true }`.

2) Example systemd unit (template):
```
# /etc/systemd/system/pageone-scraper.service
[Unit]
Description=PageOne AU Maps Scraper Worker
After=network.target

[Service]
Type=simple
Environment=NODE_ENV=production
WorkingDirectory=/opt/pageone/maps-worker
ExecStart=/usr/bin/node /opt/pageone/maps-worker/server.js --port 8787 --host 0.0.0.0
Restart=on-failure
RestartSec=5
User=pageone
Group=pageone

[Install]
WantedBy=multi-user.target
```
Commands:
```
sudo systemctl daemon-reload
sudo systemctl enable --now pageone-scraper
sudo systemctl status pageone-scraper
```

3) Verify on server:
```
curl -s http://127.0.0.1:8787/health   # if bound to localhost
curl -s http://0.0.0.0:8787/health     # if bound to all interfaces
# => {"ok":true}
```

## Public Endpoint (No Tunnel) — Recommended for Dev

1) Find your VM public IP
   - GCP Console → Compute Engine → VM instances → copy the External IP of your scraper VM.

2) Allowlist your IP on port 8787
   - GCP Console → VPC network → Firewall → Create firewall rule
   - Name: `allow-scraper-8787-from-<your-ip>`
   - Network: `default` (or your VM network)
   - Direction: Ingress, Action: Allow, Priority: 1000
   - Targets: All instances in the network (or specify your instance via tag)
   - Source IPv4 ranges: `<your-public-ip>/32`
   - Protocols/ports: `tcp:8787`

3) Set your app environment
   - `.env.local`:
     ```
     SCRAPER_WORKER_URL=http://<vm-ip>:8787
     WORKER_TIMEOUT_MS=10000
     ```
   - The script `scripts/dev.ps1` will read `.env.local` and skip the SSH tunnel when it sees a remote URL.

4) Verify connectivity from your dev PC
   - PowerShell:
     ```powershell
     Test-NetConnection <vm-ip> -Port 8787
     Invoke-WebRequest http://<vm-ip>:8787/health -UseBasicParsing
     ```

5) Run the app
   - `npm --prefix C:\Pageone\pageone-core run dev:win`
   - You should see: "Using remote scraper: http://<vm-ip>:8787 (no tunnel)"

## Dev Tunnel (Windows) — Optional / Legacy

The dev script will only attempt a tunnel if `SCRAPER_WORKER_URL` points to `http://127.0.0.1:8878`.
Manual command (reference only):
```
ssh -i "%USERPROFILE%\.ssh\pageone_ed25519" -N -L 8878:127.0.0.1:8787 shadow_prime_one@34.9.45.190
```
Notes:
- Local port: 8878
- Remote: 127.0.0.1:8787
- User/host: `shadow_prime_one@34.9.45.190`

## Environment Variables

In development:
- `scripts/dev.ps1` will set `PORT` and read `.env.local`. If `SCRAPER_WORKER_URL` is remote, it will skip the tunnel. If it is `http://127.0.0.1:8878`, it will try to create the tunnel.

Examples for `.env.local`:
```
# Recommended (no tunnel)
SCRAPER_WORKER_URL=http://<vm-ip>:8787
WORKER_TIMEOUT_MS=10000

# Legacy (tunnel)
# SCRAPER_WORKER_URL=http://127.0.0.1:8878
# WORKER_TIMEOUT_MS=10000
```

## Running Locally

Preferred (auto-detect; no tunnel when remote):
```
npm --prefix C:\Pageone\pageone-core run dev:win
```
Expected:
- This window: shows tunnel init logs and "Next.js dev server launched...".
- New window: Next "Ready on http://localhost:3000".

Verify health:
```
curl.exe -s http://<vm-ip>:8787/health
# {"ok":true}
```

Test API end-to-end:
```
$body = @{ name = "Peak Sports Physiotherapy Wangaratta"; address = "2 Green St Wangaratta VIC 3677" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/audit/places/search -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```
Should return `{ ok: true, data: { candidates: [...] } }` with `title`, `cid`, and `sourceUrl`.

## Configuration in scripts/dev.ps1

Key variables (modify if host/ports change):
```
$ScraperKeyPath    = "$env:USERPROFILE\.ssh\pageone_ed25519"
$ScraperRemoteUser = "shadow_prime_one"
$ScraperRemoteHost = "34.9.45.190"
$ScraperLocalPort  = 8878
$ScraperRemotePort = 8787
```
Behavior:
- Exports `SCRAPER_WORKER_URL` and `WORKER_TIMEOUT_MS` so Next inherits them.
- Starts SSH tunnel in background, waits up to ~10s for `/health`.
- Continues to start Next.js dev in a new window.

## Production Options

- Expose worker via reverse proxy (Nginx) with TLS, auth, and IP allowlist; then set `SCRAPER_WORKER_URL` to the HTTPS URL.
- Or keep worker private and run the Next.js backend where it can reach `127.0.0.1:8787` directly.
- Add health and readiness probes; systemd restart policies already included.

## Troubleshooting

- Tunnel parser error in PowerShell:
  - Ensure `scripts/dev.ps1` uses `$()` around variables before colons in strings (fixed in repo).
- Health OK but API empty:
  - Increase timeout (`WORKER_TIMEOUT_MS=15000`), retry; verify the query; check worker logs.
- Permission denied (SSH):
  - Verify key path, server `~/.ssh/authorized_keys`, file permissions, and username.
- Port already in use (8878):
  - Change `$ScraperLocalPort` in `scripts/dev.ps1` and update `SCRAPER_WORKER_URL` accordingly.
- Next cannot reach worker:
  - Confirm `SCRAPER_WORKER_URL` is set in the dev PowerShell environment (echo `$env:SCRAPER_WORKER_URL`).
- Fallback path:
  - The API retains SearXNG fallback when the worker is unavailable; ensure `SEARXNG_BASE_URL` is set if using fallback.

## Security Notes

- If using the public endpoint, **restrict by IP** and prefer a TLS reverse proxy with an API key header.
- If using the tunnel-only mode, keep the worker bound to `127.0.0.1` on the server.
- Rotate SSH keys periodically; restrict server user permissions.
- If exposing via proxy, require authentication and rate limits.

## Checklist

- [ ] Server: worker healthy (`/health` returns `{ok:true}`)
  - Public endpoint (recommended): `curl http://<vm-ip>:8787/health`
  - Tunnel (optional): `curl http://127.0.0.1:8878/health`
- [ ] Windows: (only if using tunnel) SSH key at `%USERPROFILE%\.ssh\pageone_ed25519`
- [ ] Dev script: `npm --prefix C:\Pageone\pageone-core run dev:win` (auto-detects remote and skips tunnel)
- [ ] API: `/api/audit/places/search` returns candidates with `cid`

## Related docs

- `docs/audit/DISCOVERY_SETUP.md` — Discovery flow, env, probes, scoring
- `docs/audit/AUDIT_FLOW_TESTING.md` — End-to-end testing (payloads, SSE, curl)
- `docs/audit/AU_DIRECTORIES.md` — Platform list and how to add/remove directories
- `docs/audit/SEARXNG_DOCKER_VM_SETUP.md` — SearXNG hardening and networking
