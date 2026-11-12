---
title: "How to link Fitbit to Strava, and then to VelocityStack"
date: 2026-11-12
summary: Fitbit rides can reach Strava through the accounts' own link. From there, connect Strava or import its export to analyse them in VelocityStack. What works and what does not.
tags: guide, fitbit, strava, import
---
People often ask how to get a Fitbit's rides into a proper analysis tool. VelocityStack has no direct Fitbit connection, but there is a route: Fitbit to Strava, then Strava to VelocityStack.

## Step 1: link Fitbit to Strava

Strava can pull activities from Fitbit. In the Strava website open **Settings**, then the section for connected apps and devices, choose Fitbit and sign in to approve access. Menu names change from time to time, so look for Fitbit in Strava's list of compatible devices if you cannot find it.

Once linked, new Fitbit activities show up in Strava on their own.

## Step 2: bring them into VelocityStack

You have two options:

- **Connect Strava** on the [Connections](/connections) page. New rides arrive automatically.
- **Export your Strava data** and import the ZIP for your history, as described in [How to export your Strava data](/blog/export-strava-data).

Create a free account first if you do not have one; the [Strava import guide](/import/strava) has the whole path.

## What to expect

- Fitbit rides rarely have power. VelocityStack estimates training load from heart rate when a ride has no power, and labels it as an estimate.
- Only activities that Strava holds as `.fit` files can be imported from a Strava archive; rides stored as `.gpx` or `.tcx` need the Connect Strava route.
- Strava limits how much its API may be read, so a long history can take a while to arrive when you connect.

Prefer a bike computer that records power? [Garmin](/import/garmin) and Wahoo connect directly.
