# Batch 5 independent review

Reviewed 2026-11-05. Every cited URL re-fetched; quotes text-matched and read in context (hants.gov.uk returns 403 to curl, confirmed via web_fetch).

## Result
- Total sourced records: 146
- Verified: 132
- Unverifiable: 7
- Rejected: 7
- Error rate: 14/146 = 9.6% (pilot: 9/69 = 13%). All quotes exist on the live pages; errors are about what the quote supports.

## Rejected
- Indianapolis `email`: mailto href is a named staff address (jhoopingarner@marian.edu), not an organisational mailbox.
- Indianapolis `booking_url` and `pricing_url`: both point to the single $50 Track 101 clinic, not a booking or tariff page.
- Redmond `price_range` 5-30 USD: mixes a suggested $5 spectator donation with $30 race entry.
- Sola `price_range` 85-160 NOK: arena day passes; the page says they give no track access.
- Třebešín `price_range` 1000-3300 CZK: mixes a coaching session with a course fee.
- Třebešín `year_built` 1941: year of the first velodrome on the site, not the current track.

## Unverifiable
- Zurich `operator` IGOR: the page says only that it organises races. The City of Zürich has owned the track since 1951.
- Saint-Denis `year_built` 1928 (source says 1928-30, inaugurated 1933), `surface` Concrete (heritage text about the original build) and `phone` (tourisme93 lists the same number as the Club Vélocipédique Dionysien line).
- Bassano `surface`: the federation says "RESINA/CEMENTO".
- Indianapolis `is_indoor`: the quote does not mention indoor or outdoor.
- Třebešín `opening_hours`: the Monday course is not on the cited page.

## Verified with caveats
- Redmond `opening_hours`: the cited FAQ covers only open-track times. Race nights are on /about-track-racing/ (source_url_fix given).
- Calshot, Brisbane and Bassano `operator` are inferred from site or domain branding. Calshot length 142 (seed 143) is confirmed.
- The Brisbane, Glasgow, Newport and Perth phones are shared venue or reception lines (organisational, medium).
- Cottbus length 333.33 (seed 250) is confirmed by the owner site and the club site. Source_kind should be club/owner rather than the researcher's label.
- Konya and Lviv `operating_status` "unknown": no claim made. Lviv has no source.

## Missed / searched
- No new high-value official info was found for Konya, Lviv, Bassano, Cottbus, Melbourne DISC, Saint-Denis, Newport or Glasgow. Details are in `searched_without_new_findings`.
- Recorded `missed_info` entries are corroborations and conflicts: Sola day-pass caveat, Zurich owner, Cottbus owner length, Saint-Denis phone conflict and the Calshot length.
- Saint-Denis `is_indoor=true` in the seed looks wrong (open-air layout). This is a lead only; no official source was found.

## Auto-apply notes
Do not auto-apply any rejected or unverifiable record. Corrections (Cottbus, Calshot, Saint-Denis) need attention. Phones with medium confidence stay below the auto-apply threshold.
