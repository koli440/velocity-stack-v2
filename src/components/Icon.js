import { ICON_SET } from '../lib/iconSet'

// Renders an icon from the unified set. Sizes with the surrounding text by default.
export default function Icon({ name, size = '1em', className = '', title }) {
  const def = ICON_SET[name]
  if (!def) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-[-0.125em] ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: def.svg }}
    />
  )
}
