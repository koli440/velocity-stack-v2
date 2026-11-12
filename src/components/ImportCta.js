'use client'

import { useEffect } from 'react'
import CarryLink from './CarryLink'
import { trackImportEvent } from '../lib/importTracking'

// Page-view event for an import landing page (consent-gated, renders nothing).
export function ImportViewTracker({ slug }) {
  useEffect(() => {
    trackImportEvent('import_guide_view', slug)
  }, [slug])
  return null
}

// CTA link that keeps utm_*/gclid and reports the click when analytics is allowed.
export default function ImportCta({ href, slug, cta, className, children }) {
  return (
    <CarryLink href={href} className={className} onClick={() => trackImportEvent('import_cta_click', slug, cta)}>
      {children}
    </CarryLink>
  )
}
