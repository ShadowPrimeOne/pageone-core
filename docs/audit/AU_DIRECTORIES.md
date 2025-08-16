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
