# Discovery Setup and Resilience Guide

Last updated: 2025-08-20

## Overview

This document explains the Discovery system used to find a business’s presence across the web, Australian directories, socials, and maps/places. It covers:

- Architecture and flow
- Environment variables and defaults
- SearXNG tuning and hardening
- Serper (Google) fallback usage
- Deterministic AU directory probes
- Data model and snapshots
- Debugging and extension tips

Key files:
- `src/app/api/audit/discovery/urls/route.ts` — Builds queries, fetches results (SearXNG + Serper), scores, aggregates, emits stream events, saves snapshot.
- `src/lib/discovery/au_directories.ts` — Canonical AU directories/socials/maps host lists and weights.
- `src/lib/discovery/probes_au.ts` — Deterministic AU directory probes via site-restricted Serper queries.
- `src/app/api/audit/discovery/scrape/route.ts` — Scrapes selected URLs to extract NAP, scores vs golden, writes observations and opportunities, snapshotting outputs.
- `src/app/dashboard/audit/[auditId]/DiscoveryAndScrapeClient.tsx` — Client UI that streams discovery progress and shows scrape progress.
- `docs/audit/SEARCH_SETUP.md` — VM worker and dev connectivity for Golden Record search (Maps worker) — adjacent but separate.
- `docs/audit/AUDIT_FLOW_TESTING.md` — End-to-end testing guide (payloads, SSE events, curl examples) for discovery, scrape, and report.

## Discovery Flow (high level)

1) Build a basket of queries from the golden record (name, address, phone, city/state) and known AU directory/social hosts.
2) Deterministic directory probes (site-restricted queries) run first via Serper to capture top listing URLs from priority AU directories.
3) SearXNG web search (throttled) runs to broaden coverage using a curated engine subset.
4) Optional Serper fallback triggers when SearXNG yields too few items overall.
5) All candidates are scored, deduped, per-host limited, and saved as a discovery snapshot for the audit.
6) The Scrape step fetches pages and extracts NAP signals, writing `nap_observations` and `listing_opportunities`.

## Environment variables

- `SEARXNG_BASE_URL` — SearXNG instance URL. Dev defaults to `https://searxng.pageone.live` unless overridden in scripts or `.env.local`.
- `SEARXNG_ENGINES` — Comma-separated engine subset (e.g. `mojeek,qwant,wikipedia`).
- `SEARXNG_PER_QUERY_LIMIT` — Search results per query (default `5`).
- `SEARXNG_QUERY_DELAY_MS` — Delay between queries in ms (default `800`).
- `SERPER_API_KEY` — Enables Serper queries for directory probes and fallback.
- `SERPER_MIN_RESULTS` — Threshold below which Serper fallback triggers (default `3`).

Recommended `.env.local` for dev (Windows):
```
SEARXNG_BASE_URL=https://searxng.pageone.live
SEARXNG_ENGINES=mojeek,qwant,wikipedia
SEARXNG_PER_QUERY_LIMIT=5
SEARXNG_QUERY_DELAY_MS=800
SERPER_API_KEY=your_serper_key
SERPER_MIN_RESULTS=3
```

## SearXNG tuning and hardening

- Make instance private: `server.public: false` in SearXNG `settings.yml`.
- Add `server.secret_key` and protect via reverse proxy (Basic Auth, IP allowlist, or Cloudflare Access).
- Enable rate limiting (limiter plugin in SearXNG and/or Nginx `limit_req`).
- Prefer stable engines (Mojeek, Qwant, Wikipedia). Disable brittle engines (Google/Startpage/Brave) unless proxied. We lean on Serper for Google coverage.

## Deterministic AU directory probes

Purpose: guarantee we attempt to find listings on core AU directories even when general web search is degraded.

Approach implemented in `src/lib/discovery/probes_au.ts`:
- Uses Serper site-restricted queries for priority AU directories (e.g., `site:yellowpages.com.au "<name>" <city> <state>`), returning the top 2–3 likely listing URLs per site.
- Runs before SearXNG and merges results for scoring/aggregation.
- Honors the `SERPER_API_KEY` env; if absent, probes are skipped.
- Keeps cost predictable via small per-host limits and tight queries.

Extending probes:
- Add new hosts into the `HOSTS` array in `probes_au.ts`.
- Keep per-host caps small (2–3).
- Use `q = site:<host> "<name>" <city> <state>`; optionally include postcode when available.

## Serper fallback (broad)

- After SearXNG runs, if total discoveries remain below `SERPER_MIN_RESULTS`, the API uses Serper organic results for a couple of the strongest queries to fill gaps.
- Directory probes and fallback both use Serper but serve different purposes:
  - Probes: targeted to AU directory hosts; run first.
  - Fallback: general organic; run only when too few items found.

## Scoring and aggregation

- Each candidate is scored in `urls/route.ts` using:
  - Host class (places/directory/social > web)
  - AU signals (TLD/known hosts)
  - Brand phrase/bigrams
  - Geo (city/state/postcode)
  - Address/phone matches
  - Penalties (wrong location, job boards, generic pages)
- Aggregation de-dupes by host (and full social path), boosts repeat hits and higher ranks, caps per-host to 4.

## Data and snapshots

- Discovery snapshot saved to `business_snapshots` with `{ provider, queries, urls, capturedAt }`.
- Scrape snapshot saves `{ observations, socialsLast, capturedAt }`.
- `nap_observations` and `listing_opportunities` tables track scrape results and missing directories.

## Debugging checklist

- API health:
  - `POST /api/audit/discovery/urls` with `{ businessId, auditId }` (or stream with `?stream=1`).
  - Watch stream events: `meta`, `probe:start/probe:done`, `query:start/query:done`, `item`, `snapshot:saved`, `done`.
- Environment:
  - Ensure `SERPER_API_KEY` is set for probes/fallback.
  - Ensure `SEARXNG_BASE_URL` is reachable; use `SEARXNG_ENGINES` subset.
- Engine health:
  - Stream events include `unresponsive_engines` from SearXNG.
- Result quality:
  - Verify scoring parameters; adjust penalties/weights in `urls/route.ts`.
- Costs:
  - Probes and fallback are bounded by small `num`/per-host caps.

## How to extend

- Add new AU directories to `probes_au.ts` HOSTS and to `au_directories.ts` for classification/weights.
- Tune scoring in `urls/route.ts` (`scoreItem` function) with additional signals feasible for your vertical.
- Consider adding structured-probe modules for specific directories if they expose stable search URLs or APIs.

## Quick test recipe

1) Create `.env.local` in `pageone-core` with the envs above.
2) Start dev: `npm --prefix C:\Pageone\pageone-core run dev:win`.
3) Trigger discovery via UI (Audit page) and watch the stream log for probe and searx events.
4) Confirm snapshot in Supabase `business_snapshots` for the audit.

## Operational notes

- SearXNG should be private and rate-limited; treat public exposure as temporary.
- Prefer Serper for reliable Google coverage; proxying Google via SearXNG requires paid proxies and continuous tuning.
