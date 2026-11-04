# Partner API (OAuth 2.0)

Third-party apps without a .fit export (e.g. indoor-cycling games) connect a rider's account through our own OAuth 2.0 provider and upload rides. Part 1 (this doc) covers authorization; the upload API follows in a later PR.

- Register: a `developer_apps` row (manually approved for now): `client_id`, redirect URIs (exact match, https or loopback http), scopes (`activities:write`, `profile:read`), optional secret (stored as SHA-256; omit for public PKCE-only clients).
- `GET https://www.velocity-stack.app/oauth/authorize?client_id&redirect_uri&response_type=code&scope&state&code_challenge&code_challenge_method=S256` - consent page. `state` and PKCE S256 are mandatory.
- `POST /api/oauth/token` (`application/x-www-form-urlencoded` or JSON; client auth via HTTP Basic or body): `grant_type=authorization_code` (`code`, `redirect_uri`, `code_verifier`) or `refresh_token`. Access tokens last 1 h; every refresh returns a NEW refresh token (180 days) and the old one stops working; presenting an already-used refresh token revokes the whole grant.
- `POST /api/oauth/revoke` (RFC 7009): `token` (access or refresh) revokes the grant.
- Codes are single use and expire after 10 minutes; suspended apps' tokens stop working immediately. Needs `SUPABASE_SERVICE_ROLE_KEY` on the server (already used by other connections); no new secrets.
