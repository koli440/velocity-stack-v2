# Import landing pages (`/import`)

Public, indexable guides for riders who want to bring rides in: `/import` (index), `/import/strava`, `/import/garmin`, `/import/fit`. They target searches such as "export Strava data", "link Fitbit to Strava", "Strava alternative" and "import FIT files". No database, migrations or secrets.

- Content and SEO helpers live in `src/lib/importGuides.js` (steps, FAQ, titles/descriptions fitted to the SEO limits, `FAQPage`/`HowTo`/`BreadcrumbList` JSON-LD). Source names/blurbs reuse `RIDE_SOURCES` (`src/lib/rideSources.js`). Add a guide by adding an entry to `IMPORT_GUIDES` and its path to `PUBLIC_PATHS` in `src/lib/seo.js` (a unit test checks this).
- Pages: `src/app/import/page.js` and `src/app/import/[source]/page.js` (static, unknown slugs 404). They render in the lightweight public shell (`isImportPath` in `AppShell`) so crawlers get full HTML.
- Strava guide: connecting is limited by the shared Strava API read budget (see `docs/integrations.md`), so it documents the data-export ZIP fallback. `Import History` already unpacks ZIPs and `.fit.gz` (`src/lib/bulkImport.js`); `.gpx`/`.tcx` entries are skipped, and the guide says so.
- CTAs (`ImportCtaRow`): "Create a free account" (`/register?next=/connections`) and "Open Connections". Links keep utm_*/gclid via `CarryLink`.
- First run: the empty-feed welcome card (`EmptyFeedCard`) shows `FIRST_RUN_STEPS` (connect or import, rides arrive, see fitness) and links to the guides (`src/lib/emptyFeed.js`).
- Links: Help menu ("Import your rides"), footer ("Import rides"), `/import-help`, `sitemap.xml`, `llms.txt`/`llms-full.txt` (`PAGES` in `src/lib/llms.js`).
- Blog posts: `export-strava-data`, `link-fitbit-to-strava`, `strava-alternative` (`content/blog`, see `docs/blog.md`).
- Analytics: GA4 `import_guide_view` and `import_cta_click` (params `source_guide`, `cta`), sent by `src/lib/importTracking.js` only when `hasConsent('analytics')` is true and gtag is loaded (see `docs/analytics.md`).
- Planned: a mention of the 2026 season recap (`/recap/2026`) can be added to the "What happens next" section once that feature ships.
