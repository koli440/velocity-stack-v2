# Batch 2 independent review

Reviewed 2026-11-05. Detail: `batch-2-review.json`.

## Counts

172 items re-fetched (fields, extra evidence, operating status, corrections, confirmations):

| verified | unverifiable | rejected | error rate |
|---|---|---|---|
| 165 | 6 | 1 | 4.1 % (7/172) |

161 quotes matched literally on first fetch. 10 Carson items were HTTP 406 to curl and were re-verified with a browser-style fetch. The Bordeaux price PDF was verified via text extraction.

## Slice check

Match: 19 tracks, identical to the migration-derived slice (sorted case-insensitive, pilot excluded, index mod 6 == 2). Quirk: the pilot names a track "Novo Mesto - Velodrom Novo Mesto" but the migration name is "Velodrom Novo Mesto". Exclude by migration name or the slice shifts.

## Notable errors

- **Heusden-Zolder price_range (rejected):** 6.50–11 EUR are bike-rental fees. Session tickets are 13.00 / 9.50 EUR (members of partner federations); correct range 9.50–13 EUR.
- **Alkmaar email (unverifiable):** the site shows two different addresses (`sportpaleisalkmaar.nl` on /contact/, `sportpaleis-alkmaar.nl` on /vrij-trainen/).
- **Bordeaux operator (unverifiable):** cited quote is a nav list; legal page only says the site owner is "société récréa".
- **Carson year_built 2003 (unverifiable):** that is the complex opening, not the VELO.
- **Jakarta operator "PT Jakarta Propertindo" (unverifiable):** cited page does not state it. Jakarta status also unverifiable (calendar did not load).
- **Santiago status (unverifiable):** based on 2025 championship news; velodromo.cl contact page is better evidence.
- Pattern repeated from the pilot: price ranges mixing rental, intro or ancillary prices (Heusden-Zolder, Roubaix 25 EUR intro, Alkmaar 28 EUR clinic incl. rental, Aigle 90 CHF combo from a different page than cited).

## Needs attention (not for auto-apply)

- Corrections: Detroit name (Mad Track Arena), Linz is_indoor→false and rename (no official link between "TipsArena" and the hello yellow velodrome; seed identity question), Noto surface → "Resin (…)" is not in the surfaces lookup (FK on `tracks.surface`), so it needs a lookup value first.
- Mobile-format numbers published as organisational contacts: Bordeaux (06), Linz (+43 664). Alkmaar phone correctly not recorded; Noto gmail and Santiago/Jakarta mobiles correctly excluded.
- Hours that are venue-wide or training-only (Heusden-Zolder, Detroit, Alkmaar, Linz after intro course); Frankfurt/Jakarta year_built refers to the hall/original track, not the current track.

## Missed info (searched 7 of 19 tracks, 37 %)

Noto, Santiago, Milano, Jakarta, Linz, Bordeaux and Frankfurt were searched independently. Findings (see `missed_info`): Santiago federation licence e-mail and Estadio Nacional "no operativo" notice (low confidence, third-party site), Linz club (Verein Velodrom Linz) runs the courses, Noto municipal ownership, Frankfurt fee ordinance (2015, no public track prices), Jakarta WhatsApp (excluded), Bordeaux no booking URL found. No conflicting official pricing found beyond the above.
