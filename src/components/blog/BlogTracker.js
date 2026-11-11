'use client'

// Anonymous post analytics: one view and at most one 75% read-depth event per page load (docs/analytics.md). Renders nothing.
import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { trackBlogEvent, readDepthReached } from '../../lib/blogTracking'

export default function BlogTracker({ slug, targetId = 'blog-post' }) {
  useEffect(() => {
    let read = false
    trackBlogEvent(supabase, 'blog_view', slug)
    const check = () => {
      if (read) return
      const el = document.getElementById(targetId)
      if (el && readDepthReached(el.getBoundingClientRect(), window.innerHeight)) {
        read = true
        trackBlogEvent(supabase, 'blog_read_75', slug)
        window.removeEventListener('scroll', check)
      }
    }
    window.addEventListener('scroll', check, { passive: true })
    check()
    return () => window.removeEventListener('scroll', check)
  }, [slug, targetId])
  return null
}
