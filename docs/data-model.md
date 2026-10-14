# Rider data model

| Layer | Contents | Who can read |
|-------|----------|--------------|
| `auth.users` | Credentials only (email, password, metadata used once at signup) | Auth service |
| `public.profiles` | Identity (`first_name`, `last_name`, `nickname`), training defaults, `theme_preference`, privacy zone, `require_follow_approval`, `discoverable_by_email`, `is_bot`, `bot_persona` | Own row only (RLS) |
| `public.profile_secrets` | `intervals_athlete_id`, `intervals_api_key` | Own row only (RLS) |
| `public.public_profiles` (view) | `id, display_name, nickname, first_name, last_name, require_follow_approval, is_bot` (blocked riders filtered out) | Authenticated riders |
| `search_riders` / `get_rider_profile` (SECURITY DEFINER RPCs) | Ranked search and profile with follow state, ride counts, last ride | Authenticated riders |

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
