# Cookie consent (GDPR/ePrivacy)
A banner is shown to all visitors (no geo detection): Accept all / Reject all / Customize, equal prominence, optional categories off by default, page usable without choosing. Categories: strictly necessary (Supabase session, theme, the consent record; always on), analytics (GA4), marketing (Google Ads signals, Reddit Pixel).

- Pure logic in `src/lib/consent.js` (record parse/validate, Consent Mode mapping, which scripts may load; tested in `__tests__/consent.test.js`). UI and script loading in `src/components/ConsentManager.js`, mounted in `src/app/layout.js`. No `next/script` tags for GA/Reddit any more, so nothing loads or sets cookies before a choice.
- The choice is stored in `localStorage` key `vs.consent` as `{version, ts, analytics, marketing}`. Bump `CONSENT_VERSION` when categories or vendors change to re-prompt everyone; records also expire after 12 months.
- Google Consent Mode v2: `gtag('consent','default', all denied)` is pushed before any Google tag, and `gtag('consent','update', ...)` on every choice (analytics -> `analytics_storage`; marketing -> `ad_storage`, `ad_user_data`, `ad_personalization`). The gtag.js script is injected only after analytics is accepted. There is no Google Ads conversion tag in the app yet; when added, load it from `ConsentManager` behind the marketing flag.
- Withdrawing a previously granted category deletes `_ga*`, `_gcl_au`, `_rdt_*` cookies and reloads the page so the scripts stop.
- "Cookie settings" in the footer and on `/privacy`/`/terms` dispatches `vs:open-cookie-settings` to reopen the dialog.
- `trackSignUp` sends GA4 `sign_up` only with analytics consent and Reddit `SignUp` only with marketing consent.
- Verify in DevTools: with a fresh profile (clear site data), Network shows no `googletagmanager.com`, `google-analytics.com` or `redditstatic.com` requests and Application → Cookies has no `_ga*`/`_rdt_*` before accepting; after "Accept all" they appear; "Cookie settings" → Reject all removes them.
- Legal text (`content/legal/privacy.md` section 11) lists the cookies; keep it in sync and keep the draft notice.

# Google Analytics 4

Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` to your GA4 Measurement ID (`G-XXXXXXXXXX`).

- Local: put it in `.env.local`(see `.env.example`).
- Hosting (e.g. Vercel): Project Settings → Environment Variables, then redeploy.

The variable is inlined at build time, so a rebuild is required after changing it.
If unset, no analytics script is loaded. It is also never loaded before the visitor accepts the Analytics category (see Cookie consent).

# Reddit Pixel

Set `NEXT_PUBLIC_REDDIT_PIXEL_ID` to your Reddit Pixel ID (`a2_xxxxxxxx`), configured the same way as the GA4 ID (`.env.local` / hosting env vars, inlined at build time, rebuild after changing).
If unset, no Reddit script is loaded. It loads only after the visitor accepts the Marketing category (see Cookie consent).

- `src/components/ConsentManager.js` injects the script after consent and `src/lib/redditPixel.js` builds the snippet, which fires `PageVisit` on load.
- `/register` fires `SignUp` (`trackRedditEvent`) once `supabase.auth.signUp` succeeds. It is a no-op when the pixel is not loaded.

## Sign-up conversions (`src/lib/signupTracking.js`)
- One call, `trackSignUp(method)`, sends GA4 `sign_up` (`method`: `email` | `google`, plus `campaign_source`/`campaign_medium`/`campaign` from utm_* when known) and Reddit `SignUp`. Each is a no-op when its script is not loaded. Mark `sign_up` as a key event in GA4 (Admin → Events).
- Email: fired on `/register` after `supabase.auth.signUp` succeeds.
- Google: `GoogleSignInButton` stores utm_source/medium/campaign, gclid and a "sign-in in flight" flag in `sessionStorage` (no secrets) before redirecting. After the OAuth round trip `AppShell` calls `trackOAuthSignUpOnce` on `SIGNED_IN`; it fires only if the flag is set and the account was just created (`created_at` ≈ `last_sign_in_at`), once per user (`localStorage` marker), so later logins never double-fire.

## Public track landing page (`/track`)
Public, indexable campaign page for Google Ads (track riders and coaches); `src/app/track/page.js`, listed in `PUBLIC_PATHS` (sitemap), linked from About and the footer. It renders in the standalone public shell (same as `/privacy`, see `isLandingPath` in `src/lib/trackLanding.js`). CTAs use `CarryLink`, which appends the visitor's query string (utm_*, gclid) to `/register` and `/login` untouched. Ad-headline wording is kept in the section headings; only implemented features are claimed and there is no pricing. Includes `SoftwareApplication` JSON-LD (with `featureList`) without `offers`. Analysis templates are the lead feature: the hero and a prominent section after it cover the template description, detection, stored/comparable results and rider/coach use; claims there must match `docs/template-dsl.md` and `docs/data-model.md`. Gear Architect, PB Vault, velodromes and race tagging stay on the page.

## Anonymous tool usage (Gear Architect, Pursuit Strategist)
`/gears` and `/pursuit` (also public when logged out) send first-party usage events to the `track_tool_event()` RPC (`src/lib/toolUsage.js`, migration `20270147000000_tool_usage_and_pb_stats.sql`). Events: gear `view` / `calculate` / `compare`; pursuit `view` / `plan` (discipline, distance, whether "My pacing" was used) / `pacing_on` / `pacing_fallback` (reason `no-records` | `no-lap-data`; the last two for signed-in riders only).
- **Nothing identifying is sent or stored**: no user id, IP, cookie, localStorage/sessionStorage value or fingerprint. The row holds the tool, event, a signed-in boolean (decided server-side from the request, not stored as an id), and coarse values (discipline, rounded distance, reason). It cannot be linked to a person, so it sets no cookie, needs no consent and adds nothing to the privacy text (`content/legal/privacy.md` section 11 unchanged; re-check if an identifier is ever added). Unique visitors therefore cannot be counted, only events.
- Endpoint: the RPC is callable by `anon` and `authenticated`, has a strict allowlist (tool, event, reason), a sanitised discipline (<= 40 chars, limited charset), a bounded distance, and silently ignores anything else. Bots are dropped (crawler/script user-agents via the PostgREST request headers, and bot accounts). With no visitor key the rate limit is global: max 300 events per minute, the rest are dropped. The client also sends each distinct event once per page load.
- The table has no client privileges (RLS on, all grants revoked); only the admin RPC reads it. Rows older than 90 days are deleted daily by pg_cron job `tool-usage-prune` (`prune_tool_usage_events()`).
- Shown on `/admin` (see `docs/admin.md`). Public-tool to sign-up conversion is not tracked.
