import Link from 'next/link'
import Avatar from './Avatar'
import CalendarTile from './CalendarTile'
import CoverArt, { COVER_BACKGROUND } from './blog/CoverArt'
import { BLOG_AUTHOR } from '../lib/blog'

// Timeline card for a published blog post (placed by publish date in the rider's own feed, see lib/blogFeed).
// Same hero layout as an activity card. Content is the public post only.
export default function BlogFeedCard({ card }) {
  return (
    <div
      data-testid="feed-blog-card"
      className="glass-card group relative overflow-hidden rounded-2xl border bg-white dark:bg-surface-darkCard border-slate-200 dark:border-surface-darkBorder hover:border-orange-500/60 hover:-translate-y-0.5 transition duration-200"
    >
      <div className="relative h-36 sm:h-40 overflow-hidden" style={card.cover ? undefined : { background: COVER_BACKGROUND }}>
        {card.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.cover} alt={card.coverAlt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <>
            <CoverArt />
            <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-4xl sm:text-5xl font-black tracking-tight text-white select-none drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
              Velocity<span className="text-brand-neon">Stack</span>
            </div>
          </>
        )}
        <div className={`absolute inset-0 pointer-events-none ${card.cover ? 'bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-slate-950/30' : 'bg-gradient-to-t from-slate-950/60 via-transparent to-transparent'}`} />
        <span className="absolute top-2.5 left-2.5 z-[2] text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-neon text-slate-950">
          New on the blog
        </span>
        <CalendarTile date={`${card.date}T12:00:00Z`} className="absolute top-2.5 right-2.5 z-[2]" />
      </div>
      <div className="absolute left-4 top-36 sm:top-40 -translate-y-1/2 z-10">
        <Avatar url={card.avatarUrl} name={BLOG_AUTHOR.name} size="w-14 h-14" textSize="text-lg" className="ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-offset-surface-darkCard" />
      </div>
      <div className="p-4 pb-4 pt-9">
        <div className="text-sm font-black text-slate-900 dark:text-white">{BLOG_AUTHOR.name}</div>
        <Link
          href={card.href}
          className="mt-2 block text-base font-black text-slate-900 dark:text-white group-hover:text-orange-500 transition after:absolute after:inset-0 after:content-['']"
        >
          {card.title}
        </Link>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{card.summary}</p>
      </div>
    </div>
  )
}
