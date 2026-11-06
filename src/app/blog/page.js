import Link from 'next/link'
import { loadPublishedPosts } from '../../lib/server/blogContent'
import { BLOG_PATH, BLOG_TITLE, BLOG_DESCRIPTION, formatPostDate, breadcrumbJsonLd } from '../../lib/blog'
import { jsonLdString } from '../../lib/trackLanding'
import { TagList } from '../../components/blog/BlogBody'

// Scheduled posts appear on their date: the list is rebuilt from the files at most every 15 minutes (docs/blog.md).
export const revalidate = 900

export const metadata = {
  title: 'Blog',
  description: BLOG_DESCRIPTION,
  alternates: { canonical: BLOG_PATH, types: { 'application/rss+xml': `${BLOG_PATH}/rss.xml` } },
  openGraph: { type: 'website', siteName: 'VelocityStack', title: BLOG_TITLE, description: BLOG_DESCRIPTION, url: BLOG_PATH },
  twitter: { card: 'summary_large_image', title: BLOG_TITLE, description: BLOG_DESCRIPTION },
}

export default function BlogIndexPage() {
  const posts = loadPublishedPosts()
  return (
    <div className="max-w-2xl mx-auto">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd(null)) }} />
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white">Blog</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          A plain journal from the person who builds VelocityStack. <a href={`${BLOG_PATH}/rss.xml`} className="underline">RSS</a>
        </p>
      </header>
      {posts.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-400">Nothing here yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-surface-darkBorder">
          {posts.map((p) => (
            <li key={p.slug} className="py-6 first:pt-0">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <time dateTime={p.date}>{formatPostDate(p.date)}</time> · {p.minutes} min read
              </p>
              <h2 className="mt-1 text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                <Link href={`${BLOG_PATH}/${p.slug}`} className="hover:underline">
                  {p.title}
                </Link>
              </h2>
              <p className="mt-2 text-slate-700 dark:text-slate-300">{p.summary}</p>
              <div className="mt-3">
                <TagList tags={p.tags} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
