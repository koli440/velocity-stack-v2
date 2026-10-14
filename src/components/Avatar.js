'use client'

import { useState } from 'react'
import { avatarInitials } from '../lib/avatars'

// Square, object-cover, rounded image; falls back to an initials placeholder when the
// rider has no image or it fails to load. `size` is a Tailwind size utility pair.
export default function Avatar({ url, name, size = 'w-8 h-8', textSize = 'text-xs', className = '' }) {
  const [failedUrl, setFailedUrl] = useState(null)
  const base = `${size} shrink-0 rounded-full overflow-hidden ${className}`
  if (url && failedUrl !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ? `${name}'s profile image` : 'Profile image'}
        loading="lazy"
        onError={() => setFailedUrl(url)}
        className={`${base} object-cover`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`${base} bg-orange-500/20 text-orange-500 ${textSize} font-black flex items-center justify-center`}
    >
      {avatarInitials(name)}
    </span>
  )
}
