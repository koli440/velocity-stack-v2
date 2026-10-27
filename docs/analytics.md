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

## Public track landing page (`/track`)
Public, indexable campaign page for Google Ads (track riders and coaches); `src/app/track/page.js`, listed in `PUBLIC_PATHS` (sitemap), linked from About and the footer. It renders in the standalone public shell (same as `/privacy`, see `isLandingPath` in `src/lib/trackLanding.js`). CTAs use `CarryLink`, which appends the visitor's query string (utm_*, gclid) to `/register` and `/login` untouched. Ad-headline wording is kept in the section headings; only implemented features are claimed and there is no pricing. Includes `SoftwareApplication` JSON-LD without `offers`.
