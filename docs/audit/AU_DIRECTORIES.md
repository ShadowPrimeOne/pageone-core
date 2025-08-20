# Australian Directories & Platforms for Local SEO

This document lists the core Australian directories, maps, socials, and lead/review platforms we target for discovery, scraping, and accuracy auditing.

We use this list to:
- Generate discovery queries (via SearXNG)
- Choose relevant URLs to scrape
- Score presence, accuracy, and opportunities across the ecosystem

## Categories
- Maps: Google Business Profile, Apple Maps, Bing Places, Whereis, MapQuest, TomTom, HERE
- Directories: Yellow Pages, White Pages, Localsearch, True Local, Hotfrog, StartLocal, PureLocal, AussieWeb, dLook, BusinessListings, Brownbook, Infobel, Pink Pages, ABD
- Review: Yelp, WOMO
- Leads: Oneflare
- Social: Facebook, Instagram, LinkedIn, X/Twitter, YouTube, TikTok, Foursquare, Nextdoor

See the config: `src/lib/discovery/au_directories.ts`

## Scoring Rubric

Each platform carries a weight (1–10) reflecting influence/traffic:
- Maps: 7–10
- Major AU directories (Yellow, White, Localsearch, True Local): 5–6
- Review/social/leads and other directories: 2–5

Per-platform status and contribution:
- Correct (Green): score contribution = 100% of weight
- Mismatched (Orange): score contribution = 50% of weight
- Missing (Red): score contribution = 0% of weight

Overall audit score = (sum of platform contributions) / (sum of all platform weights) * 100

## Match Score (per-URL extraction)
- Phone exact (normalized): +60
- Address partial match (street/city/postcode overlap): +30
- Name fuzzy token overlap: +10

Thresholds:
- Strong match: ≥85 → Correct
- Possible/mismatch: 40–84 → Mismatched
- Weak/none: <40 or no result → Missing

We also record mismatches by field (name/address/phone) to drive recommendations and automation.

## Notes
- Socials can be restricted by auth; we mark presence if discoverable but rely on directory pages for NAP accuracy.
- We avoid storing full HTML. Snapshots contain relevant snippets (JSON-LD, phones, meta, anchors).
- Opportunities are created when a platform has no strong match for the business (e.g., not listed or clearly wrong profile) for automation/claiming.

## Add/Remove/Modify Directories (Discovery + Scraper + Report)

Use this procedure to keep discovery, deterministic probes, scraping, and reporting in sync.

1) Update canonical list
   - File: `src/lib/discovery/au_directories.ts`
   - Add or edit an object in `AU_DIRECTORIES` with fields:
     - `key`: stable identifier (snake_case)
     - `name`: human-friendly name
     - `hosts`: array of hostnames (no `www.`)
     - `category`: `directory` | `review` | `leads` | `maps` | `social`
     - `weight` (optional): influence in report scoring (1–10). Higher = more impact.
   - The helper sets (`AU_DIRECTORY_HOSTS`, `AU_SOCIAL_HOSTS`, `AU_MAPS_PLACES_HOSTS`) are derived automatically.

2) Deterministic probes (optional but recommended for priority AU directories)
   - File: `src/lib/discovery/probes_au.ts`
   - Add/remove the host in the `HOSTS` array to target it with Serper site-restricted queries.
   - Keep `limitPerHost` conservative (2–3) via `runDirectoryProbes(..., limitPerHost)`.

3) Discovery scoring and aggregation
   - File: `src/app/api/audit/discovery/urls/route.ts`
   - Classification uses the host lists above to label `source_type` as `directory`/`social`/`maps` vs `web`.
   - Per-host cap is applied (max 4) to avoid flooding. Priority directories should still surface due to probes/score.

4) Scraper and opportunities
   - File: `src/app/api/audit/discovery/scrape/route.ts`
   - Observations are stored in `nap_observations` with `source_type` and `match_score`.
   - Missing or weak matches for platforms in `AU_DIRECTORIES` generate `listing_opportunities` (excludes socials/maps).

5) Reporting weights
   - File: `src/app/api/audit/report/route.ts`
   - Report aggregates by platform using `AU_DIRECTORIES`. Adjust `weight` in the directory def to change contribution.

6) Remove a platform completely
   - Remove its entry from `AU_DIRECTORIES` (and its hosts from `HOSTS` in `probes_au.ts` if present).
   - Result: discovery may still find URLs, but they’ll be treated as generic `web` (not scored as a directory) and won’t affect platform-weighted reporting/opportunities.

7) Validate changes
   - Restart dev server or let Next.js reload.
   - Run discovery (SSE) and check that items classify under the new/updated host.
   - Run scrape and confirm `nap_observations` rows include the platform; check `listing_opportunities` and the report weights.

Related docs: `docs/audit/DISCOVERY_SETUP.md` (flow) and `docs/audit/AUDIT_FLOW_TESTING.md` (testing).
