# Google Analytics 4

Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` to your GA4 Measurement ID (`G-XXXXXXXXXX`).

- Local: put it in `.env.local`(see `.env.example`).
- Hosting (e.g. Vercel): Project Settings → Environment Variables, then redeploy.

The variable is inlined at build time, so a rebuild is required after changing it.
If unset, no analytics script is loaded.

## Public track landing page (`/track`)
Public, indexable campaign page for Google Ads (track riders and coaches); `src/app/track/page.js`, listed in `PUBLIC_PATHS` (sitemap), linked from About and the footer. It renders in the standalone public shell (same as `/privacy`, see `isLandingPath` in `src/lib/trackLanding.js`). CTAs use `CarryLink`, which appends the visitor's query string (utm_*, gclid) to `/register` and `/login` untouched. Ad-headline wording is kept in the section headings; only implemented features are claimed and there is no pricing. Includes `SoftwareApplication` JSON-LD without `offers`.
