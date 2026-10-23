# Authentication

Supabase Auth: email + password and **Continue with Google**. The browser client (`src/lib/supabase.js`) keeps the session in
localStorage; pages are protected client-side by `AppShell` (no middleware). API routes use the bearer token (`src/lib/supabaseServer.js`).

## Google sign-in
Flow: `signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback?next=<path> } })`
(`src/components/GoogleSignInButton.js`, on `/login` and `/register`) -> Google -> Supabase -> `/auth/callback`.

`src/app/auth/callback/route.js`:
- the client uses the implicit flow, so Supabase returns the tokens in the URL **fragment**; the browser client stores the session itself
  (`detectSessionInUrl`). A server `exchangeCodeForSession` cannot give a session to a localStorage client, so the route does not use it.
- query errors (`access_denied`, ...) -> `/login?error=<code>` (friendly message shown there); a `code` query (unexpected here) -> `/login?error=oauth_failed`;
- otherwise it serves a tiny page that forwards to the validated `next` (same-origin path only, `src/lib/authRedirect.js`; default `/`) keeping the
  fragment, or to `/login` on a fragment error / missing tokens.

### Owner configuration (already done; no secrets live in the repo)
1. Google Cloud Console -> APIs & Services -> Credentials -> OAuth client (Web). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase -> Authentication -> Providers -> Google: enable, paste client ID and secret (stored in Supabase only).
3. Supabase -> Authentication -> URL Configuration: Site URL = production URL; Redirect URLs must include
   - `https://<production-domain>/auth/callback**`
   - `http://localhost:3000/auth/callback**` (local dev) and any preview domain pattern, e.g. `https://*-<team>.vercel.app/auth/callback**`.
   The app itself only uses `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Profiles
`handle_new_user` (migration `20270101000000_oauth_signup_profile.sql`) creates the profile for every new `auth.users` row:
`first_name`/`last_name` (email form) or `given_name`/`family_name`, else `full_name`/`name` split on the first space; with no name at all the
nickname is the email local part. Names are not unique. Google's picture is **not** copied: `profiles.avatar_url` only allows images in the rider's own
avatars folder, so Google riders start with initials and can upload a photo in Settings. The onboarding row (welcome tour + checklist) is created by the
trigger on `public.profiles`, so Google users get it exactly like email users. Pure mapping mirror: `src/lib/oauthProfile.js` (tested).

### Account linking
Supabase default: a Google sign-in with an email that already belongs to an account with the **same verified email** is linked to that account
(same user id, same data). Nothing is configured in the app. A password can be added to a Google-only account via "Forgot password?" on the login page.
Settings -> Sign-in methods shows the linked methods; there is no in-app password change, so nothing to hide for Google-only users.
