# Search Setup — Scraper Worker, SSH Tunnel, and Dev Integration

Last updated: 2025-08-14

## Overview

- The AU Google Maps scraper worker runs on a Linux server and listens on `127.0.0.1:8787`.
- Your Windows dev machine connects via an SSH local port forward:
  - Local: `127.0.0.1:8878` → Remote: `127.0.0.1:8787`.
- The Next.js app uses `SCRAPER_WORKER_URL=http://127.0.0.1:8878` during development.
- The script `scripts/dev.ps1` auto-starts the tunnel and exports env vars before starting Next.

Architecture:
```
Next.js (local) --> http://127.0.0.1:8878  ===SSH Tunnel===>  Linux:127.0.0.1:8787 (scraper worker)
```

## Prerequisites

- Windows 10/11 with PowerShell and OpenSSH client (`ssh` in PATH).
- SSH key at `%USERPROFILE%\.ssh\pageone_ed25519` with access to the Linux server.
- Linux server running the scraper worker, bound to 127.0.0.1:8787 (not publicly exposed).
- Node.js on server (for the worker), Playwright dependencies installed.

## Server Setup (Linux)

1) Bind worker to localhost only:
- Configure your worker app to listen on `127.0.0.1:8787`.
- Health endpoint should respond at `GET /health` with `{ "ok": true }`.

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
ExecStart=/usr/bin/node /opt/pageone/maps-worker/server.js --port 8787 --host 127.0.0.1
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
curl -s http://127.0.0.1:8787/health
# => {"ok":true}
```

## Dev Tunnel (Windows)

The dev script handles this automatically, but here is the manual command for reference:
```
ssh -i "%USERPROFILE%\.ssh\pageone_ed25519" -N -L 8878:127.0.0.1:8787 shadow_prime_one@34.9.45.190
```
Notes:
- Local port: 8878
- Remote: 127.0.0.1:8787
- User/host: `shadow_prime_one@34.9.45.190`

## Environment Variables

In development (auto-set by `scripts/dev.ps1`):
- `SCRAPER_WORKER_URL=http://127.0.0.1:8878`
- `WORKER_TIMEOUT_MS=10000`
- `PORT=3000` (default for Next.js dev)

Optional `.env.local` entries:
```
SCRAPER_WORKER_URL=http://127.0.0.1:8878
WORKER_TIMEOUT_MS=10000
```

## Running Locally

Preferred (auto tunnel + Next dev):
```
npm --prefix C:\Pageone\pageone-core run dev:win
```
Expected:
- This window: shows tunnel init logs and "Next.js dev server launched...".
- New window: Next "Ready on http://localhost:3000".

Verify tunnel:
```
curl.exe -s http://127.0.0.1:8878/health
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

- Expose worker via reverse proxy (Nginx) with TLS, auth, and IP allowlist; then set `SCRAPER_WORKER_URL` to the public URL.
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

- Keep the worker bound to `127.0.0.1` on the server; do not expose port 8787 publicly.
- Rotate SSH keys periodically; restrict server user permissions.
- If exposing via proxy, require authentication and rate limits.

## Checklist

- [ ] Server: worker healthy on 127.0.0.1:8787 (`/health` returns `{ok:true}`)
- [ ] Windows: SSH key present at `%USERPROFILE%\.ssh\pageone_ed25519`
- [ ] Dev script: `npm --prefix C:\Pageone\pageone-core run dev:win`
- [ ] Health: `curl http://127.0.0.1:8878/health` → `{ok:true}`
- [ ] API: `/api/audit/places/search` returns candidates with `cid`
