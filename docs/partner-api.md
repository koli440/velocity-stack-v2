# Partner API (OAuth 2.0)

Third-party apps without a .fit export (e.g. indoor-cycling games) connect a rider's account through our own OAuth 2.0 provider and upload rides. The upload API is below. Machine-readable spec: [`public/openapi/v1.yaml`](../public/openapi/v1.yaml), served at `https://www.velocity-stack.app/openapi/v1.yaml`.

## Quick start

1. Register at `/developers`, wait for approval, keep the client secret safe (shown once).
2. Send the rider to `/oauth/authorize` with PKCE S256 and `state`; exchange the returned `code` at `/api/oauth/token`.
3. `POST /api/v1/activities` with `Authorization: Bearer <access token>`; refresh the token when it expires and store the NEW refresh token each time.
4. Handle `429` by waiting `Retry-After` seconds.

- Register: a `developer_apps` row (manually approved for now): `client_id`, redirect URIs (exact match, https or loopback http), scopes (`activities:write`, `profile:read`), optional secret (stored as SHA-256; omit for public PKCE-only clients).
- `GET https://www.velocity-stack.app/oauth/authorize?client_id&redirect_uri&response_type=code&scope&state&code_challenge&code_challenge_method=S256` - consent page. `state` and PKCE S256 are mandatory.
- `POST /api/oauth/token` (`application/x-www-form-urlencoded` or JSON; client auth via HTTP Basic or body): `grant_type=authorization_code` (`code`, `redirect_uri`, `code_verifier`) or `refresh_token`. Access tokens last 1 h; every refresh returns a NEW refresh token (180 days) and the old one stops working; presenting an already-used refresh token revokes the whole grant.
- `POST /api/oauth/revoke` (RFC 7009): `token` (access or refresh) revokes the grant.
- Codes are single use and expire after 10 minutes; suspended apps' tokens stop working immediately. Needs `SUPABASE_SERVICE_ROLE_KEY` on the server (already used by other connections); no new secrets.

## Upload API (`Authorization: Bearer <access token>`)

- `POST /api/v1/activities` (scope `activities:write`), idempotent per `(app, rider, external_id)`. Either
  - `application/json`: `{ "external_id", "start_time" (ISO 8601 with zone), "title"?, "sport"? (road|mtb|gravel|ebike|indoor|virtual, default virtual), "streams": { "power"?, "heart_rate"?, "cadence"?, "speed"? (m/s), "distance"? (m, cumulative), "altitude"? (m) } }` - 1 Hz arrays of equal length, 60 to 50,000 samples, at least one of power/heart_rate/speed/distance; or
  - `multipart/form-data`: `file` (.fit/.tcx/.gpx, max 10 MB), `external_id`, optional `title`, `sport`, `start_time`.
  Responses: `201` imported, `200` already uploaded before (or an overlapping ride exists, `status: duplicate`), `422` failed (`error` says why; the same `external_id` may be retried), `413` too large, `401/403` token/scope. Body: `{ id, external_id, status, activity_id, error, created_at }`. Processing is synchronous, so the final status is in the response.
- `GET /api/v1/uploads/{id}` (scope `activities:write`): status of an upload made by this app.
- `GET /api/v1/athlete` (scope `profile:read`): `{ ftp_w, weight_kg }`.
- Uploads go through the normal import pipeline: workload/TSS, sport model, naming (generic titles get a funny name), planned-workout linking, duplicate check (same source id, or time overlap with Strava/Intervals/Garmin/Wahoo copies; first copy wins). Cycling only in v1. Activities carry `source = 'partner'`, `external_source = 'partner:<slug>'`.

## Developer registration, approval and limits

- Developers sign in and register an app at `/developers` (max 5 per owner). The app starts `pending`; the client secret is shown once and stored only as a SHA-256 hash. Owners can delete their apps (grants, uploads and codes cascade).
- Admins approve or suspend apps at `/admin/partner-apps` (also shows the latest audit events). Suspending cuts off tokens immediately.
- Rate limits per app (defaults 60 requests/min and 500 uploads/24 h, stored on `developer_apps`): exceeding returns `429` with `Retry-After`. Counted in `partner_rate_counters` via `partner_rate_hit()`.
- Riders see their connected apps on the Connections page and can disconnect them (revokes the grants). Registration, approval, suspension, disconnects and rate-limit hits are written to `partner_audit_log`.
