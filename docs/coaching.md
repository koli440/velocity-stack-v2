# Coaching (step 2: relationships, consent, read access)

- Any account can coach; no flag. Either side initiates (coach: *Invite as athlete*, rider: *Request as my coach*);
  the rider's acceptance (or own request) is the consent. Self-coaching and blocked pairs are refused. Bots are allowed (see *Coaching with bots*).
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
Context is URL based, never stored (`src/lib/coachContext.js` parses/builds the paths):

| Route | Shows |
|---|---|
| `/coach` | Dashboard: athletes with last activity, 7-day sessions/time/distance/load, pending invites |
| `/coach/<id>` | Overview: current FTP / weight / LT1 / LT2 (with coach badges), recent activities, audit list |
| `/coach/<id>/calendar` | `ActivityCalendar` for the athlete (replaces step 2's `/calendar?rider=`, which redirects) |
| `/coach/<id>/activities[/<activityId>]` | Athlete activities (masked `shared_activities`) and detail |
| `/coach/<id>/pb-vault`, `/templates` | Read-only lists (coach access is SELECT-only) |
| `/coach/<id>/physiology` | The four history panels + gear defaults, editable by the coach |

- `app/coach/[riderId]/layout.js` checks `get_athlete_profile` (which only answers for an active coach), shows the
  persistent indigo banner "Coaching: <Name> - Exit" and the athlete tab bar; anyone else sees "not coaching".
- The top-right user menu has a "Viewing as" section (Me + athletes, only when the user has athletes).
- In athlete context (`/coach/<id>/...`) the sidebar/mobile drawer shows ONLY athlete pages (Overview, Activities, Calendar,
  Personal Bests, Templates, Physiology) plus "Coach dashboard" (`sidebarItems`). The coach's own pages are hidden: telemetry,
  tools, About/Feedback, own settings, search, Add/Sync, notifications bell, footer links, admin link (`chromeVisibility`).
  Leaving is always explicit: banner "Exit" / "Coach dashboard", and the user menu "Viewing as" (Me / athletes / Coach dashboard).
  In-page links of reused components (calendar chips, activity detail back link, template runs, curve tooltips) keep the
  context via `contextualHref` / `activityBackHref`. The Coach/Rider toggle was removed.
- Rider side: history rows and the "Gear defaults" heading show a "Set by coach <name> - date" badge
  (`CoachBadge`), settings lists the audit trail ("Coach changes"), and the `coach_edited` notification links to
  `/settings#physiology`.
- All of this is convenience only; every write is checked by RLS / SECURITY DEFINER functions (see above).

Choices made: "weekly volume" is the last 7 days; PBs/templates are read-only in athlete context; activity detail
opens the existing page (which falls back to the masked view) under `/coach/<id>/activities/<activityId>`.

## Coaching with bots (`20261201000000_coaching_with_bots.sql`)
Testing aid, since no real people are available. Bots cannot answer requests, so the SECURITY DEFINER paths answer for them:
- `invite_athlete(bot)`: the bot (rider) accepts at once. Same atomic logic as `accept_coaching` (shared internal
  `coaching_accept_as`): an existing coach of the bot is replaced and notified (`coach_replaced`), the inviter gets `coach_accepted`.
  So any user can take over a bot athlete; that is intended for a shared test fixture.
- `request_coach(bot)`: the bot (coach) accepts at once; still refused while the rider already has a coach.
- Bots never initiate (refused in `create_coaching_request`), blocks (either direction) look like "Rider not found",
  self-coaching and one-active-coach-per-rider hold. `coaching_accept_as` and `create_coaching_request` are not client-callable.
- Coach dashboard, `/coach/<botId>`, calendar and physiology edits work on the bot's generated rides; the bot receives
  `coach_edited` notifications (harmless).
- A bot coach edits a rider's data via the SQL-only `bots_coach_edit` (see docs/bots.md), executable by `service_role`/migrations only.
