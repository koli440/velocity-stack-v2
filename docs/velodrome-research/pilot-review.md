# Independent review of the velodrome pilot (2026-11-05)

Per-value verdicts: `pilot-review.json`. All cited source URLs were re-fetched and text-matched; extra official-source searches were run for Gent, Ballerup, Cochabamba, Sineu, Milton, Sydney. Web-search summaries were used only as leads.

## Result: 69 values, 62 verified, 5 rejected, 2 unverifiable

No source was parked, look-alike, or unreachable. Phone/email formats and currencies were sane. No quote was fabricated; errors were about *which* page, *which* number, or *whether the value should be applied*.

### Rejected
- **Ballerup booking_url**: the cited page has no wannasport link; wannasport is the municipality's general court-booking portal. Real sign-up pages are on `ballerup.nemtilmeld.dk`.
- **Ballerup phone**: mobile number of a named staff member (personal data); no venue line exists.
- **Gent website_url**: city listing page, while the operator site (sport.vlaanderen) loads fine; the "503" was transient.
- **Gent phone**: the operator publishes +32 9 244 72 22; the city page number conflicts.
- **Herne Hill surface correction**: tarmac is already normalised to `Asphalt` by `20261111000000_central_lookups.sql`; `new_value` is prose, not a lookup value.

### Unverifiable
- **Sydney operator** ("owner" not stated on the cited council page).
- **Sineu rename** (official page doesn't say cycling/333 m; only non-official sources link it to the seed track).

### Verified with wrong cited URL (value is right, `source_url_fix` given)
Sydney pricing_url, price_range, opening_hours (home page cited, data is on `/training/`); Novo mesto year_built (quote is on `/en/`, not `/en/velodrom/`).

## Missed findable info
Gent: operator site, phone, hours page, tariffs (recreant €13/session, licence holder €9.50, year card €200). Ballerup: pricing (850 DKK open event) and a functional mailbox. Milton: booking widget link. Cochabamba: news reports it has been closed/structurally damaged since ~2022, while the only official source (2019) predates this; no "operational status" concept exists in the schema.

## Weak but accepted
Council/town general phones (Sineu, Sydney, Milton), club (not venue) hours/fees for Sydney, venue-wide hours for Lee Valley, Milton year_built is a construction target, Lee Valley prices page mentions an "increase from 1 April 2026" (ambiguous freshness), Herne Hill min price excludes the booking fee while max includes it.

## Migration draft concerns
1. `website_url`, `pricing_url`, `booking_url` already exist (`20261124000000_velodrome_suggestions.sql`, incl. `tracks_links_http` constraint); the draft re-adds them harmlessly but does not make the new columns part of the existing `suggestion_targets.allowed_columns`, so user suggestions/admin review won't cover them.
2. Provenance is only in `track_info_sources` keyed `(track_id, field, verified_at)`; there is no "current" marker, so readers must `max(verified_at)`. Consider a view or `is_current`, or upsert on `(track_id, field)` plus a history table.
3. `info_verified_at` is one date per track, but fields are verified separately; derive it from sources or store per field. `not_found` (checked, nothing found) isn't representable, so quarterly refreshes can't tell "never checked" from "checked, none".
4. `tracks` is public read (`tracks_read_all`, table-level SELECT for anon): every new column, including `phone`/`email`, becomes public. Reject personal contacts and require a venue-level or generic mailbox.
5. `track_info_sources` policy lacks `TO anon, authenticated` and explicit `REVOKE INSERT/UPDATE/DELETE`, unlike the `tracks` hardening; no http(s) check on `source_url`; `value TEXT` loses typing; `price_currency` lacks a format/lookup check; no `source_kind` (operator/owner/federation) or content hash for change detection.
6. `price_check_site NOT NULL DEFAULT TRUE` is redundant; `year_built` bounds (1850) are fine.
7. Add a track status (open/closed/unknown) before importing data for facilities like Cochabamba.

## Recommendation for ~123 tracks
The research method is good at *finding* real quotes (0 fabricated of 69) but not reliable enough to apply unreviewed: ~10% of values had material problems (wrong page, personal data, superseded by a better official source, no-op "corrections"), and the second pass found information the first missed on 3 of 10 tracks.

Suggested rules:
- Auto-apply only values that (a) are `high` confidence, (b) have a quote that a second automated fetch re-confirms verbatim at the cited URL, (c) come from the venue/operator domain or owner/federation, and (d) are non-personal (generic venue phone/email, URLs, year, price range with currency).
- Never auto-apply: corrections to existing values, renames, personal/staff contacts, council general lines, `medium`/`low` confidence, any field where two official sources disagree, prices from club/event pages, opening hours not specific to the track.
- Always run a separate verifier that reloads the URL and prefers the operator's own site over municipal listing pages; flag conflicts instead of picking one.
- Keep unverified or rejected values out of the public table; write them to the sources/audit table only.
- Spot-check a random ~10% sample of auto-applied rows after each batch and halt if more than 5% fail.
- Re-verify quarterly; treat a changed page hash or non-200 as "stale", not "wrong".
