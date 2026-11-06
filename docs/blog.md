# Blog

A plain, personal journal at `/blog`. Posts are markdown files shipped with the deploy: no database, no migrations, no secrets.

## Writing a post
Add `content/blog/<slug>.md`. The file name is the permanent URL (`/blog/<slug>`; lowercase letters, digits, hyphens), so never rename it after publishing.

```
---
title: Plain title (max 110 characters)
date: 2026-11-06            # real YYYY-MM-DD; the day it goes public (UTC)
summary: One line, max 200 characters. Used as the list text, meta description and feed card text.
tags: story, track-cycling  # optional, up to 6 lowercase words
updated: 2026-11-20         # optional, shown as "updated" and used for dateModified / sitemap lastmod
cover: /blog/my-cover.webp  # optional image in public/ (any existing app image works, e.g. /landing/*.webp)
coverAlt: Describe the image
coverWidth: 1600            # required with cover (avoids layout shift)
coverHeight: 900
canonicalUrl: https://...   # optional, only when the post was first published elsewhere
---
Body in markdown: paragraphs, `## Headings` (h2) and `###` (h3), `- lists`, **bold**, `code`, ``` code blocks ``` and
[links](/dsl-guide). No HTML, no images in the body.
```

Link naturally to features the post mentions (`/track`, `/dsl-guide`, `/gears`, `/velodromes`). Every `##`/`###` heading gets a stable anchor (`#version-one`); posts of 3+ minutes with 3+ headings get a table of contents. Reading time is words / 220.
`npm test` loads every post and fails on a malformed one (`src/lib/__tests__/blog.test.js`).

## Scheduled publishing
Set `date` to a future day. A post is public from 00:00 UTC on that date; before that it is **not** in `/blog`, the sitemap, RSS, `llms.txt`, the feed cards, and its own URL returns 404.

No secrets, cron or deploy are needed. The pages are static with time-based revalidation (`export const revalidate = 900`): every render re-reads the files and compares the date with the current time, and Next.js re-renders at most every 15 minutes. The slug page also allows on-demand rendering (`dynamicParams`), so a post that was future-dated at build time is rendered the first time it is requested after its date. A post can therefore appear up to ~15 minutes after midnight UTC. Alternatives considered: a scheduled GitHub workflow or external cron (needs a deploy hook secret) and a client-side date check (would leak the post to crawlers and shows a flash of content).

After a post goes live, optionally `npm run indexnow -- --blog` pings search engines for `/blog` and the published post URLs (`--dry-run` prints the body).

## Author and avatar
Posts are written by `koli440` ("Written by koli440, who builds Velocity Stack"). Rider avatars live in the public `avatars` bucket and their URL is stored in `profiles.avatar_url` (`src/lib/avatars.js`). Profiles are not readable without signing in, so the server looks the author's image up by nickname through the anon-callable RPC `blog_author_avatar` (migration `20270139000000`; it returns only that already-public URL), looked up fresh per request (`authorAvatar` in `src/lib/server/blogContent.js`; pages cache it 15 minutes via fetch revalidate). The URL is validated (`safeAvatarUrl`: own storage bucket or `/avatars/...` only). The byline, feed card and JSON-LD use it. Fallbacks: an optional bundled `public/avatars/koli440.webp`, then initials.

## Cover images
`cover` (plus `coverAlt`, `coverWidth`, `coverHeight`) is shown on the post, used as `og:image` / Twitter card and as the feed card cover with a dark gradient overlay so text stays readable. Without a cover (the default, and what the launch post uses) the generated artwork is used: `src/components/blog/CoverArt.js` draws an indigo-purple gradient with an orange glow, a velodrome oval, speed lines and a power curve, with a bold white/orange wordmark. The feed card and `/blog/<slug>/og-image` (which adds the post title) share it, so they look the same. No external assets.

## Sharing
`ShareRow` is a share-icon button shown at the top (next to the byline) and bottom of a post. With `navigator.share` (mobile) it opens the native sheet; otherwise a popover offers Copy link, LinkedIn, X, Facebook, WhatsApp, Reddit and Email (`aria-expanded`, arrow keys, Escape and outside click close it).

## Feed cards
Every published post appears as a "New on the blog" card in the rider's own activity feed (dashboard, "My sessions"), as a timeline item at the post's publish date (midday UTC):
- Data comes from `GET /api/blog-cards` (public post data only; rendered per request, never prerendered at build, so a failed avatar lookup is not frozen in; the CDN caches only responses that include the avatar, for 5 minutes). If the avatar is still missing and the viewer is the author, `withOwnAuthorAvatar` uses the viewer's own profile image; other riders only ever see the author's; the client also never shows a card dated in the future.
- `mergeBlogCards` (`src/lib/blogFeed.js`) interleaves cards with the loaded activities by date. While more pages exist, a card older than the oldest loaded activity waits until infinite scroll reaches that point, so cards keep their chronological position and loading more never reorders earlier items. Riders with no activities see all cards.
- Cards are separate from the activity list: counts, ids, pagination, reactions and comments are unaffected. Only the dashboard "My sessions" feed passes cards, so they never appear in the Following tab, rider profiles or coach/athlete-context feeds, and contain nothing about any rider.
- Permanent: no dismiss, no banner.

## SEO
- `/blog/<slug>`: unique title (the post title as is, max 60 chars) and description, canonical URL (`canonicalUrl` when set), Open Graph `article` and Twitter large-image cards, `BlogPosting` and `BreadcrumbList` JSON-LD, RSS autodiscovery link.
- Share image: the `cover` (with its width/height), otherwise a generated 1200x630 image at `/blog/<slug>/og-image` (same look as `src/app/opengraph-image.js`).
- `/blog` and every published post are in `sitemap.xml` and `llms.txt` / `llms-full.txt`; `/blog/rss.xml` lists published posts only.
- The blog uses the same lightweight public shell as `/track` (`isBlogPath` in `AppShell`), so crawlers get complete HTML. It is linked from the footer, the About page, the landing page and the public header.
