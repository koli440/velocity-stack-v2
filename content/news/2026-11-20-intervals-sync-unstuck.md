---
id: 2026-11-20-intervals-sync-unstuck
date: 2026-11-20
title: Intervals.icu sync no longer stalls on a single bad ride
link: /settings
linkLabel: Open Connections
---
A ride without data in Intervals.icu (for example a Strava-linked or manual entry) could stop the whole history import with a misleading "credentials rejected" message. Such rides are now skipped and reported, the import carries on, and affected connections resume automatically.
