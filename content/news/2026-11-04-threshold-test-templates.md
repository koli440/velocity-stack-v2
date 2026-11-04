---
id: 2026-11-04-threshold-test-templates
date: 2026-11-04
title: Threshold test templates estimate FTP and LT1/LT2
link: /dsl-guide
linkLabel: Template syntax guide
---
New system templates evaluate threshold tests and propose your FTP and lactate thresholds (power and heart rate): FTP 20 min and 8 min tests, a ramp test, a 30 min LT2 / LTHR test and a steady-state LT1 test.

- Every estimate shows its protocol, source window, assumptions and a confidence note, and warns when a test does not look maximal.
- Build your own with the new `estimated_ftp`, `estimated_lt2_power`, `estimated_lt2_hr`, `estimated_lt1_power` and `estimated_lt1_hr` metrics.
