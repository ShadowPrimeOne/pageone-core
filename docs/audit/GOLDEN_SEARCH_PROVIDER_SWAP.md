# Golden Record Search — Current State Snapshot & Provider Swap Plan

Last updated: 2025-08-14

This document is a handoff for the next agent. It captures the current VM + Tunnel + Search pipeline and provides a clear plan to swap the first-line Golden Record search to an external API provider for faster results.

---

## Dev Flow Update — Public Scraper Endpoint (default)

For development, we now prefer connecting directly to the scraper worker via a public endpoint with a strict IP allowlist, instead of using an SSH tunnel. The tunnel remains as a legacy fallback.

- Set `SCRAPER_WORKER_URL` to `http://<VM_PUBLIC_IP>:8787` in `.env.local`
- Restrict inbound TCP 8787 to your public IP (/32) in your cloud firewall
- The dev script `scripts/dev.ps1` auto-detects a remote URL and skips tunneling
- See `docs/audit/SEARCH_SETUP.md` for the step-by-step guide

---

## Current State Snapshot

- VM worker: Playwright-based Google Maps scraper
  - Service: `pageone-scraper` (systemd)
  - Host bind: `127.0.0.1:8787` (private)
  - Code: `/opt/pageone/maps-worker/server.js`
  - Node path: `/usr/bin/node` (IMPORTANT: do not use `/snap/bin/node`)
  - Unit file: `/etc/systemd/system/pageone-scraper.service`
  - Health: `GET http://127.0.0.1:8787/health` → `{ ok: true }`

- Connectivity from dev machine
  - Preferred: Public endpoint `http://<VM_PUBLIC_IP>:8787` (firewall IP-allowlisted). No tunnel required.
  - Optional: SSH local port forward `127.0.0.1:8878 → 127.0.0.1:8787`:
    ```bash
    ssh -i "%USERPROFILE%\.ssh\pageone_ed25519" -N -L 8878:127.0.0.1:8787 shadow_prime_one@<VM_PUBLIC_IP>
    ```
  - Dev script: `npm --prefix C:\Pageone\pageone-core run dev:win` (auto-detects remote and skips tunnel)

- App integration (Next.js)
  - API route: `c:/Pageone/pageone-core/src/app/api/audit/places/search/route.ts`
    - Uses `SCRAPER_WORKER_URL` (defaults to `http://localhost:8787`) with `WORKER_TIMEOUT_MS` 10s
    - Extracts `cid`, passes through `address/phoneNumber/website/category/rating/ratingCount` when present
    - Fallback: SearXNG (optional) if worker times out or is unavailable
  - UI page: `c:/Pageone/pageone-core/src/app/dashboard/audit/search/page.tsx`
    - Posts `{ name, address, phone }` to the API route
    - Displays candidates and confirms one to create the Golden NAP

- Logs & operations
  - Service logs: `sudo journalctl -u pageone-scraper -n 100 --no-pager`
  - Manage service:
    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable --now pageone-scraper
    sudo systemctl status pageone-scraper
    ```
  - Common pitfall: systemd status=203/EXEC or status=200/CHDIR if WorkingDirectory/Node path are wrong. Ensure:
    - `WorkingDirectory=/opt/pageone/maps-worker`
    - `ExecStart=/usr/bin/node /opt/pageone/maps-worker/server.js --port 8787 --host 127.0.0.1`

- Known limitations (as of now)
  - Worker `/search` reliably returns `title/cid/url`; NAP enrichment (address/phone/website/category/rating/ratingCount) is improving but not yet consistently filled.
  - Latency can be high under Playwright; we plan to speed up step 1 by using an external API provider.

References: see `docs/audit/SEARCH_SETUP.md` for detailed setup, envs, tunnel, and troubleshooting.

---

## Pipeline Diagram (Current)

```
UI (Audit step 1)
  -> POST /api/audit/places/search (Next.js route.ts)
      -> First-line: Playwright worker /search (via SSH tunnel if local dev)
         Fallback: SearXNG (if configured)
      <- JSON candidates [{ title, cid, address?, phoneNumber?, website?, category?, rating?, ratingCount?, sourceUrl }]
```

Key integration points:
- `src/app/api/audit/places/search/route.ts` — provider orchestration
- `src/app/dashboard/audit/search/page.tsx` — UI rendering + confirm
- `/opt/pageone/maps-worker/server.js` — current worker implementation

---

## Target State: External Provider as First-Line

Goal: Replace the first-line search (currently Playwright) with an external API provider to reduce latency and increase stability. The worker remains available as a fallback.

Examples of possible providers (choose based on licensing, cost, and data needs):
- Google Places API Text Search/Find Place (fast, paid, usage/compliance constraints)
- SerpAPI Google Maps API (paid aggregator)
- Algolia Places/Geo or other business directories (if coverage acceptable)

This plan is provider-agnostic and defines the interface contract the provider must satisfy.

---

## Provider Interface Contract (Golden Search)

Input (from UI → API route):
- name?: string
- address?: string
- phone?: string

Output (candidates[]):
- position: number
- title: string
- address?: string
- website?: string
- phoneNumber?: string
- category?: string
- rating?: number
- ratingCount?: number
- cid?: string
- sourceUrl?: string

The API route remains responsible for mapping any external provider payload into this shape.

---

## Environment Variables (Provider Switch)

Add these to `.env.local` (dev) or deployment environment:

```
# which first-line provider to use: worker | serper | searx
GOLDEN_SEARCH_PROVIDER=worker

# Serper.dev (recommended for trial)
SERPER_API_KEY=           # put your key in .env.local (do NOT commit)
# Optional:
SERPER_GL=au              # default 'au'
SERPER_HL=en              # default 'en'

# existing vars
SCRAPER_WORKER_URL=http://<VM_PUBLIC_IP>:8787   # recommended (no tunnel)
# Legacy (tunnel): SCRAPER_WORKER_URL=http://127.0.0.1:8878
WORKER_TIMEOUT_MS=10000
SEARXNG_BASE_URL=         # optional fallback
```

Notes:
- `GOLDEN_SEARCH_PROVIDER` gates the branch in `route.ts`.
- Keep the worker reachable during migration for easy rollback.

---

## Code Skeleton for `route.ts` Provider Switch

This is a minimal example to guide the next agent. Do NOT commit secrets; read from env.

```ts
// src/app/api/audit/places/search/route.ts (pseudo-skeleton)
import { NextResponse } from 'next/server'

type Candidate = {
  position: number
  title: string
  address?: string
  website?: string
  phoneNumber?: string
  category?: string
  rating?: number
  ratingCount?: number
  cid?: string
  sourceUrl?: string
}

function mapExternalToCandidate(list: any[]): Candidate[] {
  return (list || []).slice(0, 10).map((r: any, i: number) => ({
    position: i + 1,
    title: r.name || r.title || 'Result',
    address: r.formatted_address || r.address,
    website: r.website,
    phoneNumber: r.international_phone_number || r.phone,
    category: r.types?.[0] || r.category,
    rating: r.rating,
    ratingCount: r.user_ratings_total || r.ratingCount,
    cid: r.cid, // if provider offers it; else derive from url when available
    sourceUrl: r.url || r.place_url,
  }))
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { name, address, phone } = body || {}
  const q = [name, address, phone].filter(Boolean).join(' ').trim()

  const provider = (process.env.GOLDEN_SEARCH_PROVIDER || 'worker').toLowerCase()

  if (provider === 'serper') {
    // See implementation in src/app/api/audit/places/search/route.ts
    // Calls https://google.serper.dev/search with type=maps (fallback to places)
    // Auth via X-API-KEY header (SERPER_API_KEY)
  }

  // existing worker branch ...
  // existing searx fallback ...
  return NextResponse.json({ ok: true, data: { candidates: [] } })
}
```

---

## Testing Plan

- Public endpoint healthy (preferred):
  - `curl.exe -s http://<VM_PUBLIC_IP>:8787/health` → `{ ok: true }`
  - Or PowerShell: `Test-NetConnection <VM_PUBLIC_IP> -Port 8787`
- Local tunnel healthy (optional):
  - `curl.exe -s http://127.0.0.1:8878/health` → `{ ok: true }`
- API (worker):
  - `POST http://localhost:3000/api/audit/places/search` with `{ name, address }` → candidates with `cid`
- Switch to external:
  - Set `GOLDEN_SEARCH_PROVIDER=serper`, set `SERPER_API_KEY`
  - Repeat POST, verify latency improvement and richer NAP fields (address/phone/website/category/rating/ratingCount)
- Rollback:
  - Set `GOLDEN_SEARCH_PROVIDER=worker` to restore current behavior

---

## Rollout & Rollback

- Feature-flag via `GOLDEN_SEARCH_PROVIDER`
- Stage in dev with sample queries; verify Golden NAP shows on `search/page.tsx`
- Monitor error rates/timeouts in Next logs and (if used) provider usage dashboard
- Roll back instantly by flipping env var; no code changes needed once switch is implemented

---

## Handoff Checklist for Next Agent

- [ ] Read `docs/audit/SEARCH_SETUP.md` and this file end-to-end
- [ ] Choose external provider and create credentials
- [ ] Implement provider branch in `src/app/api/audit/places/search/route.ts` using the skeleton above
- [ ] Add env vars in `.env.local` and/or deployment environment
- [ ] Test dev via tunnel; confirm UI shows full Golden NAP (address/phone/website/category/rating/ratingCount)
- [ ] Keep worker online as a fallback; confirm graceful degradation
- [ ] Update docs with provider-specific nuances (quotas, fields, pricing)
