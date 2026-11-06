# Activity reactions ("Respect")

A lightweight +1 on activities. Migration `20270138000000_activity_reactions.sql`; UI in `ReactionButton` / `ActivityReactions` (activity page header, next to the date tile) and `ActivityFeed` (cards,
also in coach athlete views); helpers `src/lib/activityReactions.js`. The icon is `flame` from the shared icon set (`src/lib/iconSet.js`).

- **Who:** anyone who can see the activity (same helper as comments: public, followers, active coach, blocks win). Not your own activity; bots cannot react.
- **Toggle:** tap to give, tap again to remove. Unique (activity, user, type) makes repeats idempotent.
- **Counts:** `activity_reaction_info` only returns activities the viewer can see, so coaches use the same coach-safe path as comments and nothing leaks from private activities.
- **Owner:** sees who reacted (`activity_reactors`, names from `public_profiles`).
- **Notifications:** one `activity_reaction` per (owner, activity) while unread; further reactors bump `event_count` ("ann and 3 others gave respect") without re-pushing.
  A reactor notifies at most once per activity, so un/re-toggling never re-notifies. In-app, push and email follow the normal notification rules.
- **Settings:** `profiles.reactions_enabled` (accept new reactions) and `profiles.reaction_notifications` (off = no notification rows at all).
- **Abuse:** 60/hour and 300/day per rider, error `limit reached`.
- **Tests:** `src/lib/__tests__/activityReactions.test.js`; SQL: `scripts/db-harness/reactions-adversarial.mjs`.
