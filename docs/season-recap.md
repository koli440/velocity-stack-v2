# Season recap ("Wrapped")

A yearly, story-style summary of a rider's rides, computed in SQL from stored activities. Migration `20270149000000_season_recap.sql`; UI helpers in `src/lib/recap.js`.

## Data (all in SQL, no external secrets)
- `season_recap_compute(user, year)` (internal, not executable by clients) returns jsonb for rides (`activity_type = 'ride'`, gym/run excluded) dated in the calendar year, **UTC**: `ride_count`, `active_days`, `race_count`, `distance_km`, `hours` (moving, else duration, else elapsed time), `elevation_m`, `longest_ride`, `best_power` (max / best average / best normalized), `personal_bests` (PB Vault entries with `achieved_date` in the year: count plus the 5 latest), `longest_streak` (consecutive active days), `busiest_month` + `months` (12 buckets), `favorite_velodrome` (most rides at a `tracks` row), `rides_with_gps`.
- Missing data gives `null` (no distance, power, elevation, velodrome or GPS), never an error; the UI leaves those cards out. An empty year returns `ride_count: 0`. "Favorite route" is not computed: rides have no route identity, only a GPS preview.
- `season_recap(year)` is the signed-in rider's own recap (always `auth.uid()`, authenticated only).

## Sharing (opt-in)
- Private by default. `season_recap_shares(user_id, season_year, slug)` has RLS on and no client grants; riders use `get_season_recap_share`, `enable_season_recap_share` (idempotent, returns a 20-hex random slug) and `revoke_season_recap_share` (deletes the row; sharing again creates a new slug, the old link stays dead).
- `get_shared_season_recap(slug)` is callable by `anon`: totals plus nickname or first name only. Activity ids and titles are stripped; all rides of the year count, including ones with private visibility, which is why sharing is explicit.
- Public page `/recap/s/<slug>` (standalone shell, `noindex`, never cached) with a final call-to-action slide linking to `/connections`. Unknown or revoked slugs 404. `opengraph-image.js` / `twitter-image.js` in the same folder render the 1200x630 card (generic site card for unknown slugs).
- Owner page `/recap/<year>` (signed in): swipeable `RecapStory`, Share (Web Share or copy link) and Download PNG (drawn on a canvas on the device; works without a public link and publishes nothing).

## Dashboard banner
`RecapBanner` on the dashboard, October to February (`bannerYear`), dismissible per year (`localStorage` `vs.recapBanner.<year>`).

## Analytics (`src/lib/recapTracking.js`)
GA4 events `recap_view` (surface own/public), `recap_share` (method enable/web_share/web_share_png/copy_link/download_png), `recap_cta_click` (public CTA or banner) and `recap_signup` (sign-up after a CTA click in the same tab, fired from `trackSignUp`). Each is a no-op unless the analytics category is granted (`hasConsent`, see `docs/analytics.md`). No first-party storage of recap events.
