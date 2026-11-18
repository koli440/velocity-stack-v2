'use client'

import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { trackBlogEvent } from '../lib/blogTracking'
import BlogCard from './blog/BlogCard'

// Timeline card for a published blog post (placed by publish date in the rider's own feed, see lib/blogFeed).
// Same hero layout as an activity card. Content is the public post only.
export default function BlogFeedCard({ card }) {
  const ref = useRef(null)
  const seen = useRef(false)

  // One anonymous impression per card per feed mount, once at least half of it is visible (docs/analytics.md).
  useEffect(() => {
    const el = ref.current
    if (!el || seen.current || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      if (seen.current || !entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) return
      seen.current = true
      trackBlogEvent(supabase, 'blog_card_impression', card.slug)
      io.disconnect()
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [card.slug])

  return (
    <BlogCard
      card={card}
      cardRef={ref}
      testId="feed-blog-card"
      onOpen={() => trackBlogEvent(supabase, 'blog_card_click', card.slug)}
    />
  )
}
