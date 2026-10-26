'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { carryQuery } from '../lib/trackLanding'

// In-app link that forwards the current page's query string (UTM params, gclid) to the target.
// The server-rendered href is the plain path, so it works without JavaScript too.
export default function CarryLink({ href, ...props }) {
  const [target, setTarget] = useState(href)
  useEffect(() => {
    setTarget(carryQuery(href, window.location.search))
  }, [href])
  return <Link href={target} {...props} />
}
