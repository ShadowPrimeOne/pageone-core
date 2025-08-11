# PageOne Core (MVP)

Clean, minimal Next.js 15 + Tailwind CSS 4 + Supabase SSR boilerplate for the unified PageOne MVP. This repo is the foundation for the Business Status page and Ambassador Dashboard with frictionless onboarding and role-aware routing.

---

## Executive Summary
- Build target: unified MVP in `c:/Pageone/pageone-core`
- Tech stack: Next.js 15.3.x, React 19.1.x, Tailwind CSS 4, Supabase JS 2.53+, `@supabase/ssr`
- Auth/Roles: `dev`, `ambassador`, `client`
- Routing: server-side protected `/dashboard`, public `/status/[business]`, redirect from `/` when logged-in
- State: Local dev is running; Supabase schema + RLS applied; Windows scripts added for clean start + auto-open Chrome

Repository: https://github.com/ShadowPrimeOne/pageone-core

## Session Highlights & Fixes
- Windows scripts updated to use `PORT` env instead of CLI args, fixing “Invalid project directory ...\\3000”.
- Clean startup on Windows: kill port 3000 listeners, clear `.next`, start Next, and auto-open Chrome.
- Supabase env fixed: ensured valid `NEXT_PUBLIC_SUPABASE_URL` and anon key; resolved “TypeError: Invalid URL”.
- Middleware in `middleware.ts`: redirects `/` → `/dashboard` when logged-in; protects `/dashboard/*` when not.
- Verified core files exist and compile: `src/app/layout.tsx`, `src/app/page.tsx`, and `src/lib/supabase/*`.
- TypeScript config aligned: Next set `esModuleInterop`, `incremental`, `plugins: [{ name: 'next' }]`, and `.next/types` include.

## Business Context & Requirements
- Pricing: $479 upfront for 90-day trial, then 20% management fee on ad spend (min $20/day).
- Payment: Stripe + PayPal + AU-friendly alternatives; collect billing before onboarding.
- Ambassador system: 3 real ambassadors; incentivized via points/credits to maintain business health.
- Frictionless UX priority across the platform.
- Single domain with subpaths: `/dashboard`, `/status/[business]`. SearXNG stays on subdomain.
- Access: Ambassadors and clients both view status pages; clients can use secure links/QR (private auth via Supabase OAuth/invite).
- Integrations: Essential now—Google Places API and SearXNG; placeholders for Meta/Microsoft ads.

## Onboarding Flow
Lead → Health Check → Agreement → Payment Collection → Client Onboarding → Status Page Access

---

## Stack & Versions
- Next.js: 15.3.3 (`next`)
- React / DOM: 19.1.0 (`react`, `react-dom`)
- Supabase: `@supabase/supabase-js` ^2.53.0, `@supabase/ssr` ^0.5.1
- Tailwind CSS: ^4 with `@tailwindcss/postcss`
- TypeScript: ^5

Key config files:
- `next.config.ts`
- `tailwind.config.ts`
- `postcss.config.mjs`
- `tsconfig.json`
- `.gitignore` (env files ignored)

---

## Directory Structure (high-level)
```
pageone-core/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx            # Root layout
│  │  ├─ page.tsx              # Landing page: redirects to /dashboard when logged-in
│  │  ├─ globals.css           # Base styles; neon variables to extend later
│  │  ├─ dashboard/            # Auth-protected area (SSR)
│  │  └─ status/[business]/    # Public business status stub
│  └─ lib/
│     └─ supabase/
│        ├─ client.ts          # Browser client (use client)
│        └─ server.ts          # Server client via @supabase/ssr + cookies
├─ middleware.ts               # SSR session + redirects
├─ scripts/
│  ├─ dev.ps1                  # Kill port 3000, clear cache, start dev, auto-open Chrome
│  └─ start.ps1                # Build, kill port, start prod-like, auto-open Chrome
├─ .env.local                  # Local env (not committed)
├─ .env.local.example          # Template
├─ package.json                # Scripts + deps
└─ README.md
```

---

## Environment Setup
1) Copy and edit env file
```
cp .env.local.example .env.local
```
Required variables (no quotes, no Markdown):
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
# Server-only usage (never in client)
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```
2) Install dependencies
```
npm install
```

---

## Supabase Schema & RLS (Applied)
- Profiles table attached to `auth.users` with role enum: `dev | ambassador | client`
- Triggers to auto-create profile on signup
- Optional `businesses` and `memberships` with RLS to control access
- Policies enforce users read/write only their data, and business membership access

These SQL scripts have been applied in the target project. If you replicate on a new Supabase project, re-run the schema SQL and set your `.env.local`.

---

## Running Locally
- Standard:
```
npm run dev
```
- Windows clean dev (recommended):
```
npm run dev:win
```
Behavior of `scripts/dev.ps1`:
- Stops any process on port 3000
- Clears `.next` cache
- Starts Next on port `3000` (via `PORT` env)
- Automatically opens a new Chrome window at `http://localhost:3000`

Prod-like run:
```
npm run start:win
```

If running from a different directory:
```
npm --prefix c:\\Pageone\\pageone-core run dev:win
```

---

## Authentication & Roles
- Roles: `dev`, `ambassador`, `client`
- Server-side sessions via `@supabase/ssr` and `middleware.ts`
- `middleware.ts` behavior:
  - If visiting `/` and authenticated → redirect to `/dashboard`
  - If visiting `/dashboard/*` and not authenticated → redirect to `/`
- Role badge/lookup performed in server components using `profiles` table

Sign-in UI: to be added (`/login` planned). Providers: Magic Link, Google, GitHub (choose and enable in Supabase).

---

## Routing
- `/` Landing page (SSR). Redirects to `/dashboard` when logged-in.
- `/dashboard` Auth-protected. Will host the ambassador/client dashboards.
- `/status/[business]` Public status stub (MVP target: health score + metrics).

---

## Styling & Theme
- Tailwind v4 basic setup is in place.
- Neon accent palette to add:
  - `#FF5BFF`, `#D34DEE`, `#BF4BF8`, `#2AC9F9`, `#56F1FF`
- Light/Dark mode design to be implemented with CSS variables in `src/app/globals.css` and Tailwind theme extensions.

---

## Windows Dev Scripts
- `scripts/dev.ps1` and `scripts/start.ps1`:
  - Kill ghost process on port 3000
  - Clear `.next` cache
  - Start Next with `PORT` env
  - Open Chrome `--new-window` at `http://localhost:3000`
- If PowerShell policy blocks execution:
```
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

## Troubleshooting
- Invalid URL / Supabase: Ensure `NEXT_PUBLIC_SUPABASE_URL` is a plain URL (no brackets/Markdown) and keys are correct. Restart server.
- Port busy: Scripts kill listeners on 3000. Manual check:
```
netstat -ano | findstr ":3000" | findstr LISTENING
```
- Verify port listening (PowerShell):
```
powershell -NoProfile -Command "(Test-NetConnection -ComputerName localhost -Port 3000).TcpTestSucceeded"
```
- If Chrome doesn’t open: Script falls back to default browser. You can manually `start http://localhost:3000`.

---

## Roadmap (MVP)
- [x] Scaffold Next.js 15 + Tailwind 4 + Supabase SSR boilerplate
- [x] Implement role-aware middleware and basic routes
- [x] Supabase schema + RLS applied; env configured
- [x] Windows scripts for clean start + auto-open browser
- [ ] Define and implement Business Status page (health score, metrics, insights)
- [ ] Add `/login` and connect chosen auth provider(s) (Magic Link / Google / GitHub)
- [ ] Build Ambassador Dashboard: leads, onboarding, notifications
- [ ] Payments onboarding: Stripe + PayPal (+ AU alternatives) before client onboarding
- [ ] Placeholders for Google/Meta/Microsoft ad integrations & social presence
- [ ] Theming: light/dark + neon accents
- [ ] Documentation for ambassador/client onboarding flows

---

## Security Notes
- Service role key is server-only; never expose to the client.
- `.gitignore` ignores `.env*` except `.env.local.example`.
- RLS policies protect user and business data by default.

---

## Handover Checklist
- [ ] Ensure `.env.local` has valid Supabase URL and anon key (no quotes). Optional: service role key for server operations.
- [ ] Start locally on Windows: `npm run dev:win` (auto kills port 3000, clears cache, opens Chrome).
- [ ] Verify redirects: `/` → `/dashboard` when logged-in; `/dashboard/*` blocked when logged-out.
- [ ] Decide and enable auth provider(s) in Supabase (Magic Link / Google / GitHub) and implement `/login` page.
- [ ] Begin Business Status page: health score + key metrics; wire to Supabase schema.
- [ ] Outline Ambassador Dashboard: leads, onboarding, notifications.
- [ ] Plan payment onboarding (Stripe + PayPal + AU alternatives) before client onboarding.
- [ ] Extend theme: light/dark + neon accents in Tailwind + CSS variables.

---

## Contributing / Handover
- Branch: `main`
- Commit conventions: prefer concise, descriptive messages (e.g., `feat:`, `chore:`, `fix:`)
- For new agents: start by reading `middleware.ts`, `src/lib/supabase/`, and `src/app/` routes. Run `npm run dev:win` on Windows for clean start.

If you need the Supabase SQL used to create roles and tables, ask in the next session; it’s already applied to the current project but can be re-shared if you’re setting up a fresh Supabase instance.