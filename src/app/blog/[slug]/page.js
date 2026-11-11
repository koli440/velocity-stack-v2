import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { loadPublishedPosts, getPublishedPost, authorAvatar } from '../../../lib/server/blogContent'
import {
  BLOG_PATH,
  postUrl,
  postCanonical,
  postImage,
  postTitleTag,
  postDescription,
  prevNext,
  relatedPosts,
  shareLinks,
  tocFor,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  formatPostDate,
} from '../../../lib/blog'
import { jsonLdString } from '../../../lib/trackLanding'
import BlogBody, { TagList } from '../../../components/blog/BlogBody'
import Byline from '../../../components/blog/Byline'
import ShareRow from '../../../components/blog/ShareRow'
import BlogTracker from '../../../components/blog/BlogTracker'

// Static pages that re-check the publish date at most every 15 minutes: a post dated in the future is a 404
// until its date, then appears without a deploy. Slugs that were not prebuilt are rendered on demand (docs/blog.md).
export const revalidate = 900
export const dynamicParams = true

export function generateStaticParams() {
  return loadPublishedPosts().map((p) => ({ slug: p.slug }))
}

export function generateMetadata({ params }) {
  const post = getPublishedPost(params.slug)
  if (!post) return { title: 'Post not found', robots: { index: false } }
  const image = postImage(post)
  const title = postTitleTag(post)
  const description = postDescription(post)
  return {
    title: { absolute: title },
    description,
    authors: [{ name: 'koli440' }],
    keywords: post.tags,
    alternates: { canonical: postCanonical(post), types: { 'application/rss+xml': `${BLOG_PATH}/rss.xml` } },
    openGraph: {
      type: 'article',
      siteName: 'VelocityStack',
      title,
      description,
      url: postUrl(post),
      publishedTime: post.date,
      modifiedTime: post.updated,
      authors: ['koli440'],
      tags: post.tags,
      images: [{ url: image.url, width: image.width, height: image.height, alt: image.alt }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: image.url, alt: image.alt }] },
  }
}

const navCls = 'block rounded-xl border border-slate-200 dark:border-surface-darkBorder p-4 hover:bg-slate-100 dark:hover:bg-white/5'

export default async function BlogPostPage({ params }) {
  const post = getPublishedPost(params.slug)
  if (!post) notFound()
  const published = loadPublishedPosts()
  const { newer, older } = prevNext(published, post.slug)
  const related = relatedPosts(published, post)
  const toc = tocFor(post)
  const avatarUrl = await authorAvatar()

  return (
    <article id="blog-post" className="max-w-2xl mx-auto">
      <BlogTracker slug={post.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(blogPostingJsonLd(post, avatarUrl)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd(post)) }} />

      <nav aria-label="Breadcrumb" className="mb-4 text-xs text-slate-500 dark:text-slate-400">
        <Link href={BLOG_PATH} className="hover:underline">Blog</Link>
      </nav>

      <header className="space-y-4">
        <h1 className="text-3xl sm:text-5xl font-black leading-tight text-slate-900 dark:text-white">{post.title}</h1>
        <p className="text-lg text-slate-600 dark:text-slate-300">{post.summary}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Byline avatarUrl={avatarUrl} date={post.date} updated={post.updated} minutes={post.minutes} />
          <ShareRow links={shareLinks(post)} url={postUrl(post)} title={post.title} />
        </div>
        <TagList tags={post.tags} />
      </header>

      {post.cover && (
        <figure className="my-8">
          <Image
            src={post.cover}
            alt={post.coverAlt}
            width={post.coverWidth}
            height={post.coverHeight}
            priority
            sizes="(min-width: 768px) 672px, 100vw"
            className="w-full h-auto rounded-2xl"
          />
        </figure>
      )}

      {toc.length > 0 && (
        <nav aria-label="Table of contents" className="my-8 rounded-xl border border-slate-200 dark:border-surface-darkBorder p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">In this post</p>
          <ol className="space-y-1 text-sm">
            {toc.map((h) => (
              <li key={h.id} className={h.level === 3 ? 'pl-4' : ''}>
                <a href={`#${h.id}`} className="underline text-emerald-700 dark:text-brand-neon">{h.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className={post.cover || toc.length ? '' : 'mt-8'}>
        <BlogBody body={post.body} />
      </div>

      <div className="mt-10 pt-6 border-t border-slate-200 dark:border-surface-darkBorder flex items-center justify-between gap-3">
        <span className="text-sm text-slate-600 dark:text-slate-400">Enjoyed this? Share it.</span>
        <ShareRow links={shareLinks(post)} url={postUrl(post)} title={post.title} placement="bottom" />
      </div>

      {(newer || older) && (
        <nav aria-label="More posts" className="mt-8 grid gap-3 sm:grid-cols-2">
          {older ? (
            <Link href={`${BLOG_PATH}/${older.slug}`} rel="prev" className={navCls}>
              <span className="block text-xs text-slate-500 dark:text-slate-400">Previous post</span>
              <span className="font-bold text-slate-900 dark:text-white">{older.title}</span>
            </Link>
          ) : <span />}
          {newer && (
            <Link href={`${BLOG_PATH}/${newer.slug}`} rel="next" className={`${navCls} sm:text-right`}>
              <span className="block text-xs text-slate-500 dark:text-slate-400">Next post</span>
              <span className="font-bold text-slate-900 dark:text-white">{newer.title}</span>
            </Link>
          )}
        </nav>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-10">
          <h2 id="related" className="text-lg font-black text-slate-900 dark:text-white mb-3">Related posts</h2>
          <ul className="space-y-2">
            {related.map((p) => (
              <li key={p.slug}>
                <Link href={`${BLOG_PATH}/${p.slug}`} className="underline text-emerald-700 dark:text-brand-neon">{p.title}</Link>
                <span className="text-xs text-slate-500 dark:text-slate-400"> · {formatPostDate(p.date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-12 pt-6 border-t border-slate-200 dark:border-surface-darkBorder text-sm text-slate-600 dark:text-slate-400 space-y-2">
        <p>
          Want to reply? Tell me what you think on the <Link href="/feedback" className="underline">feedback page</Link>.
        </p>
        <p>
          If you ride the track, <Link href="/track" className="underline">VelocityStack</Link> is what I&apos;m building.
        </p>
      </footer>
    </article>
  )
}
