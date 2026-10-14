# Google Analytics 4

Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` to your GA4 Measurement ID (`G-XXXXXXXXXX`).

- Local: put it in `.env.local`(see `.env.example`).
- Hosting (e.g. Vercel): Project Settings → Environment Variables, then redeploy.

The variable is inlined at build time, so a rebuild is required after changing it.
If unset, no analytics script is loaded.
