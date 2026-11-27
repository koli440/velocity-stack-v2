# MCP connector (Claude and other MCP clients)

Claude (Settings → Connectors → Add custom connector) or any other MCP client can connect to a rider's account, plan
workouts in the calendar and evaluate completed training. It reuses the partner OAuth provider (docs/partner-api.md);
there are no new secrets and no JWT signing.

## Setup (Claude)

1. Sign in, open `/developers` and register an app, e.g. "Claude":
   - Redirect URI: `https://claude.ai/api/mcp/auth_callback` (Anthropic says this may move to
     `https://claude.com/api/mcp/auth_callback` later, so add both).
   - Scopes: tick `profile:read`, `plans:read`, `plans:write`, `activities:read` (all four: Claude requests exactly
     these, see "Discovery", and the authorize request fails if one is missing on the app).
   - Keep it confidential and copy the client secret (shown once).
2. An admin approves the app at `/admin/partner-apps`.
3. In Claude: Settings → Connectors → Add custom connector. URL `https://www.velocity-stack.app/api/mcp`; under
   Advanced settings enter the client id and secret. Connect → the Velocity Stack consent page lists the four
   permissions → Allow.

Riders can disconnect the app on the Connections page (revokes the grants); tokens of a suspended app stop working at once.

User-facing help: the public page `/claude` (what Claude can do, connecting, permissions, tools, example prompts,
privacy). It is the documentation link of the directory listing and the protected resource metadata.

## Claude Connectors Directory

Listing in Claude's directory (claude.ai/directory/manage → Submit new → MCP connector) makes the connector available
to every Velocity Stack user without a custom connector. What it needs from us:

- **Authentication: Anthropic-held client credentials.** Register a dedicated production app at `/developers` (for
  example owned by the team account, not a personal test app): redirect URIs `https://claude.ai/api/mcp/auth_callback`
  and `https://claude.com/api/mcp/auth_callback`, the four MCP scopes, confidential. Approve it, then enter its client
  id and secret in the portal's Authentication step. Every rider then authorizes through that one app.
- **Claude Code** signs in with its Client ID Metadata Document instead (next section), so it needs no app.
- **Listing data:** name, one-liner, description, categories, icon, docs URL `https://www.velocity-stack.app/claude`,
  privacy policy `https://www.velocity-stack.app/privacy`, support contact, company details.
- **Reviewer access:** a test account with a populated history (activities with power and HR, planned workouts, FTP,
  zones, a race), plus confirmation that every tool was run.
- **Tool rules** (checked by `mcpDirectory.test.js`): every tool has a title; read tools `readOnlyHint: true`; every tool
  that changes stored data (`create/update/move/skip/delete_planned_workout`, `run_template`) `destructiveHint: true`,
  so Claude asks before calling it; names <= 64 characters; no catch-all tool.

## Claude Code and other CIMD clients

`src/lib/cimd.js`: a client may use an https URL as `client_id` (Client ID Metadata Document). Only URLs on trusted
hosts (`claude.ai`, `claude.com`) are accepted, so the server never fetches arbitrary URLs. On the first authorize
request the document is fetched (no redirects, 5 s, 10 kB), validated (`client_id` matches, `client_name`, valid
`redirect_uris`, public client) and stored as an **ownerless, approved** `developer_apps` row (`owner_user_id` NULL,
no secret, the four MCP scopes, slug `cimd-<hash>`, audit event `cimd_registered`). It is re-read at most daily
(`cimd_fetched_at`); a failed fetch keeps the stored row; name / redirect URIs are refreshed, status and scopes are
never touched, so an admin can suspend it at `/admin/partner-apps` like any app. The authorization server metadata
advertises `client_id_metadata_document_supported: true`.

Redirect URIs: a registered loopback `http://localhost/...`, `http://127.0.0.1/...` or `http://[::1]/...` URI matches
on any port (RFC 8252 §7.3; Claude Code listens on an ephemeral port). Everything else is an exact match.

Claude Code: `claude mcp add --transport http velocity-stack https://www.velocity-stack.app/api/mcp`, then `/mcp`.

## Endpoint

`POST /api/mcp` - MCP Streamable HTTP, stateless: every POST carries one JSON-RPC message (or a batch of up to 20)
and gets a JSON response (`202` without body for notifications). No session id, no server-initiated stream:
`GET` / `DELETE` return `405`. Protocol versions `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` (the
client's version is echoed when supported). Methods: `initialize`, `ping`, `tools/list`, `tools/call`. Hand-written
(`src/lib/mcp/protocol.js`), no SDK dependency.

- `Authorization: Bearer <access token>` of the OAuth provider (1 h, refreshed with rotating refresh tokens).
  Missing or invalid: `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp"`
  (plus `error="invalid_token"` when a token was sent).
- `tools/list` only lists tools whose scope the token has (and `get_macro_plan` only when the planner is available).
  A tool called without its scope returns a tool error naming the missing scope.
- Rate limit **per rider**: each `tools/call` counts against `developer_apps.rate_limit_per_user_min` (default 60) for
  that app and rider (`partner_user_rate_hit`, `partner_user_rate_counters`, `20270192000000_mcp_directory.sql`), so one
  directory app shared by all riders never throttles them together. Over the limit → `429` with `Retry-After`,
  logged as `rate_limited` (`window: user_minute`) in `partner_audit_log`.
- Audit: every successful write tool call is logged in `partner_audit_log` as `mcp_write` with `{ tool }`; the admin
  page shows it with the other partner events.
- Usage counters: every known tool call (read or write, success or tool error) is counted per app, UTC day and tool
  by `mcp_usage_hit` for the admin dashboard (docs/admin.md, "Third-party app stats"). Tool name and error flag only.

## Discovery

- `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728):
  `resource` = `<origin>/api/mcp`, `authorization_servers` = `[<origin>]`, `scopes_supported` = the four MCP scopes.
- `GET /.well-known/oauth-authorization-server` (RFC 8414): issuer = origin, `authorization_endpoint` `/oauth/authorize`
  (the consent page), `token_endpoint` `/api/oauth/token`, `revocation_endpoint` `/api/oauth/revoke`, PKCE `S256`
  only, `client_secret_basic` / `client_secret_post` / `none`. No `offline_access` (refresh tokens are always issued).
- The origin comes from the request (`appOrigin`), so previews describe themselves. No dynamic client
  registration: apps are registered at `/developers` and approved by an admin; trusted CIMD clients (Claude Code)
  are created automatically (see above). `resource_documentation` points to `/claude`.

## Scopes

| Scope | Consent label | Tools |
| --- | --- | --- |
| `profile:read` | Read your FTP, weight and units | `get_athlete` |
| `plans:read` | Read the planned workouts, races and notes in your calendar (and your training plan) | `list_planned_workouts`, `get_macro_plan`, `list_races`, `list_notes` |
| `plans:write` | Plan, edit, move, skip and delete workouts, and add, edit and delete races and notes in your calendar | `create_planned_workout`, `update_planned_workout`, `move_planned_workout`, `skip_planned_workout`, `delete_planned_workout`, `create_race`, `update_race`, `delete_race`, `create_note`, `update_note`, `delete_note` |
| `activities:read` | Read your activities, fitness and analysis results, and run your analysis templates on them | `list_activities`, `get_activity`, `list_templates`, `run_template`, `get_fitness` |

Races and notes are part of the calendar, so they use the calendar scopes `plans:read` / `plans:write` instead of
new scopes: existing connections keep working without re-registering the app or reconnecting (only the consent
labels were extended).

Defined in `src/lib/partnerScopes.js` (the `/developers` form and the consent page use them); `developer_apps.scopes`
needs no schema change.

## Tools (`src/lib/mcp/tools.js`)

All inputs are validated before any database access (unknown arguments, UUIDs, `YYYY-MM-DD` dates, ranges <= 366
days, title <= 80, notes <= 2000, discipline `ride|track|gym|run|other`, limits). Database errors are mapped to
short messages (never internals).

- `get_athlete` - FTP (history at today, else profile), weight, W/kg, LT1/LT2, power zones in watts (same
  `computeZones` as the app), upcoming calendar races (goals), and `coached_athletes` for coaches.
- `list_planned_workouts(from, to, athlete_id?)` - status `planned|completed|skipped|missed` (derived like the
  calendar), DSL structure, summary lines, estimated duration and load.
- Planned-workout estimates (`estimated_duration_s`, `estimated_load`, `estimated_load_assumes_thresholds`) come from
  the calendar's own code path: `workoutSummary` / `plannedToEvent` with the RIDER's load context
  (`{ ftpHistory, ltHistory, zoneHistory }`, loaded like `useRiderLoadContext` by `data.loadContext`), so
  `estimated_load` is exactly the "~TL" the calendar shows (watt, zone and %LT bands count; runs have none). The
  context is loaded once per rider, only for the `rider_id` of rows the wrappers returned; when it cannot be loaded
  the estimate falls back like the calendar (only %FTP bands). Every tool that returns planned workouts uses it.
- `create_planned_workout(date, discipline, title, description?, structure?, athlete_id?)` - `structure` is the
  interval DSL (docs/template-dsl.md); it is parsed with the template parser (`parseStructure`) and stored as the
  usual snapshot (DSL + manifest), so the auto push to Intervals.icu / Wahoo / Garmin picks it up on its next cycle.
- `update_planned_workout(id, title?, description?, discipline?, date?, structure?)` (`structure: ""` removes it),
  `move_planned_workout(id, date)`, `skip_planned_workout(id, skipped = true)`, `delete_planned_workout(id)`.
- `list_races(from, to, athlete_id?)` - calendar races (goals): id, date, time, name, discipline
  (`ride|track|other`), priority (`A` = main goal, `B`, `C`), location, format, notes, linked activity, added by coach.
- `create_race(date, name, discipline = ride, priority = B, location?, notes?, athlete_id?)`,
  `update_race(id, date?, name?, discipline?, priority?, location?, notes?)` (fields left out stay; time, format and
  the activity link are not touched), `delete_race(id)`. Validated with the app's `validateRace` (name <= 80,
  location <= 120, notes <= 1000).
- `list_notes(from, to, athlete_id?)` - calendar notes: id, date, title, text, written by coach.
- `create_note(date, text, title?, athlete_id?)` - the app's notes have a title (<= 80, shown in the calendar cell)
  and a text (<= 1000): without `title` the first line of `text` is the title (cut at 80) and the full text is kept
  when it is longer. `update_note(id, date?, title?, text?)`, `delete_note(id)`. Validated with `validateNote`.
- `list_activities(from, to, limit <= 100)` - newest first, compact summary with the linked planned workout.
  Day bounds are UTC.
- `get_activity(id, split_minutes = 5)` - summary, power / HR peaks (activity curves), time in power zones (the
  activity's own threshold snapshots), fixed-length splits (avg power, max power, HR, cadence, speed; at most 120
  blocks), the linked planned workout and the latest template results (scalar fields of summary and up to 40
  efforts). Never GPS.
- `list_templates(query?)` - own, public and system templates with a DSL (same visibility as the app's picker).
- `run_template(activity_id, template_id)` - runs the template on an own activity with the app's batch runner
  (`runTemplateBatch` + `ownStore`): the result is stored (or replaces the previous run of that template) exactly as
  if the rider ran it, and returned.
- `get_fitness(days = 42)` - fitness (CTL), fatigue (ATL), form (TSB), ramp per week and the daily series, computed
  with `dailyLoads` / `fitnessSummary` like the Fitness page (honours "include gym in fitness").
- `get_macro_plan(athlete_id?)` - listed only when the token user has the `macro_planner` flag or a published plan
  from their coach. Own account: `my_macro_plan()` (published plan of the active coach); coach: `macro_plan_get`.
  Read only.

Coaches: the planning, race and note tools and `get_macro_plan` accept `athlete_id` (an ACTIVE coaching relationship, checked in
the database by `is_coach_of`; workouts are stamped `set_by_coach` as in the app). Activity, template and fitness
tools work on the token user's own account only in v1 (coaches read athletes' training through the coach-gated RPCs
in the app).

## Database (`20270190000000_mcp_connector.sql`)

The route runs with the service role. It authenticates the bearer with the provider (`authenticateBearer`) and
passes only the token's SHA-256 hash to the wrappers, which resolve the user themselves:

- `mcp_token_user(token_hash, scope)` - grant not revoked / rotated / expired, app approved, scope granted; raises
  `invalid_token` / `insufficient_scope`.
- `mcp_act_as(user)` - sets `request.jwt.claim.sub` / `request.jwt.claims` transaction-locally (pattern of
  `bots_coach_edit`), so `auth.uid()`, `is_coach_of()`, the stamps trigger and the existing RPCs behave exactly as
  for the signed-in rider.
- `mcp_resolve_rider`, `mcp_capabilities`, `mcp_planned_list`, `mcp_planned_create` (→ `planned_workout_create`),
  `mcp_planned_update` (the five client-updatable fields only), `mcp_planned_set_structure`
  (→ `planned_workout_set_structure`), `mcp_planned_delete`, `mcp_macro_plan_get`.
- `EXECUTE` for `service_role` only (revoked from `PUBLIC`, `anon`, `authenticated`). Additive, idempotent.

Races and notes (`20270191000000_mcp_races_notes.sql`): `mcp_races_list`, `mcp_race_create`, `mcp_race_update`,
`mcp_race_delete`, `mcp_notes_list`, `mcp_note_create`, `mcp_note_update`, `mcp_note_delete`. The app writes these
tables directly under RLS (no RPCs), so the wrappers act as the token user (`mcp_act_as`, so the stamp triggers set
`created_by` / `updated_by` / `set_by_coach` and enforce the per-day limits as in the app) and check the RLS rule
explicitly (`rider_id = user OR is_coach_of(rider_id)`; unknown or foreign ids give "Race not found" /
"Note not found"). Only the app's client-writable columns can be written; `rider_id` never changes. Constraint
violations become "Invalid race values" / "Invalid note values". Service role only. Harness:
`scripts/db-harness/mcp-races-notes-adversarial.mjs`.

Own-account reads (activities, curves, template runs, thresholds, fitness) use the service client and filter every
query by the token's user id explicitly, like `/api/v1`.

## Tests

`src/lib/__tests__/mcpDirectory.test.js`: loopback port matching, CIMD validation / fetch limits / first-use
creation / refresh / suspension, the Claude Code sign-in end to end, tool annotations, per-rider limit, `/claude` page.
`src/lib/__tests__/mcp.test.js`: JSON-RPC handling, planned load = calendar TL (watt-band examples), race and note
tools, version negotiation, scope filtering and refusal, input
validation, data-call mapping, error mapping, discovery documents, output views and the migration's grants.
