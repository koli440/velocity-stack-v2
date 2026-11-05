# Velodrome info research (pilot, 10 tracks)

`pilot.json` holds proposed data for 10 seeded tracks. Nothing here is applied to any database.

## Schema (per track)
- `seed_name`, `seed_values`: current DB values used for comparison.
- `fields.<name>`: `{value, source_url, evidence, confidence}`. Fields: `website_url`, `booking_url`, `operator`, `year_built`, `phone`, `email`, `opening_hours`, `pricing_url`, `price_range` (`min`, `max`, `currency`, `check_site`).
- `corrections`: `{field, old_value, new_value, source_url, evidence, confidence}` where an official source disagrees with the seed.
- `confirmations`: seed values confirmed by an official source.
- `not_found`: fields with no official confirmation (left null).
- `info_verified_at`: date of research (re-set on every re-run).

## Method
1. Find the venue/operator site, owner municipality, national federation, or UCI page. Wikipedia, directories, aggregators and web-search summaries are not accepted as sources (summaries proved unreliable; one "official" domain was a parked for-sale page).
2. Fetch the page directly, copy a short quote, and record the URL and confidence (high = explicit on a venue-specific official page; medium = official but general/indirect; low = partial or possibly stale).
3. Never guess: null the field and list it in `not_found`.
4. Prices are a link plus rough individual-session range with currency; group/hall rental is excluded; `check_site` is always true.
5. Contacts that belong to a council or staff member (not the venue) are marked medium.

## Reviewer reproduction
Re-fetch each `source_url`, confirm the quote still appears, and check the value matches. Flag anything not verifiable. Sport Vlaanderen (Gent) returned 503 at research time.

## Production schema
The draft migration was superseded by `supabase/migrations/20270135000000_velodrome_track_info.sql` (incorporates the reviewer's schema concerns). The pipeline rules are in [PROCESS.md](PROCESS.md). The pilot files are research artefacts only; nothing in them is applied.
