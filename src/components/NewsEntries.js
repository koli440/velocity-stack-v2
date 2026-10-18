import Link from 'next/link'
import MarkdownBlocks from './MarkdownBlocks'

// List of news entries (modal and /whats-new). Images come from validated /public paths or https URLs.
export default function NewsEntries({ entries, onNavigate }) {
  return (
    <ol className="space-y-5">
      {entries.map((e) => (
        <li key={e.id} className="space-y-1.5">
          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            <time dateTime={e.date}>{e.date}</time>
          </p>
          <h3 className="text-base font-black text-slate-900 dark:text-white">{e.title}</h3>
          {e.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.image} alt={e.imageAlt || ''} loading="lazy" className="rounded-xl max-h-48 w-full object-cover" />
          )}
          <MarkdownBlocks source={e.body} onNavigate={onNavigate} />
          {e.link &&
            (e.link.startsWith('https://') ? (
              <a href={e.link} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-bold underline text-emerald-600 dark:text-brand-neon">
                {e.linkLabel}
              </a>
            ) : (
              <Link href={e.link} onClick={onNavigate} className="inline-block text-xs font-bold underline text-emerald-600 dark:text-brand-neon">
                {e.linkLabel}
              </Link>
            ))}
        </li>
      ))}
    </ol>
  )
}
