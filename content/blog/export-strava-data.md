---
title: "How to export your Strava data (and keep your rides)"
date: 2026-11-12
summary: Step by step: request your Strava archive, what is inside the ZIP, and how to import the rides into VelocityStack without unzipping anything.
tags: guide, strava, import
---
Sooner or later every rider wants their own copy of their rides. Maybe you are switching tools, maybe you just like having a backup. Strava lets you export everything, and it is not hard once you know where the button hides.

## Request your archive

1. On the Strava website (not the app) open **Settings**, then **My Account**.
2. Under **Download or Delete Your Account** choose **Get Started**.
3. Pick **Request Your Archive** under the download option.
4. Wait for the email from Strava with a download link. It usually arrives within a few hours.

Menu names move around from time to time, so if you cannot find it, search Strava's help for "export your data".

## What is inside the ZIP

The archive holds your profile data and an `activities` folder with one file per ride. Rides recorded with a bike computer are `.fit` files (often gzip-compressed as `.fit.gz`). Rides recorded with the Strava phone app usually come as `.gpx` or `.tcx`.

## Import it into VelocityStack

You do not need to unzip it. In VelocityStack choose **Add session**, then **Import History**, and select the ZIP. It reads the `.fit` and `.fit.gz` files inside, skips everything else, and ignores rides you have already imported.

Rides that only exist as `.gpx` or `.tcx` are not imported from the archive. For those, [connect Strava](/import/strava) instead.

## Why not just connect Strava?

You can, and it works well for new rides. But Strava limits how much its API may be read, and that budget is shared by every rider, so a long history arrives slowly. The export is the quick way to bring in years of rides at once; connecting keeps you up to date afterwards.

Full walkthrough with FAQ: [Import your Strava rides](/import/strava). Other sources: [Garmin](/import/garmin) and [.fit files](/import/fit).
