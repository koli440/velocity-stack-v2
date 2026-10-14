# Rider data model

| Layer | Contents | Who can read |
|-------|----------|--------------|
| `auth.users` | Credentials only (email, password, metadata used once at signup) | Auth service |
| `public.profiles` | Identity (`first_name`, `last_name`, `nickname`), training defaults, `theme_preference`, privacy zone, `require_follow_approval`, `discoverable_by_email`, `avatar_url`, `is_bot`, `bot_persona` | Own row only (RLS) |
| `public.profile_secrets` | `intervals_athlete_id`, `intervals_api_key` | Own row only (RLS) |
| `public.public_profiles` (view) | `id, display_name, nickname, first_name, last_name, require_follow_approval, is_bot, avatar_url` (blocked riders filtered out) | Authenticated riders |
| `search_riders` / `get_rider_profile` (SECURITY DEFINER RPCs) | Ranked search and profile with follow state, ride counts, last ride | Authenticated riders |

## Profile image
`profiles.avatar_url` holds the public URL of the rider's image in the public `avatars` storage bucket
(`<user_id>/avatar-<timestamp>.<ext>`; max 10 MB, JPEG/PNG/WebP, enforced by the bucket; limit raised from 2 MB by `20261023000000_avatar_size_limit.sql`). Storage RLS lets
a rider insert/replace/delete only objects under their own `<user_id>/` prefix, and a CHECK constraint only
accepts URLs pointing at that folder. Images are uploaded as-is and cropped with CSS (`Avatar` component,
square + `object-cover` + rounded); without an image an initials placeholder is shown. `avatar_url` is
returned by `public_profiles`, `search_riders` and `get_rider_profile`. Migration `20261022000000_profile_images.sql`.

## Display name
`display_name = nickname`, else `first_name + last_name`, else `'Rider'`.
Users without any name were backfilled with their e-mail local-part as nickname.

## Signup
A trigger on `auth.users` (`handle_new_user`) creates the profile from `options.data`
(`first_name`, `last_name`) so a signup can never leave an account without a profile.
The register page no longer upserts the profile itself.

## Search
Nickname / first / last name: trigram match. E-mail: **exact, case-insensitive, full address only**,
evaluated inside the RPC against `auth.users`; the e-mail is never returned, at most one result,
blocks respected.

### Privacy decision (please review)
Exact e-mail search lets a signed-in user confirm whether an address has an account (enumeration).
Mitigations: exact match only, one result, no e-mail in output, and the opt-out
`profiles.discoverable_by_email` (default `true`, toggle in profile settings).
Consider rate limiting at the API gateway if abuse appears.
Backfilling nicknames from e-mail local-parts makes that part publicly visible as a display name.

## Migration
`20261020000000_profile_model.sql` backfills names (metadata, `full_name` split, e-mail local-part)
and copies `intervals_*` into `profile_secrets` **before** dropping the old columns; it is idempotent.

## Activity provenance and duplicates
`20261025000000_activity_sources.sql` adds to `public.activities`: `source` (`manual`|`intervals`|`strava`|`bot`,
default `manual`), `external_source` and `external_id` (platform activity id; both set or both null).
`uq_activities_user_external` is a unique partial index on `(user_id, external_source, external_id)` where
`external_id IS NOT NULL`. The `BEFORE INSERT` trigger `guard_activity_duplicate()` rejects (SQLSTATE `23505`) a new
activity whose `file_sha256` matches, or whose `start_time` and `elapsed_time_s` are both within 5s, of an existing
activity of the same user - unless the new source outranks it (`activity_source_priority()`: intervals 3 > strava 2 >
other 1), so an Intervals.icu import can replace a Strava copy. Existing rows are never checked.
Client mirror: `sourcePriority` / `resolveDuplicate` in `src/lib/activityDuplicates.js`.
