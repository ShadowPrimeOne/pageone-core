# Audit Flow Testing Guide

Last updated: 2025-08-20

This guide shows how to test the Discovery, Scrape, and Report endpoints end-to-end, including streaming with SSE, expected payloads, and verification steps in Supabase.

## Quick Testing Flow (TL;DR)

1) Ensure env
   - `.env.local`:
     ```
     SEARXNG_BASE_URL=https://searxng.pageone.live
     SEARXNG_ENGINES=mojeek,qwant,wikipedia
     SERPER_API_KEY=<key>
     ```
   - Start dev: `npm --prefix C:\Pageone\pageone-core run dev:win`

2) Discovery (SSE)
   ```
   curl -N -s \
     -H "Accept: text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{"businessId":"<BUSINESS_ID>","auditId":"<AUDIT_ID>"}' \
     http://localhost:3000/api/audit/discovery/urls?stream=1
   ```
   - Expect events: `meta`, `probe:*`, `query:*`, `snapshot:saved`, `done`.

3) Scrape (use discovery snapshot)
   ```
   curl -s \
     -H "Content-Type: application/json" \
     -d '{"businessId":"<BUSINESS_ID>","auditId":"<AUDIT_ID>","useDiscovery":true}' \
     http://localhost:3000/api/audit/discovery/scrape
   ```
   - Expect `{ ok: true, data: { observations, socialsLast } }`.

4) Report
   ```
   curl -s \
     -H "Content-Type: application/json" \
     -d '{"businessId":"<BUSINESS_ID>","auditId":"<AUDIT_ID>","includeMaps":false}' \
     http://localhost:3000/api/audit/report
   ```
   - Expect `{ ok: true, data: { overallScore, platforms, golden, ... } }`.

5) Verify in DB (Supabase)
   - `business_snapshots`: entries for `discovery` and `scrape`.
   - `nap_observations`: rows with plausible `match_score`.
   - `listing_opportunities`: created for missing/weak directories.

## Prerequisites

- A valid `businessId` and `auditId` (create via the UI wizard or seed data).
- Env configured for discovery:
  - SEARXNG_BASE_URL (dev default: https://searxng.pageone.live)
  - SEARXNG_ENGINES (e.g., `mojeek,qwant,wikipedia`)
  - SEARXNG_PER_QUERY_LIMIT (default 5)
  - SEARXNG_QUERY_DELAY_MS (default 800)
  - SERPER_API_KEY (enables directory probes and fallback)
  - SERPER_MIN_RESULTS (default 3)

See `docs/audit/DISCOVERY_SETUP.md` for environment details and hardening notes.

## 1) Discovery URLs — POST /api/audit/discovery/urls

- Body JSON: `{ businessId: string, auditId?: string }`
- Modes:
  - Streaming (SSE): add `?stream=1` or send `Accept: text/event-stream`.
  - Non-streaming JSON: default behavior.

### SSE events sequence

- `meta`: configuration for the run. For example: `{ provider: 'searxng' | 'serper', searx?: string, engines?: string, queries?: string[], limits?: { perQueryLimit, delayMs } }`
- `probe:start`: `{ provider: 'serper', kind: 'directories' }`
- `probe:item`: discovery candidate from deterministic AU directory probes.
- `probe:done`: `{ count }`
- `probe:error`: `{ error }` (if probes fail)
- `query:start`: `{ q, target? , provider? }`
- `item`: discovery candidate from the active query.
- `query:done`: `{ q, elapsed, count, total, badUrl, excludedOwn, unresponsive_engines? }`
- `query:error`: `{ q, error? , status? , elapsed? , provider? }`
- `snapshot:saved`: `{ auditId, count }` (only if `auditId` provided)
- `done`: `{ total }` final aggregated count
- `fatal`: `{ error }` unexpected failure

Item payload shape (SSE):
- From scoring in `src/app/api/audit/discovery/urls/route.ts`:
  - `url`: normalized key (host-only except full path for socials)
  - `title`, `content`, `host`, `source_type`: 'social' | 'directory' | 'places' | 'web'
  - `rank`: rank within engine page
  - `score`: computed relevance score
  - Flags: `exact`, `bigram`, `phone`, `geo`, `wrongLocation`, `occupationOnly`, `jobBoard`

Non-streaming response:
- `{ ok: true, data: { provider: 'searxng', urls: Array<{ url, title?, content?, host, source_type, score, rank? }> } }`
  - Note: non-streaming aggregation does not include the detailed boolean flags.

Snapshot persisted (when `auditId` present):
- Table `business_snapshots`, `data.discovery = { provider, queries, urls, capturedAt }`

#### Curl examples

Streaming (PowerShell or bash):
```
curl -N -s \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"businessId":"<BUSINESS_ID>","auditId":"<AUDIT_ID>"}' \
  http://localhost:3000/api/audit/discovery/urls?stream=1
```

Non-streaming:
```
curl -s \
  -H "Content-Type: application/json" \
  -d '{"businessId":"<BUSINESS_ID>","auditId":"<AUDIT_ID>"}' \
  http://localhost:3000/api/audit/discovery/urls
```

### What to verify

- SSE emits `probe:*` then `query:*` events, followed by `snapshot:saved` and `done`.
- `urls` include AU directory and social hosts, capped to max 4 per host.
- Supabase `business_snapshots` contains a new `discovery` entry for the `auditId`.

## 2) Scrape — POST /api/audit/discovery/scrape

- Body JSON: `{ businessId: string, auditId: string, urls?: string[], useDiscovery?: boolean }`
  - If `useDiscovery` is true and `urls` is empty, the API pulls URLs from the most recent `business_snapshots.data.discovery.urls` for that `auditId`.
  - Explicit `urls` are respected (used to tick/untick). The business website is excluded unless explicitly provided.
- Behavior:
  - Sequential fetch with 10s timeout and ~150ms delay between URLs.
  - Extracts NAP from HTML (JSON-LD LocalBusiness, tel: links, AU number patterns), plus the page title as a name signal.
  - Normalizes AU phone, token-overlap scoring vs Golden name/address/phone.
  - For socials, attempts to extract `last_post_at` timestamps.
  - Inserts rows into `nap_observations` in small batches during the run.
  - Creates `listing_opportunities` for missing/weak directories (excludes socials/maps).
  - Saves a `scrape` snapshot and merges `socials_last` into the business golden profile.
- Limits: max ~80 URLs after normalization and de-dup.

Response:
- `{ ok: true, data: { observations, socialsLast } }`
  - `observations[]`: `{ url, source_type: 'social'|'directory'|'web'|'places', name?, address?, phone?, match_score, mismatch, last_post_at? }`

#### Curl examples

Use discovery snapshot URLs automatically:
```
curl -s \
  -H "Content-Type: application/json" \
  -d '{"businessId":"<BUSINESS_ID>","auditId":"<AUDIT_ID>","useDiscovery":true}' \
  http://localhost:3000/api/audit/discovery/scrape
```

Explicit subset of URLs:
```
curl -s \
  -H "Content-Type: application/json" \
  -d '{
    "businessId":"<BUSINESS_ID>",
    "auditId":"<AUDIT_ID>",
    "urls":[
      "https://www.facebook.com/yourpage",
      "https://www.yellowpages.com.au/some-listing"
    ]
  }' \
  http://localhost:3000/api/audit/discovery/scrape
```

### What to verify

- `nap_observations` rows are inserted during the run; `match_score` looks plausible (>=85 strong, 40–84 moderate).
- `listing_opportunities` contains entries for directories without strong matches (priority derived from directory weight).
- `business_snapshots` has a `scrape` snapshot with `observations` and `socialsLast`.
- Business record `golden_profile.socials_last` merged with any new social timestamps.

## 3) Report — POST /api/audit/report

- Body JSON: `{ businessId: string, auditId: string, includeMaps?: boolean }` (default `includeMaps=false`).
- Aggregates observations per platform (directory/social/review/leads and optionally maps) using AU directory host mapping from `src/lib/discovery/au_directories.ts`.
- Computes a per-platform status from best observed score:
  - `green` if >=85
  - `orange` if 40–84
  - `red` otherwise
- Contribution: green = 100% weight, orange = 50%, red = 0%.

Response:
- `{ ok: true, data: { golden, scoring: { thresholds, contribution, totalWeight, obtained, overallScore }, platforms: [{ key, name, category, weight, status, contribution, urls: [{ url, source_type, score|null, status, mismatch? }] }], generatedAt } }`

#### Curl example
```
curl -s \
  -H "Content-Type: application/json" \
  -d '{"businessId":"<BUSINESS_ID>","auditId":"<AUDIT_ID>","includeMaps":false}' \
  http://localhost:3000/api/audit/report
```

### What to verify

- `overallScore` is 0–100 with contributions summing by platform weight.
- Each platform shows best-status and URL rows; statuses match thresholds.

## Troubleshooting

- Ensure `SEARXNG_BASE_URL` is reachable and engines are healthy; watch `unresponsive_engines` in `query:done`.
- Set `SERPER_API_KEY` to enable directory probes and organic fallback.
- If discovery returns very few items, verify golden name/address/phone are correct and specific.
- For scrape blocks/timeouts, re-run with a smaller URL subset; socials may rate-limit.

## Appendix: Minimal JSON payloads

Discovery:
```
{ "businessId": "<BUSINESS_ID>", "auditId": "<AUDIT_ID>" }
```

Scrape (use discovery snapshot URLs):
```
{ "businessId": "<BUSINESS_ID>", "auditId": "<AUDIT_ID>", "useDiscovery": true }
```

Report:
```
{ "businessId": "<BUSINESS_ID>", "auditId": "<AUDIT_ID>", "includeMaps": false }
```
