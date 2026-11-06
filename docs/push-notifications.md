# Web Push (system) notifications

Riders can get a pop-up on their phone/PC when a new in-app notification arrives, also when the installed app (PWA) is closed. Supported: Chrome/Edge/Firefox on desktop and Android, and iOS/iPadOS 16.4+ **only when the app is added to the Home Screen**.

## Setup (one-time, per deployment)
Generate a VAPID key pair and set three environment variables in Vercel (Project → Settings → Environment Variables), then redeploy:

```
npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:you@example.com     # optional
```

Nothing else is needed: the database migration, trigger and cron job deploy with Supabase. Without `NEXT_PUBLIC_VAPID_PUBLIC_KEY` the toggle is hidden; without `VAPID_PRIVATE_KEY` the server endpoints do nothing. Never change the public key after riders subscribed (their devices would need to re-enable).

## Flow
1. Settings → "Pop-up notifications on this device": the browser permission prompt appears only after the rider clicks the toggle. The browser subscription is stored through `save_push_subscription` (one row per device; no per-type switches, all notification types are pushed).
2. A row in `notifications` (written by the existing triggers; recipients, coach and bot rules unchanged; bots cannot subscribe) fires `trg_notification_push`, which calls `POST /api/notifications/push/run` through pg_net with the shared cron token (`sync_settings`, same mechanism as the e-mail run). A pg_cron job `notification-push` (every minute) is the safety net.
3. The endpoint claims unread rows (`pushed_at`), builds the payload (`src/lib/push.js`: generic title, the bell's one-line text, deep link from `notificationHref`), sends with `web-push` and deletes subscriptions that answer 404/410. Notifications older than 24 h are skipped.
4. `public/sw.js` shows the notification; tapping focuses an existing window and navigates to the link (or opens one).

"Send test notification" (`POST /api/notifications/push/test`, signed-in caller only) sends to the caller's own devices.

## Privacy
Push is a user-initiated, strictly functional feature (no consent banner category needed); the payload holds only a short sentence and a path, never ride data. Turning the toggle off deletes the device row.
