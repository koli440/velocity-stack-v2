---
title: Why I built Velocity Stack (it started with a spreadsheet)
date: 2026-11-06
summary: How a spreadsheet of gears and race records turned into an app for track cyclists, and why I rebuilt it around one idea.
tags: story, track-cycling, templates
---
When I started riding the track, I realised quickly that I had to think about a completely different set of things than on the road. Gears. Pacing. Aero. Which track I was riding, and how to shave a few tenths of a second off an effort.

So I did what most of us do. I started a spreadsheet. What gear I'd used and when, what speed I'd be doing at a given cadence, and a record of every ride and race.

It worked until it didn't. After a while it was overwhelming, and the sheet was almost impossible to open and edit from the infield in the middle of a session. Somewhere around then I thought: this could be a simple app. Something that does the gearing maths and keeps my records, and that other riders could use too.

## Version one

That was the first Velocity Stack. A small app where I saved my personal bests, calculated my gears and compared them with other riders.

What I didn't expect was how much it mattered to simply have the history. You always think you'll remember a race. After a while you don't. Knowing which gear I rode on this particular track last time took a lot of guesswork out of the next race.

## It worked for a while. Then I wanted more.

Version one did what I'd built it for. It kept my records and did my gearing maths. But the more I trained, the more I noticed it only covered half of the picture: the races and the numbers I wrote down. It said nothing about the training that led to them.

I wanted to track the training itself. Not just "what gear did I ride", but "how did that session go, and is it better than the last one?" That's a different kind of tool, and it needed a different idea.

## The idea that started version two

My coach told me that in intervals I needed to ride "in the upper half". So I started comparing my efforts: could I hold my average in the top half of the interval, and could I ride the same interval at a higher average than last time?

That was the question I couldn't answer well anywhere. You can mark intervals by hand in most platforms. Some platforms can find intervals automatically. But none let me say, "this is the session I planned, find it in my ride, and measure it the way I described it."

It isn't hard to do, and it's what I'd wanted all along: describe the workout once, then evaluate the ride using the same description. Plan it, then analyse it, with one definition. I called these [analysis templates](/dsl-guide), and they're the reason I started building version two.

And because every run of a template is stored, the comparison comes for free. The moment you apply a template to a ride, you see how those efforts stack up against every other ride where you used the same template. Not "I think I was stronger last month", but the actual numbers side by side.

You're also not limited to one template per ride. Apply as many as you like to the same session: the intervals, the opening sprint, the best five minutes. Each is measured on its own and compared with its own history.

Then I moved everything from version one across: gears, personal bests, records.

## Where it is now

Once templates were working, I noticed that most of what other platforms do isn't hard to build either. So I added a social side, so you can follow other riders. Then I went back to the track: gears, personal bests, velodromes and races, all connected so you can compare them with each other.

I use it every day to plan, train and analyse, together with my coach and with other riders. It's still rough in places, but it's solid enough that I trust it with my own training.

If you ride or coach on the track, you could [try it yourself](/track): create a template for a session you do often, run it on one of your rides and see what it finds. I'd like to hear what you'd want to measure. And if you have your own spreadsheet story, I'd love to read it.
