// Reads the blog markdown files from content/blog (shipped with the deploy, no secrets, no database).
import fs from 'node:fs'
import path from 'node:path'
import { parseBlogPost, sortPostsNewestFirst, publishedPosts, isPublished, BLOG_AUTHOR, safeAvatarUrl } from '../blog.js'

export const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')

/** Every post (including future-dated ones), newest first. A malformed file throws so it fails the build and the tests. */
export function loadAllPosts(dir = BLOG_DIR) {
  if (!fs.existsSync(dir)) return []
  const posts = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    try {
      posts.push(parseBlogPost(fs.readFileSync(path.join(dir, file), 'utf8'), file.slice(0, -3)))
    } catch (e) {
      throw new Error(`content/blog/${file}: ${e.message}`)
    }
  }
  return sortPostsNewestFirst(posts)
}

/** Only what readers may see right now; pages call this per request/revalidation so scheduled posts appear on their date. */
export const loadPublishedPosts = (now = new Date(), dir = BLOG_DIR) => publishedPosts(loadAllPosts(dir), now)

export function getPublishedPost(slug, now = new Date(), dir = BLOG_DIR) {
  const post = loadAllPosts(dir).find((p) => p.slug === slug)
  return post && isPublished(post, now) ? post : null
}

/** The author's bundled fallback image path (served from public/), or null. */
export function bundledAuthorAvatar(publicDir = path.join(process.cwd(), 'public')) {
  return fs.existsSync(path.join(publicDir, BLOG_AUTHOR.avatarFile)) ? `/${BLOG_AUTHOR.avatarFile}` : null
}

/**
 * The author's public profile image: looked up by nickname through the anon-callable RPC blog_author_avatar
 * (returns only the already-public image URL), cached for 15 minutes. Falls back to a bundled copy, then null (initials).
 */
export async function authorAvatar(fetchImpl = fetch, env = process.env) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (base && key) {
    try {
      const res = await fetchImpl(`${base}/rest/v1/rpc/blog_author_avatar`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_nickname: BLOG_AUTHOR.name }),
        next: { revalidate: 900 },
      })
      if (res.ok) {
        const url = safeAvatarUrl(await res.json(), base)
        if (url) return url
      }
    } catch {
      // fall through to the bundled copy
    }
  }
  return bundledAuthorAvatar()
}
