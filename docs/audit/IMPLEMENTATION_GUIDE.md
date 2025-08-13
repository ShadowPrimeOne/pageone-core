# PageOne Audit Flow — Implementation Guide

This document is the source of truth for implementing and operating the “Audit” flow. It’s designed so any new contributor can take over mid-implementation or after a chat refresh and continue seamlessly.

Last updated: 2025-08-13


## 1) Executive Summary

- Objective: Build a quantified, repeatable “Digital Health” audit that:
  - Confirms a business’s Golden NAP via Google Places.
  - Gathers a complete snapshot (Places, website, socials, directories).
  - Detects NAP mismatches and listing opportunities.
  - Performs Ads readiness/competitor audit and Lighthouse analysis.
  - Produces an actionable report and CTA for the $479 90-day trial.
- Constraints: Avoid paid APIs. Use Playwright (Chrome) + SearXNG + Lighthouse.
- Entry Points: Pipeline “Audit” (existing lead) and Pipeline “Search” (new business by NAP).


## 2) Roles, Access, and UX Principles

- Roles (MVP): dev, ambassador, client.
  - dev: full access to dashboards, audit tools, and data.
  - ambassador: limited dashboard; can run audits and view business status.
  - client: read-only status/audit for their business; limited actions.
- Global header: shows initials + role when authenticated; unauthenticated users see Sign in and `/dashboard/*` redirects to `/login`.
- Frictionless UX: Low-friction audit start from pipeline.
- Currency: Default AUD.


## 3) Entry Points & Routes

- Pipeline buttons:
  - Search → `/dashboard/audit/search` (start a new audit from NAP)
  - Audit → `/dashboard/audit/[auditId]` (continue or view specific audit)
- Frontend pages/components (Next.js 15 + React 19):
  - `src/app/dashboard/audit/search/page.tsx`: search UI (Name, Address, Phone) → Places candidates.
  - `src/app/dashboard/audit/[auditId]/page.tsx`: wizard: NAP → Snapshot → Discovery → Ads → Lighthouse → Report.
  - `src/components/audit/DigitalHealthMeter.tsx`: radial meter.
  - `src/components/audit/NapCompareTable.tsx`: mismatches.


## 4) System Components

- Next.js API Orchestrator (app routes under `src/app/api/audit/*`).
- Scraper Worker Service (`services/scraper-worker/`): Playwright + Lighthouse + Express.
- SearXNG (self-hosted) for broad discovery and site queries; add AU engine.
- Supabase for auth, storage, and audit data (with RLS).


## 5) Data Model (Supabase)

Tables (new):

- `business_profiles`
  - id (uuid), lead_id (uuid, nullable), place_cid (text), golden_name (text), golden_address (text), golden_phone (text), website (text), socials jsonb, categories text[], created_by (uuid), created_at (timestamptz default now())
- `audit_runs`
  - id (uuid), business_id (uuid), status text check in ('pending','running','complete','failed'), started_at timestamptz, completed_at timestamptz, summary jsonb
- `business_snapshots`
  - id (uuid), business_id (uuid), audit_id (uuid), source text check in ('places','website','manual'), data jsonb, created_at timestamptz default now()
- `nap_observations`
  - id (uuid), audit_id (uuid), business_id (uuid), source_url text, source_type text check in ('social','directory','web','places'), name text, address text, phone text, match_score int, mismatch jsonb, captured_at timestamptz default now()
- `listing_opportunities`
  - id (uuid), audit_id (uuid), directory text, suggested_url text, reason text, priority int
- `ads_audit`
  - id (uuid), audit_id (uuid), queries jsonb, ad_counts jsonb, advertisers jsonb, detected_tags jsonb
- `lighthouse_runs`
  - id (uuid), audit_id (uuid), url text, categories jsonb, audits jsonb, score float, created_at timestamptz default now()

Notes:
- Keep raw `data` JSON for traceability. Use small, typed views for UI where needed.
- RLS: restrict business and audit data to dev/ambassador; clients read own records.

Migration file to create: `supabase/sql/2025-08-13_audit_tables.sql`.


## 6) Flow Stages (Detailed)

1) NAP Search (Places)
- Input: Name, Address, Phone (any subset). Build queries:
  - "{name} {address}", "{name} {phone}", "{name} {city}".
- Use Playwright to query google.com.au, extract top Places candidates with: title, address, phone, rating, ratingCount, category, website, cid, lat/lng.
- Present candidates → user confirms Golden NAP.
- Persist: upsert `business_profiles` (golden_*), create `audit_runs` (status running), `business_snapshots` (source='places').

2) Snapshot Expansion
- Fetch additional Place details (photos, hours, reviews meta) from Maps page state.
- Crawl website (if present):
  - Extract socials (fb/ig/li/x/yt/tiktok), schema.org JSON-LD (LocalBusiness), NAP on contact/footer pages, meta tags.
- Update `business_snapshots` with website data.

3) Discovery & Consistency
- SearXNG queries (google_au + others):
  - "{name}" + phone/address
  - site:domain.tld for indexed traces (gclid presence, social handles)
  - Per-network: `site:facebook.com {name city}`, etc.
- Directory list (AU priority): Yellow Pages AU, TrueLocal, Hotfrog AU, Foursquare, Apple Maps, Bing Places, Facebook, Instagram, LinkedIn, LocalSearch, StartLocal, WhereIs, MapQuest, TomTom, Here, Trustpilot, Yelp.
- Scrape each result page; extract NAP; compute match score; store `nap_observations` and `listing_opportunities`.

4) Advertising Audit
- If unknown/NOT advertising: SERP queries like "{category} {city}", "{service} {suburb}"; count ads; capture advertiser domains.
- If advertising suspected:
  - Detect tags on site (gtag/gtm/aw), remarketing pixels; search indexed URLs for `gclid` via SearXNG `site:domain gclid`.
  - Evaluate landing page with Lighthouse; note LCP/CLS issues.

5) Lighthouse
- Run Lighthouse programmatically; persist categories: performance, accessibility, best-practices, SEO; include opportunities list.

6) Report & Offer
- Compute Digital Health score (0–100), show meter and category breakdown.
- Present mismatches with suggested fixes, missing listings to claim, website/ads improvements.
- CTA: $479 90-day trial; promises per business requirements.


## 7) Matching & Scoring

Normalization:
- Name: trim punctuation/extra spaces, lowercase for compare.
- Address: collapse whitespace; standardize common abbreviations (St → Street, Rd → Road, Ave → Avenue, Suite/Unit normalization).
- Phone: parse to E.164 using libphonenumber (AU +61), strip non-digits.

Observation Match Score (0–100):
- Weights: name 40, address 40, phone 20.
- Name/address: ratio via Levenshtein/Jaro-Winkler (>=0.9 considered match). Phone exact after normalization.

Digital Health Score (0–100):
- NAP Consistency 40%
- Listings Coverage 20%
- Website Quality 20% (Lighthouse performance + SEO + best-practices, schema presence)
- Ads Readiness/Optimization 20% (presence of tags, LP score, SERP competition context)


## 8) API Contracts (Next.js app routes)

All responses use `{ ok: boolean, data?: T, error?: string }`.

- `POST /api/audit/places/search`
  - Body: `{ name?: string, address?: string, phone?: string }`
  - Returns: `{ candidates: PlaceCandidate[] }`
  - `PlaceCandidate`:
    ```ts
    type PlaceCandidate = {
      position: number
      title: string
      address?: string
      latitude?: number
      longitude?: number
      rating?: number
      ratingCount?: number
      category?: string
      phoneNumber?: string
      website?: string
      cid?: string
    }
    ```

- `POST /api/audit/places/confirm`
  - Body: `{ candidate: PlaceCandidate, leadId?: string }`
  - Returns: `{ auditId: string, businessId: string }`

- `POST /api/audit/discovery/run`
  - Body: `{ auditId: string }`
  - Starts discovery job; returns `{ jobId: string }`.

- `POST /api/audit/ads/run`
  - Body: `{ auditId: string, queries?: string[] }`
  - Returns `{ jobId: string }`.

- `POST /api/audit/lighthouse/run`
  - Body: `{ auditId: string, url?: string }` (defaults to business website)
  - Returns `{ jobId: string }`.

- `GET /api/audit/status/{auditId}`
  - Returns aggregated status and scores for wizard.


## 9) Scraper Worker Service (Express)

Path: `services/scraper-worker/`

Endpoints:
- `GET /health`
- `GET /places/search?q=...&gl=AU&hl=en` → returns PlaceCandidate[]
- `GET /places/details?cid=...` → returns full place detail JSON (from page state)
- `POST /serp/ads` → `{ queries: string[], gl?: 'AU', hl?: 'en' }` → returns per-query ad counts and advertisers
- `POST /lighthouse` → `{ url: string }` → returns Lighthouse JSON

Playwright settings:
- Launch Chromium; `locale: 'en-AU'`.
- Set `gl=AU`, `hl=en` params in Google queries; handle consent dialog.
- Headful in dev, headless in CI; random realistic UA; staggered waits.
- Optional proxy (env-configurable).

Lighthouse:
- Use `chrome-launcher` and `lighthouse` packages; throttle default; JSON output only.


## 10) SearXNG Configuration

- Add engine `google_au` with `google_domain: google.com.au`.
- Prefer `google_au` weight; keep Bing/DDG as backups.
- Queries we issue:
  - Brand + phone/address
  - `site:{domain}` for indexed artifacts
  - Per social: `site:facebook.com {brand city}` etc.
  - Per directory: `site:yellowpages.com.au {brand}` or phone

Configure base URL via env: `SEARXNG_BASE_URL`.


## 11) Frontend Wizard Logic

Wizard steps for `/dashboard/audit/[auditId]`:
- Step 1: NAP
  - If no `auditId`, redirect to `/dashboard/audit/search`.
  - Display candidates, allow manual edit, confirm Golden NAP.
- Step 2: Snapshot
  - Show Places + website extraction summary, allow re-run.
- Step 3: Discovery
  - Show observations table with match scores and mismatches.
- Step 4: Ads
  - Present SERP ad counts, advertisers, competitor domains.
- Step 5: Lighthouse
  - Show category scores, key opportunities.
- Step 6: Report
  - Digital Health meter; breakdown; CTA with role-gated actions.


## 12) Environment & Scripts

Env (`.env.local`):
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE (server-only if needed)
- SEARXNG_BASE_URL (e.g., `https://searxng.example.com`) 
- SCRAPER_WORKER_URL (e.g., `http://localhost:7071`)
- PLAYWRIGHT_CHROMIUM_PATH (optional)

Windows scripts (already present baseline):
- `scripts/dev.ps1` and `scripts/start.ps1` support port selection, killing 3000, cache clear, and auto-open Chrome.
- Add a `scripts/worker.ps1` to start the scraper worker (Playwright + Express) on port 7071.

Ports:
- Next.js: 3000 (configurable via `PORT`)
- Scraper Worker: 7071


## 13) RLS & Security

- Lock down audit tables to dev/ambassador; clients can read only their business audit.
- Use Supabase auth context in API routes to enforce row-level access.
- Avoid storing PII beyond business NAP; store only public web data artifacts.


## 14) Testing Baseline

- Dev-only actions in ambassador dashboard remain:
  - Seed Demo Leads (seed exactly 3 fresh leads in `prospecting`, owner `shadow.prime.one@gmail.com` if exists, else current dev)
  - Nuke All (remove leads/clients) to reset state
- Flow test:
  1. Nuke All → Seed 3 leads
  2. Run Search → Confirm Golden NAP → Snapshot
  3. Run Discovery → verify at least 10 observations, accurate match scores
  4. Ads audit on 2–3 keywords → see advertiser list
  5. Lighthouse run on website → scores present
  6. Report shows Digital Health meter and CTA


## 15) Definition of Done per Milestone

- M1: Routing + DB + SearXNG
  - New `/dashboard/audit/search` exists; pipeline “Search” wired.
  - SQL migration `2025-08-13_audit_tables.sql` applied successfully.
  - SearXNG google_au engine reachable via `SEARXNG_BASE_URL`.
- M2: Places + NAP Confirmation
  - Scraper worker `/places/search` returns candidates on AU queries.
  - Confirm persists Golden NAP, creates `audit_runs`, and snapshot.
- M3: Discovery + Matching
  - Observations stored with consistent `match_score`; opportunities listed.
  - UI table shows mismatches with suggested fixes.
- M4: Ads + Lighthouse
  - Ads SERP counts + advertiser domains captured for given queries.
  - Lighthouse categories stored and rendered; key opportunities surfaced.
- M5: Report UX
  - Digital Health meter, breakdown, and action plan appear.
  - CTA for $479 90-day trial with role-gated actions.


## 16) Implementation Order (Checklist)

- [ ] Create migration `supabase/sql/2025-08-13_audit_tables.sql` with tables above
- [ ] Add env vars to `.env.local.example`
- [ ] Scaffold routes under `src/app/api/audit/*` with contracts
- [ ] Create `src/app/dashboard/audit/search/page.tsx`
- [ ] Create `src/app/dashboard/audit/[auditId]/page.tsx` with stepper
- [ ] Scaffold `services/scraper-worker/` with Express + Playwright + Lighthouse
- [ ] Add `scripts/worker.ps1` to run worker on 7071
- [ ] SearXNG engine `google_au` configured (weights prioritized)
- [ ] Implement NAP normalization helpers and scoring utils
- [ ] Implement DigitalHealthMeter and NapCompareTable components
- [ ] Wire pipeline buttons to Audit/Search routes


## 17) Technical Notes & Gotchas

- Google Consent: Dismiss consent banner once per session before scraping results.
- Anti-bot hygiene: headful in dev, human-like delays, realistic UA; avoid fast retries.
- Address normalization: AU-specific abbreviations (St/Street, Rd/Road, Ave/Avenue, Hwy/Highway, Ste/Unit/Suite alignment).
- Phone normalization: AU country code `+61`, preserve leading zero for display but compare using E.164.
- CID extraction: available in Maps URLs and JS state. Persist for later checks.
- Lighthouse throttling: keep defaults for comparability; record run settings in JSON.
- Ads elements: Google frequently changes DOM; use semantic markers (e.g., aria-label contains "Ads"/"Sponsored") + screenshots on failures.


## 18) Future Enhancements

- Automated directory claiming/updates via APIs where available; form-filler automation where not.
- Schema.org enhancement suggestions and OpenGraph completeness scoring.
- Competitor benchmarks: compare Digital Health among top 3 local competitors.
- Landing page generator with 95+ Lighthouse target; template library.
- Multi-region proxies and captcha-solving integration if necessary.


## 19) Troubleshooting

- Places search returns empty:
  - Validate queries; try alternative query variant (name+phone).
  - Confirm consent banner handled; ensure `hl=en` `gl=AU` applied.
- SearXNG sparse results:
  - Check engine availability/limits; test `google_au` directly in browser.
- Lighthouse fails:
  - Ensure Chrome path and permissions; try headful; check mixed content/redirects.
- Supabase RLS blocks reads:
  - Verify auth role and policies; test with service role on server-only path.


## 20) Appendix A — Example Payloads

Example PlaceCandidate:
```json
{
  "position": 1,
  "title": "Whole Foods Market",
  "address": "2001 Market St, San Francisco, CA 94114",
  "latitude": 37.7687616,
  "longitude": -122.4270156,
  "rating": 4.2,
  "ratingCount": 1500,
  "category": "Grocery store",
  "phoneNumber": "(415) 626-1430",
  "website": "https://www.wholefoodsmarket.com/stores/2001marketstreet",
  "cid": "6353588238324409422"
}
```

API Response wrapper:
```ts
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }
```


## 21) Appendix B — Pseudocode (NAP Scoring)

```ts
function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function normalizePhoneAU(s: string) {
  const digits = s.replace(/\D/g, '')
  // handle AU local 0-leading to +61
  if (digits.startsWith('0')) return '+61' + digits.slice(1)
  if (digits.startsWith('61')) return '+61' + digits.slice(2)
  if (digits.startsWith('+')) return '+' + digits
  return '+61' + digits // best effort
}

function normalizeAddress(s: string) {
  const m = s.toLowerCase()
    .replace(/\./g, '')
    .replace(/\bst\b/g, 'street')
    .replace(/\brd\b/g, 'road')
    .replace(/\bave\b/g, 'avenue')
    .replace(/\bhwy\b/g, 'highway')
    .replace(/\bsuite\b|\bste\b|\bunit\b/g, 'unit')
    .replace(/\s+/g, ' ')
    .trim()
  return m
}

function scoreObservation(a: {name:string;address:string;phone:string}, b:{name:string;address:string;phone:string}) {
  const nameScore = similarity(normalizeName(a.name), normalizeName(b.name)) // 0..1
  const addrScore = similarity(normalizeAddress(a.address), normalizeAddress(b.address))
  const phoneMatch = normalizePhoneAU(a.phone) === normalizePhoneAU(b.phone) ? 1 : 0
  return Math.round(nameScore*40 + addrScore*40 + phoneMatch*20)
}
```


---

This guide should be kept updated as modules ship. For any questions, start at Section 16 (Checklist) and Section 15 (DoD) to locate work in progress and next actions.
