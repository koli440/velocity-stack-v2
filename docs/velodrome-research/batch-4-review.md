# Batch 4 independent review (2026-11-05)

Every cited URL was re-fetched; quotes, values, contact type and price sanity checked. Full verdicts: `batch-4-review.json`.

## Counts (68 reviewed values/corrections/confirmations/statuses)
- verified: 55
- rejected: 6
- unverifiable: 7
- error rate: 13/68 = 19% not verified (6/68 = 8.8% outright wrong). Concentrated in researcher-found prices, contacts and the "open" status inference.

## Notable errors
- **Reading Palmer Park price_range** GBP 4.50-6.50 built from lessons; the operator's price page shows drop-in 3.50-6.80. Fix supplied.
- **Falun price_range** max 1395 SEK is whole-track hire; per-rider range is 395-1150 SEK. Fix supplied.
- **Falun phone** is a mobile-format footer number conflicting with the /kontakt/ landline (023-799523). Falun opening hours also differ between home and /kontakt/ (conflict, unverifiable).
- **Hyères pricing_url** page only says "Tarifs: sur demande"; no prices.
- **Gera phone/email** belong to the resident club (SSV Gera), not the venue (source_kind `other`).
- **Penrose operator** claims more than the quote supports (only park ownership); the hijacked seed domain `penroseparkvelo.com` was independently confirmed as spam (correction verified).
- **Unverifiable "open" statuses**: Palmer Park (JS-only booking site), Oderlandhalle (no booking form found), Quibell (park hours only). Medellín and Gera operator claims are not stated on the cited pages.
- Quibell and Barcelona contacts are real but council/municipal-listing, so they go to needs-attention.

## Missed information (see `missed_info`)
- **Cali (important)**: after the 10 Aug 2026 earthquake the mayor reports "serious structural damage" to the velodrome roof (El Tiempo; official cali.gov.co notice not retrievable). Do not show as open; researcher recorded nothing.
- **Arima**: official SporTT pages give operator, opening 23 Jul 2016, phone/email, 250 m wood; but the venue is in Couva while the seed has Arima coordinates, so a human must decide the identity/coordinates.
- Bournemouth booking_url, Barcelona operator (Poc3 Velòdrom Horta), Gera year built 1957, Kokura `is_indoor = true` and free monthly bank-experience sessions, New Delhi SAI page, Roubaix redevelopment (researcher correctly avoided the STAB site).
- Chun'an, Dubai/Sharjah, Lusail: no official sources found; the researcher's `not_found` stands (existence of these venues stays unconfirmed).

Searched independently: 12 of 19 tracks (63%), covering all empty/least-covered ones.
