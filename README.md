# PageOne Core (MVP)

Clean, minimal Next.js 15 + Tailwind CSS 4 + Supabase SSR boilerplate for the unified PageOne MVP. This repo is the foundation for the Business Status page and Ambassador Dashboard with frictionless onboarding and role-aware routing.

---

## Executive Summary
- Build target: unified MVP in `c:/Pageone/pageone-core`
- Tech stack: Next.js 15.3.x, React 19.1.x, Tailwind CSS 4, Supabase JS 2.53+, `@supabase/ssr`
- Auth/Roles: `dev`, `ambassador`, `client`
- Routing: server-side protected `/dashboard`, public `/status/[business]`, redirect from `/` when logged-in
- Account approval workflow: `profiles.status` (`pending`, `approved`, `denied`) gates access with `/pending` and `/denied` pages
- State: Local dev is running; Supabase schema + RLS applied; Windows scripts added for clean start + auto-open Chrome

Repository: https://github.com/ShadowPrimeOne/pageone-core

## Session Highlights & Fixes
- Windows scripts updated to use `PORT` env instead of CLI args, fixing “Invalid project directory ...\\3000”.
- Clean startup on Windows: kill port 3000 listeners, clear `.next`, start Next, and auto-open Chrome.
- Supabase env fixed: ensured valid `NEXT_PUBLIC_SUPABASE_URL` and anon key; resolved “TypeError: Invalid URL”.
- Middleware in `middleware.ts`: redirects `/` → `/dashboard` when logged-in; protects `/dashboard/*` when not.
- Verified core files exist and compile: `src/app/layout.tsx`, `src/app/page.tsx`, and `src/lib/supabase/*`.
- TypeScript config aligned: Next set `esModuleInterop`, `incremental`, `plugins: [{ name: 'next' }]`, and `.next/types` include.
 - Google OAuth configured correctly with Supabase + Google Console redirect URIs.
 - Magic Link reliability improved: server route `src/app/auth/callback/route.ts` verifies OTP when possible and forwards bare `code` to client; client page `src/app/auth/callback/complete/page.tsx` exchanges code or verifies OTP, uses `localStorage` email fallback, and prompts for email if missing.

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
  - If visiting `/` and authenticated → redirect to `/dashboard` when `status='approved'`
  - If authenticated and `status='pending'` → redirect to `/pending`
  - If authenticated and `status='denied'` → redirect to `/denied`
  - If visiting `/dashboard/*` and not authenticated or `status!='approved'` → redirect to `/`
- Role/status lookup in server components with `profiles` table

Sign-in UI implemented at `/login` with providers:
- Magic Link (Email OTP)
- Google OAuth (GitHub removed)

Provider setup notes:
- Supabase → Auth → URL Configuration → Site URL: `http://localhost:3000`
- Supabase → Auth → Providers → Google: enable and set Client ID/Secret. Redirect URL: `http://localhost:3000/auth/callback`. Also add Supabase callback to Google Console Authorized redirect URIs: `https://<PROJECT-REF>.supabase.co/auth/v1/callback`.

Auth callback flow:
- Server route: `src/app/auth/callback/route.ts`
  - Handles Magic Link via `verifyOtp()` when `token_hash` exists or when `code+email+type` are present.
  - For bare `code` (PKCE OAuth), forwards to client to use the PKCE verifier.
- Client page: `src/app/auth/callback/complete/page.tsx`
  - Exchanges OAuth `code` for a session or verifies Magic Link OTP.
  - Reads email from query or `localStorage` key `po_otp_email` (set when sending magic link) and shows an email input fallback if missing.

---

## Routing
- `/` Landing page (SSR). Redirects to `/dashboard` when logged-in.
- `/dashboard` Auth-protected. Will host the ambassador/client dashboards.
- `/status/[business]` Public status stub (MVP target: health score + metrics).

### Account Approval Workflow
- DB: `profiles.status` enum `account_status` with values `pending | approved | denied`.
- SQL migration: `supabase/sql/2025-08-11_add_profile_status.sql` (run in Supabase SQL editor).
- Middleware routes users based on `status` to `/dashboard`, `/pending`, or `/denied`.
- Developer-only Accounts page at `/dashboard/accounts` lists users grouped by status and supports Approve/Deny/Pending and role assignment.

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

Auth-specific:
- Google: `redirect_uri_mismatch` → Add Supabase callback `https://<PROJECT-REF>.supabase.co/auth/v1/callback` in Google Console and set app redirect `http://localhost:3000/auth/callback` in Supabase provider.
- Magic Link: If you see “both auth code and code verifier should be non-empty,” open the link in the same browser profile. Our callback now verifies OTP first; if email is missing you’ll be prompted to enter it on `/auth/callback/complete`.

---

## Payments & Stripe Webhook (Dev)
 
This project supports a dev-friendly Stripe flow to convert a lead into a client via webhooks.
 
• __Key files__
  - `src/app/api/stripe/webhook/route.ts`: Webhook handler. Accepts signed events when `STRIPE_WEBHOOK_SECRET` is set. In dev (when unset), accepts raw JSON.
  - `src/lib/supabase/admin.ts`: Supabase admin client (uses `SUPABASE_SERVICE_ROLE_KEY`).
  - `src/app/dashboard/ambassador/actions.ts`: `createPayment()` and `seedDemoLeads()`.
  - `src/app/dashboard/ambassador/page.tsx`: Pipeline UI (hides converted leads and exposes dev-only seed/nuke actions). Accessible at `/pipeline`.
  - `scripts/dev.ps1`: Starts Next dev server and a Stripe CLI listener; attempts to fetch and export `STRIPE_WEBHOOK_SECRET` for the session.
 
• __Environment__
  - `.env.local` must include:
    - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `STRIPE_SECRET_KEY`
    - `STRIPE_WEBHOOK_SECRET` (optional in dev; required in production)
 
• __Start (Windows)__
  - Preferred: `npm run dev:win` (runs Next, opens browser, and starts Stripe CLI listener if available).
  - Manual Stripe CLI (alternative):
    ```powershell
    stripe listen --forward-to http://localhost:3000/api/stripe/webhook --events checkout.session.completed,payment_intent.succeeded
    ```
    Copy the `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart the dev server.
 
• __Lead → Payment → Conversion test__
  1) Go to `/pipeline`.
  2) As `dev`, click “Seed Demo Leads” to create sample leads.
  3) Click “Manual Payment” on a lead to open Stripe Checkout; pay with a test card (e.g., `4242 4242 4242 4242`).
  4) Webhook receives `checkout.session.completed` (or `payment_intent.succeeded`). Handler:
     - Marks `payments.status='paid'`, sets `paid_at`.
     - Updates `leads.status='paid'` and links `payment_id`.
     - Upserts a `business` (unique slug), links `lead.business_id`, sets `leads.status='converted'`.
     - Ensures `memberships` for owner and seeds a starter onboarding task.
 
• __UI result__
  - Converted leads are hidden in the Pipeline page query: see `src/app/dashboard/ambassador/page.tsx` where leads filter `status != 'converted'` for both dev and ambassadors.
  - New client appears under “Clients”.
 
• __Verify in DB (SQL)__
  ```sql
  -- Payments (latest)
  select id, lead_id, status, paid_at, session_id, created_at, updated_at
  from payments order by updated_at desc limit 10;
 
  -- Leads (latest)
  select id, slug, status, payment_id, business_id, updated_at
  from leads order by updated_at desc limit 10;
 
  -- Businesses (latest)
  select id, slug, name, owner_id, updated_at
  from businesses order by updated_at desc limit 10;
 
  -- Events (observe webhook + conversion logs)
  select type, created_at
  from events order by created_at desc limit 20;
  ```
 
• __Resend/Replay__
  - List recent events: `stripe events list --limit 5`
  - Resend a specific event (replace `evt_xxx`):
    ```powershell
    stripe events resend evt_xxx --forward-to http://localhost:3000/api/stripe/webhook --force
    ```
 
• __Notes__
  - In development, leaving `STRIPE_WEBHOOK_SECRET` empty allows unsigned JSON (convenience). In production, set it and keep it secret.
  - Ensure `SUPABASE_SERVICE_ROLE_KEY` matches the same project as your public anon key; otherwise webhook mutations will fail.
  - A dev-only “Seed Demo Leads” button and “Nuke All” action exist on the Ambassador page (dev-only).
 
 ---
 
## Lead-to-Client Flow
 
 1) Lead captured/seeded → optional golden record audit → agreement initiation.
 2) Payment collected via Stripe Checkout (`createPayment()` sets metadata `lead_id` & `payment_id`).
 3) Webhook matches the session/payment to the lead and performs conversion.
 4) Business created/linked, membership ensured, onboarding task seeded.
 5) Lead hidden from Ambassador leads list; client visible in Clients grid and on `/status/[slug]`.
 
 ---

## Security Notes
- Service role key is server-only; never expose to the client.
- `.gitignore` ignores `.env*` except `.env.local.example`.
- RLS policies protect user and business data by default.

---

## Handover Checklist
- [ ] `.env.local` has: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Apply SQL: run `supabase/sql/2025-08-11_add_profile_status.sql` in Supabase.
- [ ] Providers: Enable Magic Link; enable Google with app redirect `http://localhost:3000/auth/callback` and Google Console redirect `https://<PROJECT-REF>.supabase.co/auth/v1/callback`.
- [ ] Sign in once, then set your profile to `role='dev'` and `status='approved'` to access `/dashboard/accounts`.
- [ ] Start locally on Windows: `npm run dev:win` (auto kills port 3000, clears cache, opens Chrome).
- [ ] Verify middleware redirects for approved/pending/denied statuses.
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