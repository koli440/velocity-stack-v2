# Activity comments (epic #222)

Riders and coaches can comment on activities. Shipped in #223 (schema/RLS/notifications), #224 (UI), #225 (realtime/unread),
#226 (moderation). Migrations: `20261204000000_activity_comments.sql`, `20261212000000_activity_comment_ui_rpcs.sql`,
`20261214000000_activity_comment_moderation.sql`, `20261215000000_activity_comment_reads_realtime.sql`.

## Model
| Object | Purpose |
|--------|---------|
| `activities.comments_enabled` (bool, default true, also for existing rows) | Owner's per-activity switch. Off = no new comments; existing ones stay readable. No profile-level default. |
| `activity_comments` | `id, activity_id, user_id, body (1..2000 trimmed chars), reply_to (nullable, reserved for threading; the UI shows a flat stream), created_at, edited_at`. Cascades with the activity and the author. |
| `activity_comment_mentions` | `(comment_id, user_id)`, rebuilt by the server on every create/edit. |
| `activity_comment_log` | Rate-limit ledger (no client access). |
| `comment_reports` | Reports with a body snapshot, status `open/dismissed/removed`, unique per (comment, reporter). No client privileges. |
| `activity_comment_reads` | Per rider and activity read marker; the rider can select only own rows. |

## Who can read and write
`user_can_view_activity(user, activity)` / `can_view_activity_comments` decide access:
- the **owner**, always;
- the owner's **active coach** (`is_coach_of_activity_owner`), also on **private** activities (such a thread is visible to owner + coach only);
- everybody else per `activities.visibility` (`public`, `followers` for accepted followers);
- **blocks in either direction win**: a blocked/blocking rider cannot see the activity, and the other side's comments are hidden
  (SELECT policies, counts and mentions).
- An **ex-coach** (relationship not active) has no special access any more.

Reads are plain SELECT through RLS. **Writes are only through SECURITY DEFINER RPCs**; clients have no INSERT/UPDATE/DELETE:
- `add_activity_comment(activity, body, reply_to)`: needs view access and `comments_enabled` (the owner's own activity too);
- `edit_activity_comment`: author only, sets `edited_at`;
- `delete_activity_comment`: the author or the activity owner (a coach cannot delete others' comments).

If an activity becomes private again, comments are **kept**: owner and coach keep access, everybody else loses it together with the activity.

## Rate limit and sanitising
- 30 comments per hour per rider (`activity_comment_log`), error `limit reached` -> "You are commenting too fast".
- 20 reports per hour per rider.
- Trigger `clean_comment_body` strips control and bidi-override characters and re-validates the length. The UI renders plain text only
  (no HTML); mentions are linked by `splitCommentBody` only when the server recorded them.

## Mentions
`@nickname` is parsed server-side (`sync_comment_mentions`). Only users who **can see the activity** are stored/notified. The UI
autocomplete uses `activity_mention_candidates(activity, query)` which returns only such riders (not blocked, can view, never self). A bare `@` opens the list at once with the relevant people (activity owner, owner's/own coach, riders you follow, your athletes when you are a coach, earlier commenters); typing filters by nickname prefix and then also offers other riders who can see the activity (`20261216000000`).

## Notifications (in-app only)
- `activity_comment`: to the owner, the active coach and earlier commenters (who can still see the activity), never to the author.
  **One unread per (user, activity)**: further comments update the existing unread notification instead of adding rows.
- `comment_mention`: to mentioned users who can see the activity; also one unread per (user, activity, type).
- The bell links to the activity comments (`activityCommentsHref` keeps a coach inside the athlete context).

## Realtime and unread (#225)
- `activity_comments` is in the `supabase_realtime` publication; RLS applies to events, `subscribeActivityComments` refetches on change.
- `mark_activity_comments_read(activity)` upserts the marker; `activity_comment_unread(ids)` returns unread counts (other riders'
  comments newer than the marker, visible to the viewer; no marker = all unread); `coach_unread_comments()` per coached athlete.

## Moderation (#226)
- Owner toggle "Turn comments off/on" on the activity (updates `comments_enabled` under the owner's RLS update policy).
- Any rider who can see a comment may `report_activity_comment(comment, reason)` (not own, once per comment).
- Admins: `/admin/comment-reports` (link from admin suggestions) using `admin_list_comment_reports` and
  `admin_resolve_comment_report(report, remove)` (dismiss or delete the comment). All gated by `is_admin()`.

## Tests
- Unit: `src/lib/__tests__/activityComments.test.js` (validation, error mapping, mention helpers, hrefs, RPC wrappers incl.
  moderation and unread helpers). Run with `npm test`.
- SQL: `scripts/sql-checks/comments/` (see below).

## SQL verification
Supabase Preview only runs on `main` here, so the RLS rules are checked locally with a throwaway Postgres
(`pip install pgserver psycopg2-binary`, then `python scripts/sql-checks/comments/run.py` from the repo root). It stubs the
tables the migration depends on (`profiles, activities, follows, blocks, coaching_relationships, notifications` and helper
functions in `stub.sql`), applies the comment migrations **twice** (idempotency) and asserts, for `public`, `followers` and
`private` activities:

| Case | Expected |
|------|----------|
| owner | read/write/delete all; toggle off blocks new comments |
| follower | read/write on public and followers, nothing on private |
| stranger | public only; nothing on followers/private |
| coach | read/write incl. private; thread private for owner + coach |
| ex-coach | no access to private |
| blocked (either direction) | no access, other side's comments hidden, counts exclude them |
| direct INSERT/UPDATE/DELETE by a client | denied (RPCs only) |
| rate limit | 31st comment in an hour refused |
| mentions | only riders who can see the activity are stored/notified |
| notifications | one unread per (user, activity); author never notified |
| goes private | comments kept, owner/coach can view/delete, others lose access |
| reports | self-report and duplicates refused, admin list/dismiss/remove |
| sanitising | control/bidi characters stripped |

The unread/realtime migration (#225) is not covered by this harness; its RPCs reuse `user_can_view_activity`.
