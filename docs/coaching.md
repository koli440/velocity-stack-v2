# Coaching (step 2: relationships, consent, read access)

- Any account can coach; no flag. Either side initiates (coach: *Invite as athlete*, rider: *Request as my coach*);
  the rider's acceptance (or own request) is the consent. Self-coaching, bots and blocked pairs are refused.
- A rider has at most one active coach. Accepting a new coach's invite swaps atomically (advisory lock + unique
  index); the UI warns first, naming the coach being replaced, and that coach gets a `coach_replaced` notification.
  `request_coach` is refused while the rider already has a coach, so a coach's acceptance never replaces one.
- Access has no expiry. The rider revokes, or the coach leaves (`end_coaching`); a block ends it.
- Declines are silent (declined rows look "pending" to the requester, 30-day re-request cooldown, max 25 pending per user).

## Privacy rules
- Coaches read everything of the athlete, including private activities, curves, templates, PBs and histories.
- Activities are read only via `shared_activities`: privacy-zone coordinates stay masked exactly as for other riders;
  raw GPS and `raw_file_url` never leave the owner-only `activities` table.
- Never exposed: connection tokens, `profile_secrets`, email. `get_athlete_profile` returns training fields only.
- Known gap: `shared_activities` does not expose later snapshot columns (e.g. `ftp_at_activity_w`).

## Coach edits (step 3, `20261130000000_coach_edits.sql`)
Consent is wide: besides reading everything, the ACTIVE coach (`is_coach_of`) may write the rider's physiology and
training settings, and **only** those:
- `ftp_history`, `weight_history`, `lactate_threshold_history`, `power_zone_history`: extra INSERT/UPDATE/DELETE RLS
  policies (`*_coach`) next to the `*_own` ones, both USING and WITH CHECK require `is_coach_of(user_id)`.
  Moving a row to another rider is refused by trigger. Derived values (activity FTP/weight/zone snapshots, IF, TL,
  `profiles.ftp_w`) follow through the existing SECURITY DEFINER triggers.
- Profile training defaults (`home_track_id`, `default_chainring`, `default_cog`, `crank_length_mm`): only through
  `coach_update_athlete_profile(p_rider, p_changes jsonb)`. There is no coach UPDATE policy on `profiles`; any other
  key (FTP mirror, privacy zone, admin flag, names, avatar...) is rejected.
- Never writable by a coach: activities, connections, secrets, templates, PBs, aero tests, follows, blocks,
  relationships, notifications.

**Labelling and audit.** Triggers stamp `changed_by`, `changed_at`, `set_by_coach` on every history row (and
`training_set_by/at/by_coach` on the profile) from `auth.uid()`; client-supplied values are overwritten, so they cannot be
forged. An edit by the rider clears the label. Every coach edit is also written to `coach_edits` (rider_id, coach_id,
table, row, action, old/new values). The rider reads all of it, a coach only their own edits while the relationship is
active; no client can write the table. The UI shows a "set by coach" badge where those values appear.

**Notifications.** A coach edit creates a `coach_edited` notification for the rider. At most one *unread* one exists per
coach/rider (partial unique index); further edits only bump its timestamp, so editing is never spam.

**Revocation** takes effect immediately: `is_coach_of` is evaluated on every statement.

## Coach UI (step 3)
Context is URL based, never stored: `/coach` (dashboard), `/coach/<riderId>` (overview) and
`/coach/<riderId>/<page>` (calendar, activities, templates, PBs, physiology settings ...) show the athlete's data;
feed, notifications and own settings stay the coach's. `coach_dashboard()` returns one row per active athlete
(last activity, last 7 days count/time/distance/load). Pending invites come from `my_coaching()`.
