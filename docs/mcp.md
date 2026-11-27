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
- Rate limit: each `tools/call` counts against the app's per-minute limit (`partner_rate_hit`, same counter and
  `developer_apps.rate_limit_per_min` as the partner API); over the limit → `429` with `Retry-After`, logged as
  `rate_limited` in `partner_audit_log`.
- Audit: every successful write tool call is logged in `partner_audit_log` as `mcp_write` with `{ tool }`; the admin
  page shows it with the other partner events.

## Discovery

- `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728):
  `resource` = `<origin>/api/mcp`, `authorization_servers` = `[<origin>]`, `scopes_supported` = the four MCP scopes.
- `GET /.well-known/oauth-authorization-server` (RFC 8414): issuer = origin, `authorization_endpoint` `/oauth/authorize`
  (the consent page), `token_endpoint` `/api/oauth/token`, `revocation_endpoint` `/api/oauth/revoke`, PKCE `S256`
  only, `client_secret_basic` / `client_secret_post` / `none`. No `offline_access` (refresh tokens are always issued).
- The origin comes from the request (`appOrigin`), so previews describe themselves. No dynamic client
  registration: apps are registered at `/developers` and approved by an admin.

## Scopes

| Scope | Consent label | Tools |
| --- | --- | --- |
| `profile:read` | Read your FTP, weight and units | `get_athlete` |
| `plans:read` | Read the planned workouts in your calendar (and your training plan) | `list_planned_workouts`, `get_macro_plan` |
| `plans:write` | Plan, edit, move, skip and delete workouts in your calendar | `create_planned_workout`, `update_planned_workout`, `move_planned_workout`, `skip_planned_workout`, `delete_planned_workout` |
| `activities:read` | Read your activities, fitness and analysis results, and run your analysis templates on them | `list_activities`, `get_activity`, `list_templates`, `run_template`, `get_fitness` |

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
- `create_planned_workout(date, discipline, title, description?, structure?, athlete_id?)` - `structure` is the
  interval DSL (docs/template-dsl.md); it is parsed with the template parser (`parseStructure`) and stored as the
  usual snapshot (DSL + manifest), so the auto push to Intervals.icu / Wahoo / Garmin picks it up on its next cycle.
- `update_planned_workout(id, title?, description?, discipline?, date?, structure?)` (`structure: ""` removes it),
  `move_planned_workout(id, date)`, `skip_planned_workout(id, skipped = true)`, `delete_planned_workout(id)`.
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

Coaches: the planning tools and `get_macro_plan` accept `athlete_id` (an ACTIVE coaching relationship, checked in
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

Own-account reads (activities, curves, template runs, thresholds, fitness) use the service client and filter every
query by the token's user id explicitly, like `/api/v1`.

## Tests

`src/lib/__tests__/mcp.test.js`: JSON-RPC handling, version negotiation, scope filtering and refusal, input
validation, data-call mapping, error mapping, discovery documents, output views and the migration's grants.
