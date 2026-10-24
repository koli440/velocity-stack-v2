# Import help (`/import-help`)

Static help page (`src/app/import-help/page.js`) explaining how to get `.fit` files off an SRM PowerControl 8 (and PC5/6/7 via SRM X) for the bulk import (`BulkImportModal`). Content is taken from the SRM PC8 user manual v1.6 (USB mass-storage drive `SRM_PC8`, rides in `SRM/Activities`); the SRM X "Export as…" step for older units comes from TrainingPeaks' SRM help, not the manual.

Linked from the bulk import modal, the empty-feed welcome card and the Help menu. No secrets or migrations.

## Known gaps (PC8 files through `api/analyze.py`)
- No GPS/speed sensor: speed and distance are only derived (from cadence + gear) when the batch is marked fixed-gear and a gear is given; the modal marks fixed-gear when a velodrome is chosen. Otherwise `speed_source = 'unavailable'` and distance/speed are stored as null (no import error).
- FIT `lap` messages are not read; laps are not stored.
