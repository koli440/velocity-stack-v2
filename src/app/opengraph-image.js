import { renderOgImage, OG_ALT } from '../lib/ogImage'

export const alt = OG_ALT
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return renderOgImage()
}
