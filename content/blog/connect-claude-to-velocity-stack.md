---
title: Connect Claude to Velocity Stack and talk to your training
date: 2026-11-27
summary: Claude can now plan workouts in your Velocity Stack calendar and review your rides. How to connect it, what it can do, and what it can't see.
tags: guide, claude, ai, planning
---
I plan most of my training in my head on the way home from the track, and then it takes ten minutes of clicking to get it into the calendar. Reviewing a session is similar: the numbers are all there, but I have to go and look for them.

So Velocity Stack now has a connector for Claude. Once you connect it, you can ask Claude about your training in plain language. It reads your rides, fitness and calendar, and it can plan workouts for you. It uses your own FTP, zones and templates, the same numbers the app uses.

## Connect it in two minutes

You need a Velocity Stack account and a Claude account.

1. In Claude, open **Settings → Connectors** and find **VelocityStack** in the directory.
2. Click **Connect**. Claude sends you to Velocity Stack.
3. Sign in, read the list of permissions and press **Allow**.
4. Back in Claude, start a chat and ask about your training.

That's it. Nothing to install, no keys to copy. Each rider connects their own account, and Claude only ever sees the account that approved the connection.

If you use **Claude Code**, run `claude mcp add --transport http velocity-stack https://www.velocity-stack.app/api/mcp` and then `/mcp` to sign in.

## What you can ask

### Plan your week

**"Plan next week around my A race: two interval sessions, one long endurance ride, rest on Monday."**

Claude looks at your races, your recent load and what's already in the calendar, then adds the workouts with a full interval structure. It writes the structure in the same [interval syntax](/dsl-guide) you'd type yourself, for example:

```
warmup 15min
4x
work 8min @ 95-105%FTP
recovery 4min @ <55%FTP
cooldown 10min
```

Structured rides are then pushed to Garmin, Wahoo or Intervals.icu like any other planned workout, if you've turned that on. Each planned workout comes with the same estimated training load (~TL) you see in the calendar, so Claude can balance the week properly.

It can also move, skip, edit and delete workouts. Claude asks you before it changes anything in your calendar.

### Review a ride

**"How did yesterday's ride compare with the planned workout? Find the intervals and their power."**

Claude can open an activity and see the summary, power and heart-rate peaks, time in zones, splits, and the planned workout it completed. It can run your [analysis templates](/analysis-templates) on the ride and read every interval the template found. The result is stored exactly as if you had run the template yourself, so it's in the app afterwards too.

### Check fitness and form

**"Show my fitness, fatigue and form for the last six weeks and tell me whether I'm ramping too fast."**

Fitness (CTL), fatigue (ATL), form (TSB) and the weekly ramp come from the same calculation as the Fitness page.

### Keep races and notes up to date

**"Add the national championships on 14 June as my A race, and note that I'm travelling from 2 to 5 June."**

Claude can read and edit your races (A, B and C priority) and your day notes: sickness, travel, availability. Those are exactly the things a plan should take into account, and now Claude does.

### Adjust when life happens

**"My form is very negative. Move Thursday's VO2max session to Saturday and make Thursday an easy spin."**

This is the part I use most. Plans change, and saying it in one sentence is quicker than rebuilding the week by hand.

## For coaches

If you coach athletes on Velocity Stack, Claude can plan in your active athletes' calendars too: workouts, races and notes, with the same rules as in the app. Workouts you plan this way are marked as set by the coach. Reading activities and fitness through Claude works on your own account only for now.

## What Claude can and can't see

- Claude only sees what the connector returns, for the account that approved it. **GPS tracks, email addresses and connection keys are never shared.**
- Velocity Stack doesn't receive your Claude conversations. It only logs which tools changed data, to keep the service secure.
- The consent page lists exactly what Claude asks for: your profile (FTP, weight, zones), your calendar (planned workouts, races, notes), and your activities and fitness.
- You can disconnect at any time on the [Connections](/connections) page, and access stops immediately. You can also remove the connector in Claude.

The full list of tools and permissions is on the [Claude page](/claude).

## Try it

Connect it, then ask Claude what your last week of training looked like. That's a good way to see what it can do.

If something doesn't work, or you'd like Claude to be able to do something it can't yet, tell me on the [feedback](/feedback) page.
