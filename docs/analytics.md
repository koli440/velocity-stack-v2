# Google Analytics 4

Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` to your GA4 Measurement ID (`G-XXXXXXXXXX`).

- Local: put it in `.env.local`(see `.env.example`).
- Hosting (e.g. Vercel): Project Settings → Environment Variables, then redeploy.

The variable is inlined at build time, so a rebuild is required after changing it.
If unset, no analytics script is loaded.

# Reddit Pixel

Set `NEXT_PUBLIC_REDDIT_PIXEL_ID` to your Reddit Pixel ID (`a2_xxxxxxxx`), configured the same way as the GA4 ID (`.env.local` / hosting env vars, inlined at build time, rebuild after changing).
If unset, no Reddit script is loaded. There is no cookie-consent banner for GA either (the privacy policy covers both), so the pixel loads under the same condition: the env var being set.

- `src/app/layout.js` loads the script (`afterInteractive`) and `src/lib/redditPixel.js` builds the snippet, which fires `PageVisit` on load.
- `/register` fires `SignUp` (`trackRedditEvent`) once `supabase.auth.signUp` succeeds. It is a no-op when the pixel is not loaded.

## Sign-up conversions (`src/lib/signupTracking.js`)
- One call, `trackSignUp(method)`, sends GA4 `sign_up` (`method`: `email` | `google`, plus `campaign_source`/`campaign_medium`/`campaign` from utm_* when known) and Reddit `SignUp`. Each is a no-op when its script is not loaded. Mark `sign_up` as a key event in GA4 (Admin → Events).
- Email: fired on `/register` after `supabase.auth.signUp` succeeds.
- Google: `GoogleSignInButton` stores utm_source/medium/campaign, gclid and a "sign-in in flight" flag in `sessionStorage` (no secrets) before redirecting. After the OAuth round trip `AppShell` calls `trackOAuthSignUpOnce` on `SIGNED_IN`; it fires only if the flag is set and the account was just created (`created_at` ≈ `last_sign_in_at`), once per user (`localStorage` marker), so later logins never double-fire.

## Public track landing page (`/track`)
Public, indexable campaign page for Google Ads (track riders and coaches); `src/app/track/page.js`, listed in `PUBLIC_PATHS` (sitemap), linked from About and the footer. It renders in the standalone public shell (same as `/privacy`, see `isLandingPath` in `src/lib/trackLanding.js`). CTAs use `CarryLink`, which appends the visitor's query string (utm_*, gclid) to `/register` and `/login` untouched. Ad-headline wording is kept in the section headings; only implemented features are claimed and there is no pricing. Includes `SoftwareApplication` JSON-LD (with `featureList`) without `offers`. Analysis templates are the lead feature: the hero and a prominent section after it cover the template description, detection, stored/comparable results and rider/coach use; claims there must match `docs/template-dsl.md` and `docs/data-model.md`. Gear Architect, PB Vault, velodromes and race tagging stay on the page.
