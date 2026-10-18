# Onboarding and "What's new" (issue #244)

## Writing a news entry
Every **user-visible feature or notable fix** adds one markdown file to `content/news/` in the same PR. Entries ship with the deploy; there is no admin UI and no secrets are involved.

File name = id = `YYYY-MM-DD-short-slug.md` (lowercase letters, digits, hyphens; the date is the publication date):

```
---
id: 2026-12-20-example-feature
date: 2026-12-20
title: Short, plain title (max 100 characters)
link: /calendar                 # optional: in-app path or https URL
linkLabel: Open the calendar    # optional, default "Learn more"
image: /news/example.png        # optional: file in public/ or https URL
imageAlt: Describe the image    # optional
---
One or two short paragraphs about what the rider can do now.

- Bullets are fine.
- **Bold**, `code`, [links](/dsl-guide) and ``` code blocks ``` work. Nothing else (no HTML).
```

Rules:
- English only. Everyone gets every entry (no targeting).
- The `id` must equal the file name and start with `date`; ids sort chronologically, and "unseen" means `id > news_seen_through`.
- Use today's date or later. Entries dated before a user's "seen up to" marker are never shown to that user in the login modal (they stay on the page).
- Malformed files fail `npm test` and the build (`src/lib/__tests__/news.test.js` loads every file).

## How it shows up
- **Login modal:** all unseen entries as one list, newest first; "Got it" (or closing) marks them all seen. A new account sees the welcome tour first and no news backlog.
- **What's new page** `/whats-new`: every entry; opening it marks all seen.
- **Bell:** a "What's new" row at the top of the dropdown with an "N new" pill, counted in the bell badge until seen.
- **Help** (user menu): *Getting started* (reopens the tour), *What's new*, *Template syntax guide*.

## Onboarding
- Welcome tour (`WELCOME_STEPS` in `src/lib/onboarding.js`): skippable, reopenable from Help, shown once to new accounts.
- Getting-started checklist on the dashboard (`CHECKLIST_ITEMS`): connected source, first ride, FTP, weight, first template run, privacy zone. Ticks are **derived from real data**
  (`fetchOnboardingFacts`, every query filtered by the signed-in user) and are never stored. The card stays until complete or dismissed.
- Existing accounts at the time of the migration are *not* put through onboarding (tour done, checklist dismissed) and have all older news marked seen; they can open the tour from Help.

## State (`20261211000000_user_onboarding_state.sql`)
`user_onboarding_state(user_id PK -> profiles ON DELETE CASCADE, welcome_seen_at, onboarding_dismissed_at, news_seen_through TEXT, created_at, updated_at)`.
- RLS: SELECT and UPDATE of the own row only (`user_id = auth.uid()`). No coach or admin policy (personal UI state), no client INSERT/DELETE. Column-level UPDATE grant on the three state columns.
- Rows are created by trigger on new profiles (tour pending, news seen up to now) or by `ensure_my_onboarding_state()` (caller's own row only). The migration backfills existing profiles once (`ON CONFLICT DO NOTHING`).
- `news_seen_through` only moves forward (trigger). Existing/new accounts start at `<today>~` (floor: the migration date), which sorts after every id of that day.
- The client always uses the signed-in user's id from the session, also inside coach/athlete-context routes, where the welcome/news modals and the checklist are disabled (`OnboardingProvider enabled`) so nothing is ever shown as the athlete's state.

## Verification of the migration (scratch Postgres)
Apply the migration twice on a scratch Postgres with stub `auth.uid()`, `anon`/`authenticated` roles and a `profiles` table; check: backfill marks existing users dismissed, new profiles are pending,
a user reads/updates only their own row, cannot reassign `user_id`, insert, delete, or move the marker backwards, and `anon` has no access.
