import Avatar from '../Avatar'
import { BLOG_AUTHOR, formatPostDate } from '../../lib/blog'

export default function Byline({ avatarUrl, date, updated, minutes }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar url={avatarUrl} name={BLOG_AUTHOR.name} size="w-11 h-11" textSize="text-sm" />
      <div className="text-sm text-slate-600 dark:text-slate-400">
        <p>
          Written by <span className="font-bold text-slate-900 dark:text-white">{BLOG_AUTHOR.name}</span>, who {BLOG_AUTHOR.bio}
        </p>
        <p className="text-xs">
          <time dateTime={date}>{formatPostDate(date)}</time>
          {updated && updated !== date && <> · updated <time dateTime={updated}>{formatPostDate(updated)}</time></>}
          {minutes ? <> · {minutes} min read</> : null}
        </p>
      </div>
    </div>
  )
}
