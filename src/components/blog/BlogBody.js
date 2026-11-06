import { Inline } from '../MarkdownBlocks'
import { renderBlocks } from '../../lib/blog'

// Renders a post body (lib/markdownLite blocks, never raw HTML) with stable anchors on the section headings.
export default function BlogBody({ body }) {
  const blocks = renderBlocks(body)
  return (
    <div className="space-y-5 text-base sm:text-lg leading-relaxed text-slate-800 dark:text-slate-200">
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          const Tag = b.level === 2 ? 'h2' : 'h3'
          return (
            <Tag
              key={i}
              id={b.id}
              className={`group scroll-mt-20 font-black text-slate-900 dark:text-white ${b.level === 2 ? 'text-2xl sm:text-3xl pt-6' : 'text-xl pt-4'}`}
            >
              <Inline nodes={b.inline} />
              <a
                href={`#${b.id}`}
                aria-label={`Link to section: ${b.text}`}
                className="ml-2 text-slate-400 opacity-0 focus:opacity-100 group-hover:opacity-100 no-underline"
              >
                #
              </a>
            </Tag>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="list-disc pl-6 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline nodes={item} />
                </li>
              ))}
            </ul>
          )
        }
        if (b.type === 'pre') {
          return (
            <pre key={i} className="font-mono text-sm bg-slate-100 dark:bg-slate-900 rounded-xl p-4 overflow-x-auto">
              {b.text}
            </pre>
          )
        }
        return (
          <p key={i}>
            <Inline nodes={b.inline} />
          </p>
        )
      })}
    </div>
  )
}

export function TagList({ tags }) {
  if (!tags?.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map((t) => (
        <li key={t} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
          {t}
        </li>
      ))}
    </ul>
  )
}
