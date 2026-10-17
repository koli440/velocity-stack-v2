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

## Step 3 notes
Coach edits of thresholds/weight will add `changed_by`/source columns to the history tables ("set by coach").
Coach UI: `/calendar?rider=<id>` is minimal wiring only.
