import { loadPublishedPosts, authorAvatar } from '../../lib/server/blogContent'
import { BLOG_PATH, BLOG_TITLE, BLOG_DESCRIPTION, feedCardData, breadcrumbJsonLd } from '../../lib/blog'
import { jsonLdString } from '../../lib/trackLanding'
import BlogCard from '../../components/blog/BlogCard'

// Scheduled posts appear on their date: the list is rebuilt from the files at most every 15 minutes (docs/blog.md).
export const revalidate = 900

export const metadata = {
  title: 'Blog',
  description: BLOG_DESCRIPTION,
  alternates: { canonical: BLOG_PATH, types: { 'application/rss+xml': `${BLOG_PATH}/rss.xml` } },
  openGraph: { type: 'website', siteName: 'VelocityStack', title: BLOG_TITLE, description: BLOG_DESCRIPTION, url: BLOG_PATH },
  twitter: { card: 'summary_large_image', title: BLOG_TITLE, description: BLOG_DESCRIPTION },
}

export default async function BlogIndexPage() {
  const posts = loadPublishedPosts()
  const avatarUrl = await authorAvatar()
  return (
    <div className="max-w-6xl mx-auto">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd(null)) }} />
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white">Blog</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          A plain journal from the person who builds VelocityStack. <a href={`${BLOG_PATH}/rss.xml`} className="underline inline-flex items-center min-h-[44px]">RSS</a>
        </p>
      </header>
      {posts.length === 0 ? (
        <p className="glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-6 text-center text-slate-600 dark:text-slate-300">Nothing here yet.</p>
      ) : (
        <ul className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => (
            <li key={p.slug} className="min-w-0">
              <BlogCard card={feedCardData(p, avatarUrl)} testId="blog-index-card" className="h-full" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
